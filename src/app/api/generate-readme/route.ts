import { NextRequest } from 'next/server';
import { askLLMStream } from '../../../lib/llm';
import { VectorStore } from '../../../lib/vectorStore';

export async function POST(req: NextRequest) {
  try {
    // 1. Gather all unique paths and a summary of the repository
    const allDocs = VectorStore.getAll();
    
    if (allDocs.length === 0) {
      return new Response('No repository data found. Please clone a repo first.', { status: 400 });
    }

    // Create a high-level summary. Since we can't send the entire repo if it's huge,
    // we send the file structure and the first chunk of each file.
    const fileStructure = Array.from(new Set(allDocs.map(d => d.metadata.path))).join('\n');
    
    // We get the first chunks up to a reasonable limit (e.g. 50 files)
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

    // 2. Stream the README back to the client
    const { stream, usedFallback } = await askLLMStream(systemPrompt, userPrompt);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Fallback-Used': usedFallback ? 'true' : 'false',
      },
    });
  } catch (error: any) {
    console.error('Generate README API Error:', error);
    return new Response(error.message, { status: 500 });
  }
}
