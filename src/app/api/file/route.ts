import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get('path');

  if (!filePath) {
    return new Response('File path is required', { status: 400 });
  }

  try {
    const reposDir = path.join(process.cwd(), '.repos');
    if (!fs.existsSync(reposDir)) {
      return new Response('No repositories found', { status: 404 });
    }

    const repos = fs.readdirSync(reposDir);
    if (repos.length === 0) {
      return new Response('No repositories found', { status: 404 });
    }

    // Since this is a single-session demo, we just grab the first repo
    const currentRepoName = repos[0];
    const absolutePath = path.join(reposDir, currentRepoName, filePath);

    // Prevent directory traversal attacks
    if (!absolutePath.startsWith(path.join(reposDir, currentRepoName))) {
      return new Response('Invalid path', { status: 403 });
    }

    if (!fs.existsSync(absolutePath)) {
      return new Response('File not found', { status: 404 });
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    return new Response(content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  } catch (error: any) {
    console.error('File API Error:', error);
    return new Response(error.message, { status: 500 });
  }
}
