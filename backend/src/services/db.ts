import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { VectorDocument } from '../types';

// Use a path relative to the compiled file so it works on Render's writable filesystem.
// In production: dist/index.js → __dirname = dist/ → data dir = dist/../data = <root>/data
const DB_DIR = path.resolve(__dirname, '..', 'data');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'repomind.db');
console.log(`[DB] Database path: ${DB_PATH}`);

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id       TEXT PRIMARY KEY,
    text     TEXT NOT NULL,
    metadata TEXT NOT NULL,
    embedding TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS embedding_cache (
    file_hash TEXT PRIMARY KEY,
    file_path TEXT,
    repo_url TEXT,
    embeddings TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export function getCachedEmbeddings(fileHash: string): number[][] | null {
  const stmt = db.prepare('SELECT embeddings FROM embedding_cache WHERE file_hash = ?');
  const row = stmt.get(fileHash) as { embeddings: string } | undefined;
  if (row) {
    try {
      return JSON.parse(row.embeddings);
    } catch {
      return null;
    }
  }
  return null;
}

export function cacheEmbeddings(
  fileHash: string,
  filePath: string,
  repoUrl: string,
  embeddings: number[][]
) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO embedding_cache (file_hash, file_path, repo_url, embeddings) VALUES (?, ?, ?, ?)'
  );
  stmt.run(fileHash, filePath, repoUrl, JSON.stringify(embeddings));
}

export function insertDocument(
  id: string,
  text: string,
  metadata: VectorDocument['metadata'],
  embedding: number[]
) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO documents (id, text, metadata, embedding) VALUES (?, ?, ?, ?)'
  );
  stmt.run(id, text, JSON.stringify(metadata), JSON.stringify(embedding));
}

export function getAllDocuments(): (VectorDocument & { embedding: number[] })[] {
  const stmt = db.prepare('SELECT * FROM documents');
  return (stmt.all() as any[]).map((row) => ({
    id: row.id as string,
    text: row.text as string,
    metadata: JSON.parse(row.metadata) as VectorDocument['metadata'],
    embedding: JSON.parse(row.embedding) as number[],
  }));
}

export function clearDocuments() {
  db.exec('DELETE FROM documents');
}
