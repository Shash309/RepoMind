import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { Response } from 'express';
import { Mistral } from '@mistralai/mistralai';

const ollama = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama', // No key needed for local Ollama
});

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY || ''
});

const ollamaSystemPrompt = `You are a JSON API endpoint.
RULES YOU MUST FOLLOW WITHOUT EXCEPTION:
1. Your ENTIRE response must be a single valid JSON object
2. Start your response with { and end with }
3. Do NOT write any code (no const, let, for, if, function)
4. Do NOT write any explanation or prose
5. Do NOT use markdown or code fences
6. Do NOT use <think> tags
7. ONLY output the JSON structure requested

If you cannot comply, output exactly: {"error": "cannot comply"}
`;

let groqTokensUsedToday = 0;
let groqTokenResetTime = Date.now() + 24 * 60 * 60 * 1000;

const trackGroqUsage = (tokensUsed: number): boolean => {
  if (Date.now() > groqTokenResetTime) {
    groqTokensUsedToday = 0;
    groqTokenResetTime = Date.now() + 24 * 60 * 60 * 1000;
  }
  groqTokensUsedToday += tokensUsed;
  
  if (groqTokensUsedToday > 85000) {
    console.warn(`⚠️ Groq token usage: ${groqTokensUsedToday}/100000 — approaching daily limit, switching to Ollama proactively`);
    return true; // signal to skip Groq
  }
  return false;
};

let groqRateLimitedUntil = 0;

const isGroqRateLimited = (): boolean => Date.now() < groqRateLimitedUntil;

const markGroqRateLimited = (retryAfterSeconds?: string) => {
  const seconds = parseInt(retryAfterSeconds || '60', 10);
  groqRateLimitedUntil = Date.now() + (seconds * 1000);
  console.warn(`Groq marked as rate limited for ${seconds}s`);
};

const validateJSON = (raw: string) => {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  
  // Code indicator check
  const codeIndicators = [
    /^\s*const\s+/m,
    /^\s*let\s+/m,
    /^\s*var\s+/m,
    /^\s*for\s*\(/m,
    /^\s*if\s*\(/m,
    /^\s*function\s+/m,
    /^\s*return\s+/m,
  ];
  
  const looksLikeCode = codeIndicators.some(p => p.test(cleaned)) &&
    !cleaned.includes('"locations"') &&
    !cleaned.includes('"files"') &&
    !cleaned.includes('"intent"');
  
  if (looksLikeCode) {
    throw new Error('LLM returned code instead of JSON');
  }
  
  // Simple JSON boundary check
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  const lastBrace = cleaned.lastIndexOf('}');
  const lastBracket = cleaned.lastIndexOf(']');
  
  if ((firstBrace === -1 && firstBracket === -1) || (lastBrace === -1 && lastBracket === -1)) {
    throw new Error('No JSON object boundaries found in response');
  }
};

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
      temperature: 0.1,
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

export interface LLMOptions {
  jsonMode?: boolean;
  temperature?: number;
  expectJSON?: boolean;
}

export async function askLLM(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions | boolean = false,
  temperature = 0.1
): Promise<string> {
  let jsonMode = false;
  let expectJSON = false;
  let temp = temperature;

  if (typeof options === 'boolean') {
    jsonMode = options;
    expectJSON = options;
  } else if (options && typeof options === 'object') {
    jsonMode = !!options.jsonMode;
    expectJSON = !!options.expectJSON;
    if (options.temperature !== undefined) {
      temp = options.temperature;
    }
  }

  // 1. Groq (primary)
  if (groqTokensUsedToday > 90000) {
    console.warn('Skipping Groq — near daily limit, using Ollama');
  } else if (isGroqRateLimited()) {
    console.warn('Skipping Groq — rate limited, using Ollama');
  } else {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const rawResponse = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: temp,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
      }).asResponse();

      const remainingHeader = rawResponse.headers.get('x-ratelimit-remaining-tokens');
      const remaining = parseInt(remainingHeader || '99999');
      const used = 100000 - remaining; // approximate

      if (trackGroqUsage(used) || groqTokensUsedToday > 90000) {
        console.warn('Skipping Groq — near daily limit, using Ollama');
        throw new Error('PROACTIVE_FALLBACK');
      }

      const response = await rawResponse.json() as any;
      const result = response.choices[0]?.message?.content || '';

      if (expectJSON) {
        validateJSON(result);
      }

      return result;
    } catch (err: any) {
      if (err.message !== 'PROACTIVE_FALLBACK') {
        console.warn('Groq failed, falling back to Ollama...', err);
        if (err.status === 429 || err.statusCode === 429) {
          const retryAfter = err.headers?.get?.('retry-after') || err.headers?.['retry-after'] || '60';
          markGroqRateLimited(retryAfter);
        }
      }
    }
  }

  // 2. Ollama (fallback)
  try {
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt }
    ];

    const ollamaMessages = jsonMode ? [
      {
        role: 'system' as const,
        content: ollamaSystemPrompt
      },
      ...messages
    ] : messages;

    const response = await ollama.chat.completions.create({
      model: 'qwen3',
      messages: ollamaMessages,
      temperature: 0.1,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
    });
    const result = response.choices[0]?.message?.content || '';

    if (expectJSON) {
      validateJSON(result);
    }

    return result;
  } catch (err: any) {
    console.warn('Ollama failed, falling back to Mistral API...', err);
  }

  // 3. Mistral API (emergency fallback)
  try {
    const response = await mistral.chat.complete({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt }
      ],
      temperature: temp,
      responseFormat: jsonMode ? { type: 'json_object' } : undefined,
    });
    const content = response.choices?.[0]?.message?.content;
    const result = typeof content === 'string' ? content : '';

    if (expectJSON) {
      validateJSON(result);
    }

    return result;
  } catch (err) {
    console.error('Mistral API failed. All LLM providers exhausted.', err);
    throw new Error('All LLM providers unavailable: ' + (err instanceof Error ? err.message : String(err)));
  }
}
