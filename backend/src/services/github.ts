import fs from 'fs';
import path from 'path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { FileDocument } from '../types';

const REPOS_DIR = path.join(process.cwd(), '.repos');

const IGNORED_DIRS = [
  '.git', 'node_modules', 'dist', 'build', '.next', 'out', 'coverage', '.cache', 'public', '__pycache__'
];

const IGNORED_FILES = [
  'package-lock.json', 'yarn.lock', 'poetry.lock', '.env'
];

const IGNORED_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot'
];

export async function cloneRepo(repoUrl: string): Promise<string> {
  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }

  const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'unknown-repo';
  const cloneDir = path.join(REPOS_DIR, repoName);

  if (fs.existsSync(cloneDir)) {
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }

  console.log(`Cloning ${repoUrl} into ${cloneDir}...`);
  
  await git.clone({
    fs,
    http,
    dir: cloneDir,
    url: repoUrl,
    singleBranch: true,
    depth: 1,
  });

  return cloneDir;
}

export async function getRepoFiles(dir: string, baseDir: string = dir): Promise<FileDocument[]> {
  let results: FileDocument[] = [];
  const list = fs.readdirSync(dir);

  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (IGNORED_DIRS.includes(file)) continue;
      results = results.concat(await getRepoFiles(filePath, baseDir));
    } else {
      const ext = path.extname(file).toLowerCase();
      const isHiddenEnv = file === '.env' || file.startsWith('.env.');
      const isEnvExample = file === '.env.example';
      
      if (IGNORED_FILES.includes(file)) continue;
      if (IGNORED_EXTENSIONS.includes(ext)) continue;
      if (isHiddenEnv && !isEnvExample) continue;

      const isSourceCode = ['.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.java', '.c', '.cpp', '.cs', '.php', '.rs', '.html', '.css'].includes(ext);
      const isConfigOrDeps = ['package.json', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json', 'Pipfile', 'pyproject.toml', 'tsconfig.json', 'next.config.js'].includes(file);
      const isDoc = ext === '.md' || file.endsWith('.md');
      const isDockerCI = file === 'Dockerfile' || file === 'docker-compose.yml' || filePath.includes('.github/workflows');
      const isJsonYml = ext === '.json' || ext === '.yml' || ext === '.yaml';

      if (isSourceCode || isConfigOrDeps || isDoc || isDockerCI || isJsonYml || isEnvExample) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
          results.push({ path: relativePath, content });
        } catch (error) {
          console.error(`Error reading file ${filePath}:`, error);
        }
      }
    }
  }

  return results;
}
