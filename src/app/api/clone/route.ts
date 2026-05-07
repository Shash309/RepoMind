import { NextRequest, NextResponse } from 'next/server';
import { cloneRepo, getRepoFiles } from '../../../lib/github';
import { VectorStore, chunkText } from '../../../lib/vectorStore';
import { FileNode } from '../../../types';
import path from 'path';

// Helper to convert flat file paths to a nested tree structure for react-arborist
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

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'GitHub URL is required' }, { status: 400 });
    }

    // 1. Clone Repo
    const cloneDir = await cloneRepo(url);

    // 2. Walk file tree and get contents
    const files = await getRepoFiles(cloneDir);

    // 3. Chunk and embed
    // For a weekend project, we only process files under a certain size (100KB) to avoid memory/API limits
    const validFiles = files.filter(f => f.content.length < 100000);
    
    // Clear previous vector store to simulate per-session
    VectorStore.clear();

    const documentsToAdd = [];
    let totalChunks = 0;
    
    // Tiering logic
    const isTier1 = (path: string) => {
      const lower = path.toLowerCase();
      if (['readme.md', 'package.json', 'requirements.txt', 'dockerfile'].includes(lower)) return true;
      if (['index.js', 'main.py', 'app.py', 'server.js', 'index.ts'].includes(lower)) return true;
      if (!path.includes('/')) return true; // root directory
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
      if (documentsToAdd.length >= 500) break; // Global cap

      let maxChunks = 20; // Default cap
      if (isTier1(file.path)) {
        maxChunks = 999; // Essentially no cap for critical files
      } else if (isTier3(file.path)) {
        maxChunks = 2;
      } else if (isTier2(file.path)) {
        maxChunks = 10;
      }

      const allChunks = chunkText(file.content, file.path);
      const chunksToKeep = allChunks.slice(0, maxChunks);
      
      // Prevent exceeding the global cap precisely
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

    // --- Generate synthetic REPO SUMMARY chunk (Bug 2 fix) ---
    const repoName = url.split('/').pop()?.replace('.git', '') || 'unknown-repo';
    
    // Build a folder tree string from file paths
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

    // Detect key files
    const entryFiles = allPaths.filter(p => /^(index\.[jt]sx?|main\.py|app\.py|server\.[jt]s|manage\.py)$/.test(path.basename(p)));
    const depFiles = allPaths.filter(p => /^(package\.json|requirements\.txt|Cargo\.toml|go\.mod|Pipfile|pyproject\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle)$/.test(path.basename(p)));
    const configFiles = allPaths.filter(p => /^(tsconfig\.json|next\.config\.[jt]s|Dockerfile|docker-compose\.ya?ml|\.env\.example)$/.test(path.basename(p)));
    
    // File type summary
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

    // Insert as the very first document
    documentsToAdd.unshift({
      text: repoSummaryText,
      metadata: { path: '__REPO_SUMMARY__', chunkIndex: 0, totalChunks: 1 }
    });

    // Add to vector store (this could take a while for large repos, in production we'd do this async)
    console.log(`Indexing ${documentsToAdd.length} chunks across ${validFiles.length} files (includes 1 repo summary)...`);
    
    // Process all chunks using the new batching logic inside VectorStore.addDocuments
    await VectorStore.addDocuments(documentsToAdd);
    
    // 4. Build file tree for the frontend
    const fileTree = buildFileTree(files);

    return NextResponse.json({ success: true, fileTree });
  } catch (error: any) {
    console.error('Clone Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
