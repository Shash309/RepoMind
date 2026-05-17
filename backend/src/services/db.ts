import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const db = new Database(path.join(DB_DIR, 'repomind.db'));

db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    metadata TEXT NOT NULL,
    embedding TEXT NOT NULL
  );
`);

export function insertDocument(id: string, text: string, metadata: any, embedding: number[]) {
  const stmt = db.prepare('INSERT OR REPLACE INTO documents (id, text, metadata, embedding) VALUES (?, ?, ?, ?)');
  stmt.run(id, text, JSON.stringify(metadata), JSON.stringify(embedding));
}

export function getAllDocuments() {
  const stmt = db.prepare('SELECT * FROM documents');
  const rows = stmt.all() as any[];
  return rows.map(row => ({
    id: row.id,
    text: row.text,
    metadata: JSON.parse(row.metadata),
    embedding: JSON.parse(row.embedding)
  }));
}

export function clearDocuments() {
  db.exec('DELETE FROM documents');
}
