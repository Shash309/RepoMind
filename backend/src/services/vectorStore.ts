import { CohereClient } from 'cohere-ai';
import { VectorDocument } from '../types';
import { db, insertDocument, getAllDocuments, clearDocuments } from './db';

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY || '',
});

export function chunkText(text: string, filePath: string, maxChunkSize: number = 4000, overlap: number = 100): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + maxChunkSize, text.length);
    let chunk = text.substring(i, end);
    
    if (end < text.length) {
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline !== -1 && lastNewline > overlap) {
        chunk = chunk.substring(0, lastNewline);
      }
    }
    
    const finalChunk = `File: ${filePath}\n\n${chunk}`;
    chunks.push(finalChunk);
    const advance = Math.max(1, chunk.length - overlap);
    i += advance;
  }
  return chunks;
}

const embedWithRetry = async (chunks: string[], inputType: 'search_document' | 'search_query', retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await cohere.embed({
        texts: chunks,
        model: 'embed-english-v3.0',
        inputType: inputType,
      });
      return response.embeddings;
    } catch (err: any) {
      if (err.statusCode === 429) {
        const delay = Math.pow(2, i) * 2000;
        console.log(`Rate limited. Retrying in ${delay/1000}s...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded');
};

export async function generateEmbeddingsBatch(texts: string[], inputType: 'search_document' | 'search_query'): Promise<number[][]> {
  const BATCH_SIZE = 20;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    
    console.log(`Generating embeddings for batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(texts.length/BATCH_SIZE)}...`);
    const embeddings = await embedWithRetry(batch, inputType);
    
    if (embeddings && Array.isArray(embeddings)) {
       allEmbeddings.push(...(embeddings as number[][]));
    }
    
    if (i + BATCH_SIZE < texts.length) {
      await new Promise(res => setTimeout(res, 1500));
    }
  }

  return allEmbeddings;
}

export async function generateEmbedding(text: string, inputType: 'search_document' | 'search_query'): Promise<number[]> {
  const embeddings = await embedWithRetry([text], inputType);
  return (embeddings as number[][])[0];
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorStore {
  static async addDocuments(docs: { text: string; metadata: any }[]) {
    const texts = docs.map(d => d.text);
    const embeddings = await generateEmbeddingsBatch(texts, 'search_document');
    
    for (let i = 0; i < docs.length; i++) {
      const id = Math.random().toString(36).substring(7);
      insertDocument(id, docs[i].text, docs[i].metadata, embeddings[i]);
    }
  }

  static async search(query: string, limit: number = 5): Promise<(VectorDocument & { score: number })[]> {
    const docs = getAllDocuments();
    if (docs.length === 0) return [];

    const queryEmbedding = await generateEmbedding(query, 'search_query');

    const scoredDocs = docs.map((doc) => ({
      ...doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding),
    }));

    scoredDocs.sort((a, b) => b.score - a.score);
    return scoredDocs.slice(0, limit);
  }

  static clear() {
    clearDocuments();
  }
  
  static getAll() {
      return getAllDocuments();
  }

  static getByFilePath(filePath: string): (VectorDocument & { score: number })[] {
    const docs = getAllDocuments();
    if (docs.length === 0) return [];
    
    const normalize = (p: string) => p.replace(/\\/g, '/');
    const normalizedInput = normalize(filePath);
    return docs
      .filter(doc => normalize(doc.metadata.path) === normalizedInput)
      .map(doc => ({ ...doc, score: 1.0 }));
  }
}
