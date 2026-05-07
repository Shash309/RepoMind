import { NextRequest } from 'next/server';
import { askLLMStream } from '../../../lib/llm';
import { VectorStore } from '../../../lib/vectorStore';
import { ChatMessage } from '../../../types';

const normalize = (p: string | null | undefined) => (p ?? '').replace(/\\/g, '/');

export async function POST(req: NextRequest) {
  try {
    const { messages, activeFile }: { messages: ChatMessage[]; activeFile?: string | null } = await req.json();

    if (!messages || messages.length === 0) {
      return new Response('No messages provided', { status: 400 });
    }

    const lastMessage = messages[messages.length - 1];
    const userMessage = lastMessage.content;
    const normalizedActiveFile = normalize(activeFile);

    // --- Active file context ---
    // If the user has a file open, fetch ALL its chunks (no cap)
    let activeFileChunks: any[] = [];
    if (normalizedActiveFile) {
      activeFileChunks = VectorStore.getByFilePath(normalizedActiveFile);
      console.log(`[ActiveFile] Received: "${normalizedActiveFile}" → matched ${activeFileChunks.length} chunks`);
      if (activeFileChunks.length === 0) {
        const allDocs = VectorStore.getAll();
        if (allDocs.length > 0) {
          console.log(`[ActiveFile] Sample stored path: "${normalize(allDocs[0].metadata.path)}"`);
          console.log(`[ActiveFile] Received path:      "${normalizedActiveFile}"`);
        }
      }
    }

    // --- Folder structure question detection ---
    const isFolderQuestion = /folder|structure|directory|layout|organized|overview|architecture|file tree/i.test(userMessage);
    
    let repoSummaryChunk: any[] = [];
    if (isFolderQuestion) {
      repoSummaryChunk = VectorStore.getByFilePath('__REPO_SUMMARY__').slice(0, 1);
    }

    // --- Query expansion for better similarity ---
    const expandedQuery = `${userMessage}\nrepository code codebase source files programming`;

    // Semantic search for additional context
    const semanticChunks = await VectorStore.search(expandedQuery, 15);

    // Deduplicate: remove semantic chunks already covered by activeFile or summary
    const usedIds = new Set([
      ...activeFileChunks.map((c: any) => c.id),
      ...repoSummaryChunk.map((c: any) => c.id),
    ]);
    const dedupedSemantic = semanticChunks
      .filter(c => !usedIds.has(c.id))
      .filter(c => normalize(c.metadata.path) !== normalizedActiveFile) // exclude active file from semantic
      .slice(0, 5);

    // Combine: summary first, then ALL active file chunks, then semantic extras
    const allRetrieved = [...repoSummaryChunk, ...activeFileChunks, ...dedupedSemantic].slice(0, 20);

    // --- Diagnostics ---
    console.log('--- CHAT DIAGNOSTICS ---');
    console.log(`User asked: "${userMessage}"`);
    if (normalizedActiveFile) console.log(`Active file: ${normalizedActiveFile} (${activeFileChunks.length} chunks injected)`);
    if (isFolderQuestion) console.log(`Folder question detected — repo summary injected`);
    console.log(`Retrieved ${allRetrieved.length} total chunks:`);
    allRetrieved.forEach((chunk, idx) => {
      console.log(`  [${idx + 1}] Score: ${chunk.score?.toFixed(4)} | File: ${chunk.metadata.path} (Chunk ${chunk.metadata.chunkIndex + 1})`);
    });
    console.log('------------------------');

    // Build the context block
    let contextBlock = "No relevant code found in the current session.";
    if (allRetrieved.length > 0) {
      contextBlock = allRetrieved.map(chunk => 
        `--- File: ${chunk.metadata.path} (Chunk ${chunk.metadata.chunkIndex + 1}/${chunk.metadata.totalChunks}) ---\n${chunk.text}\n`
      ).join('\n');
    }

    // Construct System and User Prompts
    const systemPrompt = `You are an expert code analyst embedded inside RepoMind.
When given code chunks from a repository, you explain them the way a sharp senior engineer would — direct, specific, and grounded in what is actually written.

## Your explanation style (follow this exactly):

Good example of how to explain a file:

'career_intelligence_engine.py is a pure scoring and ranking engine. It takes scores from 3 different assessment sources and combines them into a final ranked list of careers.

The functions in this file:

_safe_number() — Sanitizes any input number. Clamps it to 0–100, handles NaN/infinity, returns 50 as default if invalid.

_standardize_vectors() — Takes quiz, psych, and voice score dictionaries, unions all career keys across them, and builds parallel lists with 50 as default for any missing career.

_adaptive_weights() — Starts with fixed weights (quiz=0.4, psych=0.35, voice=0.25) but adjusts them based on variance in each signal. A flat signal gets its weight halved. A highly varied signal keeps full weight. Renormalizes so all weights sum to 1.

_cosine_similarity() — Standard cosine similarity between two numpy vectors, clamped to [0,1].

_agreement_metrics() — Measures how much the 3 signals agree using pairwise cosine similarity. Returns quiz_psych, quiz_voice, psych_voice, and an overall agreement score.

compute_final_decision() — The main function. Calls all the above, computes a weighted score per career, sorts them, then calculates a confidence score based on the gap between #1 and #2 AND how much the signals agree.'

## Rules you MUST follow:

1. Start with one sentence saying what the file/code IS and what it DOES
2. Then list only the functions/classes that are ACTUALLY in the chunks
3. For each function: name + one sharp sentence describing exactly what it does
4. Use concrete details from the actual code — variable names, constants, logic — not vague descriptions
5. NEVER invent functions, classes, or behaviour not shown in the chunks
6. NEVER say 'likely', 'probably', 'seems to', 'might', 'appears to'
7. NEVER say 'without seeing the full code' or 'based on context'
8. If chunks are insufficient, say exactly: 'I can see chunks [X] of this file. The following functions are visible: [list them]. For a complete explanation, select the file in the explorer and ask again.'
9. Do not output <think> tags or internal reasoning
10. No bullet points for function lists — use the dash format shown above

Relevant code chunks:
${contextBlock}
`;

    // Prepend active file context to the user prompt (internal only, not shown in UI)
    let augmentedUserMessage = userMessage;
    if (normalizedActiveFile) {
      augmentedUserMessage = `[Currently viewing file: ${normalizedActiveFile}]\n\n${userMessage}`;
    }

    // Optionally include recent chat history for context continuity
    let conversationHistory = messages.slice(-5, -1).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
    const userPrompt = `${conversationHistory ? `Conversation History:\n${conversationHistory}\n\n` : ''}User Question: ${augmentedUserMessage}`;

    // Send to Groq/Ollama and get streaming response
    const { stream, usedFallback } = await askLLMStream(systemPrompt, userPrompt);

    // Return stream to the frontend
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Fallback-Used': usedFallback ? 'true' : 'false',
      },
    });

  } catch (error: any) {
    console.error('Chat API Error:', error);
    return new Response(error.message, { status: 500 });
  }
}
