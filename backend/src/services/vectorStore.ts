import { CohereClient } from 'cohere-ai';
import { VectorDocument } from '../types';
import { db, insertDocument, getAllDocuments, clearDocuments } from './db';

let cohereInstance: CohereClient | null = null;
function getCohere() {
  if (!cohereInstance) {
    if (!process.env.COHERE_API_KEY) {
      throw new Error('COHERE_API_KEY is not set in env variables');
    }
    cohereInstance = new CohereClient({
      token: process.env.COHERE_API_KEY,
    });
  }
  return cohereInstance;
}

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

const embedBatchWithRetry = async (batch: string[], inputType: 'search_document' | 'search_query', retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await getCohere().embed({
        texts: batch,
        model: 'embed-english-v3.0',
        inputType: inputType,
      });
      return response.embeddings;
    } catch (err: any) {
      if (err.statusCode === 429) {
        const backoff = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`Rate limited on attempt ${attempt + 1}, waiting ${backoff}ms`);
        await new Promise(res => setTimeout(res, backoff));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded');
};

const getParallelLimit = () => {
  if (process.env.EMBEDDING_PARALLEL_LIMIT) {
    const parsed = parseInt(process.env.EMBEDDING_PARALLEL_LIMIT, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return process.env.COHERE_TIER === 'free' ? 3 : 8;
};

export async function generateEmbeddingsBatch(
  texts: string[],
  inputType: 'search_document' | 'search_query',
  onProgress?: (batchIndex: number, totalBatches: number) => void
): Promise<number[][]> {
  const BATCH_SIZE = 10;
  const PARALLEL_LIMIT = getParallelLimit();
  
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(texts.slice(i, i + BATCH_SIZE));
  }

  const totalBatches = batches.length;
  const allEmbeddings = new Array<number[]>(texts.length);

  // Process in groups of PARALLEL_LIMIT
  for (let i = 0; i < batches.length; i += PARALLEL_LIMIT) {
    const group = batches.slice(i, i + PARALLEL_LIMIT);
    
    const groupResults = await Promise.all(
      group.map((batch, idx) => embedBatchWithRetry(batch, inputType)
        .then(result => {
          const completedBatchIdx = i + idx + 1;
          if (onProgress) {
            onProgress(completedBatchIdx, totalBatches);
          }
          return result;
        })
      )
    );

    // Store results in correct overall index
    groupResults.forEach((embeddings, groupIdx) => {
      const batchStartIndex = (i + groupIdx) * BATCH_SIZE;
      if (embeddings && Array.isArray(embeddings)) {
        embeddings.forEach((emb, embIdx) => {
          allEmbeddings[batchStartIndex + embIdx] = emb as number[];
        });
      }
    });

    if (i + PARALLEL_LIMIT < batches.length) {
      await new Promise(res => setTimeout(res, 500));
    }
  }

  return allEmbeddings;
}

export async function generateEmbedding(text: string, inputType: 'search_document' | 'search_query'): Promise<number[]> {
  const embeddings = await embedBatchWithRetry([text], inputType);
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
  static async addDocuments(
    docs: { text: string; metadata: any }[],
    onProgress?: (batchIndex: number, totalBatches: number) => void
  ) {
    const texts = docs.map(d => d.text);
    const embeddings = await generateEmbeddingsBatch(texts, 'search_document', onProgress);
    
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
