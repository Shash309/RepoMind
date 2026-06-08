import { Router, Request, Response } from 'express';
import { cloneRepo, getRepoFiles } from '../services/github';
import { VectorStore, chunkText, generateEmbeddingsBatch, generateEmbedding } from '../services/vectorStore';
import { getCachedEmbeddings, cacheEmbeddings, insertDocument } from '../services/db';
import { FileNode } from '../types';
import path from 'path';
import crypto from 'crypto';

const router = Router();

interface CloneJob {
  status: 'connecting' | 'cloning' | 'parsing' | 'embedding' | 'ready' | 'complete' | 'error';
  step: string;
  progress: number;
  error?: string | null;
  fileTree?: FileNode[] | null;
  timeRemaining?: string;
}

const jobs = new Map<string, CloneJob>();

function buildFileTree(files: { path: string }[]): FileNode[] {
  const root: FileNode = { id: 'root', name: 'root', isDir: true, children: [] };

  files.forEach(file => {
    const parts = file.path.split('/');
    let currentNode = root;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      let childNode = currentNode.children?.find(c => c.name === part);

      if (!childNode) {
        childNode = {
          id: parts.slice(0, index + 1).join('/'),
          name: part,
          isDir: !isLast,
          ...( !isLast ? { children: [] } : {} )
        };
        currentNode.children = currentNode.children || [];
        currentNode.children.push(childNode);
      }
      currentNode = childNode;
    });
  });

  return root.children || [];
}

