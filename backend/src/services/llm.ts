import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { Response } from 'express';

const ollama = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama', // No key needed for local Ollama
});

export async function askLLMStream(systemPrompt: string, userPrompt: string, res: Response) {
  let responseStream;
  let usedFallback = false;
  
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  try {
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
    
    responseStream = await ollama.chat.completions.create({
      model: 'qwen3', // Update model if necessary
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: true,
    });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Fallback-Used', usedFallback ? 'true' : 'false');
  res.flushHeaders();

  let buffer = '';
  let thinkingDone = false;

  try {
    for await (const chunk of responseStream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (!text) continue;

      if (thinkingDone) {
        res.write(text);
        continue;
      }

      buffer += text;

      if (buffer.includes('</think>')) {
        const afterThink = buffer.split('</think>').pop() || '';
        const cleaned = afterThink.trim();
        if (cleaned) {
          res.write(cleaned);
        }
        buffer = '';
        thinkingDone = true;
      } else if (!buffer.includes('<think>') && buffer.length > 20) {
        res.write(buffer);
        buffer = '';
        thinkingDone = true;
      }
    }

    if (buffer) {
      const cleaned = buffer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (cleaned) {
        res.write(cleaned);
      }
    }
  } catch (e) {
    console.error('LLM Stream Error:', e);
  } finally {
    res.end();
  }
}
