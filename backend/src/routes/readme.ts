import { Router, Request, Response } from 'express';
import { askLLMStream } from '../services/llm';
import { VectorStore } from '../services/vectorStore';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const allDocs = VectorStore.getAll();
    
    if (allDocs.length === 0) {
      return res.status(400).send('No repository data found. Please clone a repo first.');
    }

    const fileStructure = Array.from(new Set(allDocs.map(d => d.metadata.path))).join('\n');
    
    const summaryDocs = allDocs.filter(d => d.metadata.chunkIndex === 0).slice(0, 50);
    const contentSnippets = summaryDocs.map(doc => `--- ${doc.metadata.path} ---\n${doc.text.substring(0, 500)}...\n`).join('\n');

    const systemPrompt = `You are an expert technical writer and senior software engineer.
Your task is to generate a comprehensive, professional, and highly polished README.md file for the provided codebase.
Make sure to include:
- A catchy title and a clear description of what the project does
- A "Features" section
- A "File Structure" overview
- "Getting Started" or "Installation" guide based on package.json or typical conventions for the languages used.
Respond ONLY with the raw Markdown content. Do not include introductory text.`;

    const userPrompt = `Here is the repository structure:\n${fileStructure}\n\nHere are some content snippets to understand the project better:\n${contentSnippets}\n\nPlease generate the README.md now.`;

    await askLLMStream(systemPrompt, userPrompt, res);
  } catch (error: any) {
    console.error('Generate README API Error:', error);
    res.status(500).send(error.message);
  }
});

export default router;
