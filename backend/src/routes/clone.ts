import { Router, Request, Response } from 'express';
import { cloneRepo, getRepoFiles } from '../services/github';
import { VectorStore, chunkText } from '../services/vectorStore';
import { FileNode } from '../types';
import path from 'path';

const router = Router();

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

router.post('/', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'GitHub URL is required' });
    }

    const cloneDir = await cloneRepo(url);
    const files = await getRepoFiles(cloneDir);

    const validFiles = files.filter(f => f.content.length < 100000);
    
    VectorStore.clear();

    const documentsToAdd = [];
    let totalChunks = 0;
    
    const isTier1 = (path: string) => {
      const lower = path.toLowerCase();
      if (['readme.md', 'package.json', 'requirements.txt', 'dockerfile'].includes(lower)) return true;
      if (['index.js', 'main.py', 'app.py', 'server.js', 'index.ts'].includes(lower)) return true;
      if (!path.includes('/')) return true; 
      return false;
    };

    const isTier2 = (path: string) => {
      const lower = path.toLowerCase();
      if (lower.startsWith('src/') || lower.startsWith('lib/') || lower.startsWith('app/') || lower.startsWith('components/')) return true;
      if (lower.endsWith('.py') || lower.endsWith('.js') || lower.endsWith('.ts') || lower.endsWith('.jsx') || lower.endsWith('.tsx')) return true;
      return false;
    };

    const isTier3 = (path: string) => {
      const lower = path.toLowerCase();
      if (lower.includes('.test.') || lower.includes('.spec.') || lower.includes('/tests/') || lower.includes('/__tests__/')) return true;
      if (lower.includes('migration') || lower.includes('generated')) return true;
      return false;
    };

    for (const file of validFiles) {
      if (documentsToAdd.length >= 500) break;

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
      
      const spaceLeft = 500 - documentsToAdd.length;
      const chunks = chunksToKeep.slice(0, spaceLeft);

      totalChunks += chunks.length;
      for (let i = 0; i < chunks.length; i++) {
        documentsToAdd.push({
          text: chunks[i],
          metadata: { path: file.path, chunkIndex: i, totalChunks: chunks.length }
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

    documentsToAdd.unshift({
      text: repoSummaryText,
      metadata: { path: '__REPO_SUMMARY__', chunkIndex: 0, totalChunks: 1 }
    });

    console.log(`Indexing ${documentsToAdd.length} chunks across ${validFiles.length} files (includes 1 repo summary)...`);
    
    await VectorStore.addDocuments(documentsToAdd);
    
    const fileTree = buildFileTree(files);

    res.json({ success: true, fileTree });
  } catch (error: any) {
    console.error('Clone Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
