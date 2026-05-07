import OpenAI from 'openai';
import Groq from 'groq-sdk';

const ollama = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama', // No key needed for local Ollama
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function askLLMStream(systemPrompt: string, userPrompt: string) {
  let responseStream;
  let usedFallback = false;

  try {
    // 1. Try Groq (Primary — fast cloud inference)
    responseStream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: true,
    });
  } catch (err) {
    console.warn('Groq unavailable or failed, falling back to Ollama (local)...', err);
    usedFallback = true;
    
    // 2. Fallback to Ollama (Local)
    responseStream = await ollama.chat.completions.create({
      model: 'qwen3',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: true,
    });
  }

  // Convert the async iterable to a standard ReadableStream for Next.js
  // Buffers and strips <think>...</think> tags from any model's output
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';
        let thinkingDone = false;

        for await (const chunk of responseStream) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (!text) continue;

          if (thinkingDone) {
            // Already past any think block — stream directly
            controller.enqueue(new TextEncoder().encode(text));
            continue;
          }

          buffer += text;

          // Check if the closing </think> tag has appeared
          if (buffer.includes('</think>')) {
            // Take everything AFTER the </think> tag
            const afterThink = buffer.split('</think>').pop() || '';
            const cleaned = afterThink.trim();
            if (cleaned) {
              controller.enqueue(new TextEncoder().encode(cleaned));
            }
            buffer = '';
            thinkingDone = true;
          }
          // If no </think> yet but also no <think> detected, this model
          // doesn't use think tags — flush and stream normally
          else if (!buffer.includes('<think>') && buffer.length > 20) {
            controller.enqueue(new TextEncoder().encode(buffer));
            buffer = '';
            thinkingDone = true;
          }
          // Otherwise keep buffering (inside <think> block)
        }

        // Flush any remaining buffer
        if (buffer) {
          const cleaned = buffer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          if (cleaned) {
            controller.enqueue(new TextEncoder().encode(cleaned));
          }
        }

        controller.close();
      } catch (e) {
        controller.error(e);
      }
    }
  });

  return { stream, usedFallback };
}