async function processRepo(jobId: string, url: string) {
  try {
    // 1. Cloning
    jobs.set(jobId, { status: 'cloning', step: 'Cloning repository', progress: 10 });
    const cloneDir = await cloneRepo(url);
    
    // 2. Parsing
    jobs.set(jobId, { status: 'parsing', step: 'Parsing file structure', progress: 30 });
    const files = await getRepoFiles(cloneDir);

    const validFiles = files.filter(f => f.content.length < 100000);
    
    VectorStore.clear();

    const cachedDocuments: Array<{ text: string; metadata: any; embedding: number[] }> = [];
    const uncachedFilesToEmbed: Array<{ path: string; hash: string; chunks: string[] }> = [];
    let totalChunks = 0;
    
    const isTier1 = (filePath: string) => {
      const lower = filePath.toLowerCase();
      if (['readme.md', 'package.json', 'requirements.txt', 'dockerfile'].includes(lower)) return true;
      if (['index.js', 'main.py', 'app.py', 'server.js', 'index.ts'].includes(lower)) return true;
      if (!filePath.includes('/')) return true; 
      return false;
    };

    const isTier2 = (filePath: string) => {
      const lower = filePath.toLowerCase();
      if (lower.startsWith('src/') || lower.startsWith('lib/') || lower.startsWith('app/') || lower.startsWith('components/')) return true;
      if (lower.endsWith('.py') || lower.endsWith('.js') || lower.endsWith('.ts') || lower.endsWith('.jsx') || lower.endsWith('.tsx')) return true;
      return false;
    };

    const isTier3 = (filePath: string) => {
      const lower = filePath.toLowerCase();
      if (lower.includes('.test.') || lower.includes('.spec.') || lower.includes('/tests/') || lower.includes('/__tests__/')) return true;
      if (lower.includes('migration') || lower.includes('generated')) return true;
      return false;
    };

    for (const file of validFiles) {
      const spaceLeft = 500 - totalChunks;
      if (spaceLeft <= 0) break;

      let maxChunks = 20;
      if (isTier1(file.path)) {
        maxChunks = 999; 
      } else if (isTier3(file.path)) {
        maxChunks = 2;
      } else if (isTier2(file.path)) {
        maxChunks = 10;
      }

      const allChunks = chunkText(file.content, file.path);
      const chunksToKeep = allChunks.slice(0, maxChunks);
      const chunks = chunksToKeep.slice(0, spaceLeft);

      if (chunks.length === 0) continue;
      totalChunks += chunks.length;

      const fileHash = crypto
        .createHash('md5')
        .update(file.content)
        .digest('hex');

      const cached = getCachedEmbeddings(fileHash);
      if (cached && cached.length === chunks.length) {
        console.log(`Cache hit for ${file.path} — skipping embedding`);
        for (let i = 0; i < chunks.length; i++) {
          cachedDocuments.push({
            text: chunks[i],
            metadata: { path: file.path, chunkIndex: i, totalChunks: chunks.length },
            embedding: cached[i]
          });
        }
      } else {
        uncachedFilesToEmbed.push({
          path: file.path,
          hash: fileHash,
          chunks
        });
      }
    }

    const repoName = url.split('/').pop()?.replace('.git', '') || 'unknown-repo';
    
    const allPaths = files.map(f => f.path);
    const folderSet = new Set<string>();
    allPaths.forEach(p => {
      const parts = p.split('/');
      for (let i = 1; i <= parts.length; i++) {
        folderSet.add(parts.slice(0, i).join('/'));
      }
    });
    const sortedPaths = Array.from(folderSet).sort();
    const folderTree = sortedPaths.slice(0, 120).map(p => {
      const depth = p.split('/').length - 1;
      const name = p.split('/').pop();
      return '  '.repeat(depth) + (name?.includes('.') ? '📄 ' : '📁 ') + name;
    }).join('\n');

    const entryFiles = allPaths.filter(p => /^(index\.[jt]sx?|main\.py|app\.py|server\.[jt]s|manage\.py)$/.test(path.basename(p)));
    const depFiles = allPaths.filter(p => /^(package\.json|requirements\.txt|Cargo\.toml|go\.mod|Pipfile|pyproject\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle)$/.test(path.basename(p)));
    const configFiles = allPaths.filter(p => /^(tsconfig\.json|next\.config\.[jt]s|Dockerfile|docker-compose\.ya?ml|\.env\.example)$/.test(path.basename(p)));
    
    const extCounts: Record<string, number> = {};
    allPaths.forEach(p => {
      const ext = path.extname(p).toLowerCase() || '(no ext)';
      extCounts[ext] = (extCounts[ext] || 0) + 1;
    });
    const fileTypeSummary = Object.entries(extCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => `${ext}: ${count}`)
      .join(', ');

    const repoSummaryText = `File: __REPO_SUMMARY__

Repository: ${repoName}
Total files: ${allPaths.length}

FOLDER STRUCTURE:
${folderTree}

KEY FILES DETECTED:
- Entry points: ${entryFiles.length > 0 ? entryFiles.join(', ') : 'none detected'}
- Dependencies: ${depFiles.length > 0 ? depFiles.join(', ') : 'none detected'}
- Config files: ${configFiles.length > 0 ? configFiles.join(', ') : 'none detected'}
- Total source files by type: ${fileTypeSummary}
`;

    const uncachedTexts = uncachedFilesToEmbed.flatMap(f => f.chunks);
    let uncachedEmbeddings: number[][] = [];
    const startTime = Date.now();

    console.log(`Indexing chunks across files: cached=${cachedDocuments.length}, uncached=${uncachedTexts.length}`);

    // 3. Embedding
    jobs.set(jobId, { status: 'embedding', step: 'Generating embeddings (0%)', progress: 40 });

    if (uncachedTexts.length > 0) {
      uncachedEmbeddings = await generateEmbeddingsBatch(uncachedTexts, 'search_document', (completed, total) => {
        const elapsed = Date.now() - startTime;
        const avgTimePerBatch = elapsed / completed;
        const remaining = Math.ceil((total - completed) * avgTimePerBatch / 1000);
        const overallProgress = 40 + Math.floor((completed / total) * 50); // 40% to 90%
        
        jobs.set(jobId, {
          status: 'embedding',
          step: `Generating embeddings (${completed}/${total}) · ~${remaining}s remaining`,
          progress: overallProgress,
          timeRemaining: `~${remaining}s remaining`
        });
      });

      let embeddingPtr = 0;
      for (const item of uncachedFilesToEmbed) {
        const fileEmbeddings: number[][] = [];
        for (let i = 0; i < item.chunks.length; i++) {
          const emb = uncachedEmbeddings[embeddingPtr++];
          fileEmbeddings.push(emb);
          const docId = Math.random().toString(36).substring(7);
          insertDocument(docId, item.chunks[i], { path: item.path, chunkIndex: i, totalChunks: item.chunks.length }, emb);
        }
        cacheEmbeddings(item.hash, item.path, url, fileEmbeddings);
      }
    }

    // Insert cached documents directly
    for (const doc of cachedDocuments) {
      const docId = Math.random().toString(36).substring(7);
      insertDocument(docId, doc.text, doc.metadata, doc.embedding);
    }

    // Embed and insert repo summary
    const summaryEmbedding = await generateEmbedding(repoSummaryText, 'search_document');
    const summaryId = Math.random().toString(36).substring(7);
    insertDocument(summaryId, repoSummaryText, { path: '__REPO_SUMMARY__', chunkIndex: 0, totalChunks: 1 }, summaryEmbedding);

    const fileTree = buildFileTree(files);

    // Done
    jobs.set(jobId, {
      status: 'complete',
      step: 'Ready to chat',
      progress: 100,
      fileTree
    });

  } catch (error: any) {
    console.error('Background Ingestion Error:', error);
    jobs.set(jobId, {
      status: 'error',
      step: 'Ingestion failed',
      progress: 0,
      error: error.message || 'Unknown ingestion error'
    });
  }
}

// POST /api/clone - Start the asynchronous ingestion job
router.post('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'GitHub URL is required' });
    }

    const jobId = crypto.randomUUID();

    // Initialize status
    jobs.set(jobId, {
      status: 'connecting',
      step: 'Connecting to GitHub',
      progress: 5,
    });

    // Start background worker
    processRepo(jobId, url).catch(err => {
      console.error('Job initiation failed:', err);
    });

    // Return jobId instantly
    res.json({ jobId });
  } catch (error: any) {
    console.error('Clone Initiation Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/clone/status/:jobId - Poll status of ingestion
router.get('/status/:jobId', (req: Request, res: Response): any => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

export default router;
