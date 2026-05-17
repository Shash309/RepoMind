import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

router.get('/', (req: Request, res: Response): any => {
  const filePath = req.query.path as string;

  if (!filePath) {
    return res.status(400).send('File path is required');
  }

  try {
    const reposDir = path.join(process.cwd(), '.repos');
    if (!fs.existsSync(reposDir)) {
      return res.status(404).send('No repositories found');
    }

    const repos = fs.readdirSync(reposDir);
    if (repos.length === 0) {
      return res.status(404).send('No repositories found');
    }

    const currentRepoName = repos[0];
    const absolutePath = path.join(reposDir, currentRepoName, filePath);

    if (!absolutePath.startsWith(path.join(reposDir, currentRepoName))) {
      return res.status(403).send('Invalid path');
    }

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).send('File not found');
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (error: any) {
    console.error('File API Error:', error);
    res.status(500).send(error.message);
  }
});

export default router;
