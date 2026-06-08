import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

router.get('/', (req: Request, res: Response): any => {
  const filePath = req.query.path as string;
  const repoId = req.query.repoId as string;

  if (!filePath) {
    return res.status(400).send('File path is required');
  }

  try {
    const reposDir = path.join(process.cwd(), '.repos');
    
    let currentRepoName = '';
    if (repoId) {
      currentRepoName = repoId.split('/').pop()?.replace('.git', '') || '';
    }

    if (!currentRepoName && fs.existsSync(reposDir)) {
      const repos = fs.readdirSync(reposDir);
      if (repos.length > 0) {
        currentRepoName = repos[0];
      }
    }

    if (!currentRepoName) {
      return res.status(404).send('No repository context found');
    }

    const repoBasePath = path.join(reposDir, currentRepoName);
    const requestedFile = filePath.replace(/\//g, path.sep);
    const fullPath = path.join(repoBasePath, requestedFile);

    console.log('Requested file path:', filePath);
    console.log('Full disk path:', fullPath);
    console.log('File exists:', fs.existsSync(fullPath));

    const resolvedRepoBasePath = path.resolve(repoBasePath).toLowerCase();
    const resolvedFullPath = path.resolve(fullPath).toLowerCase();

    if (!resolvedFullPath.startsWith(resolvedRepoBasePath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        error: `File not found: ${filePath}`,
        lookedAt: fullPath
      });
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (error: any) {
    console.error('File API Error:', error);
    res.status(500).send(error.message);
  }
});

export default router;
