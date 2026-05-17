import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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
`);

export function insertDocument(
  id: string,
  text: string,
  metadata: Record<string, unknown>,
  embedding: number[]
) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO documents (id, text, metadata, embedding) VALUES (?, ?, ?, ?)'
  );
  stmt.run(id, text, JSON.stringify(metadata), JSON.stringify(embedding));
}

export function getAllDocuments() {
  const stmt = db.prepare('SELECT * FROM documents');
  return (stmt.all() as any[]).map((row) => ({
    id: row.id,
    text: row.text,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    embedding: JSON.parse(row.embedding) as number[],
  }));
}

export function clearDocuments() {
  db.exec('DELETE FROM documents');
}
