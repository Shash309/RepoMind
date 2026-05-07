import { CohereClient } from 'cohere-ai';
import { VectorDocument } from '../types';

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

// Basic chunker that splits text into chunks of roughly maxChunkSize characters
export function chunkText(text: string, filePath: string, maxChunkSize: number = 4000, overlap: number = 100): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + maxChunkSize, text.length);
    let chunk = text.substring(i, end);
    
    // If we're not at the end of the text, try to break at a newline to avoid splitting words/lines
    if (end < text.length) {
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline !== -1 && lastNewline > overlap) {
        chunk = chunk.substring(0, lastNewline);
      }
    }
    
    // Prepend the file path to provide strict context for the LLM
    const finalChunk = `File: ${filePath}\n\n${chunk}`;
    chunks.push(finalChunk);
    const advance = Math.max(1, chunk.length - overlap);
    i += advance; // Move forward, keeping some overlap
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
    
    // Cohere returns embeddings as number[][] for this model/endpoint combination
    if (embeddings && Array.isArray(embeddings)) {
       // if it's an array of arrays (floats)
       allEmbeddings.push(...(embeddings as number[][]));
    }
    
    // Add a small delay between batches to respect rate limits if there are multiple batches
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

// In-memory store (Warning: clears when server restarts/hot-reloads!)
declare global {
  var vectorStoreData: VectorDocument[] | undefined;
}

if (!global.vectorStoreData) {
  global.vectorStoreData = [];
}

export class VectorStore {
  static async addDocuments(docs: { text: string; metadata: any }[]) {
    // Process in one go through our batch function
    const texts = docs.map(d => d.text);
    const embeddings = await generateEmbeddingsBatch(texts, 'search_document');
    
    for (let i = 0; i < docs.length; i++) {
      global.vectorStoreData!.push({
        id: Math.random().toString(36).substring(7),
        text: docs[i].text,
        metadata: docs[i].metadata,
        embedding: embeddings[i],
      });
    }
  }

  static async search(query: string, limit: number = 5): Promise<(VectorDocument & { score: number })[]> {
    if (!global.vectorStoreData || global.vectorStoreData.length === 0) {
      return [];
    }

    const queryEmbedding = await generateEmbedding(query, 'search_query');

    const scoredDocs = global.vectorStoreData.map((doc) => ({
      ...doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding!),
    }));

    scoredDocs.sort((a, b) => b.score - a.score);
    return scoredDocs.slice(0, limit);
  }

  static clear() {
    global.vectorStoreData = [];
  }
  
  static getAll() {
      return global.vectorStoreData || [];
  }

  static getByFilePath(filePath: string): (VectorDocument & { score: number })[] {
    if (!global.vectorStoreData) return [];
    const normalize = (p: string) => p.replace(/\\/g, '/');
    const normalizedInput = normalize(filePath);
    return global.vectorStoreData
      .filter(doc => normalize(doc.metadata.path) === normalizedInput)
      .map(doc => ({ ...doc, score: 1.0 })); // Perfect score since it's a direct match
  }
}
