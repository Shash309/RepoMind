import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { askLLM } from '../services/llm';
import { VectorStore } from '../services/vectorStore';
import * as diff from 'diff';

const router = Router();

// Store original file contents in memory: rollbackId -> [{ path, content }]
const rollbackStore = new Map<string, Array<{ path: string; content: string | null }>>();

const safeParseJSON = (raw: string | null | undefined): any => {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Empty or non-string response');
  }
  
  let cleaned = raw;
  
  // Strip <think>...</think> tags (qwen3 model)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  
  // Strip markdown code fences
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  
  // Detect if response is code not JSON
  // JSON objects have "key": value pairs
  // Code blocks have const/let/var/for/if statements
  const codeIndicators = [
    /^\s*const\s+/m,
    /^\s*let\s+/m, 
    /^\s*var\s+/m,
    /^\s*for\s*\(/m,
    /^\s*if\s*\(/m,
    /^\s*function\s+/m,
    /^\s*return\s+/m,
  ];
  
  const looksLikeCode = codeIndicators.some(pattern => 
    pattern.test(cleaned)
  );
  
  if (looksLikeCode && !cleaned.includes('"locations"') 
      && !cleaned.includes('"files"')
      && !cleaned.includes('"intent"')) {
    throw new Error(
      'LLM returned code instead of JSON. ' +
      'Model did not follow JSON instruction.'
    );
  }
  
  // Find the first { or [ and last } or ]
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  
  let jsonStart = -1;
  if (firstBrace === -1 && firstBracket === -1) {
    throw new Error('No JSON object found in response');
  } else if (firstBrace === -1) {
    jsonStart = firstBracket;
  } else if (firstBracket === -1) {
    jsonStart = firstBrace;
  } else {
    jsonStart = Math.min(firstBrace, firstBracket);
  }
  
  const lastBrace = cleaned.lastIndexOf('}');
  const lastBracket = cleaned.lastIndexOf(']');
  const jsonEnd = Math.max(lastBrace, lastBracket);
  
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('Could not find JSON boundaries in response');
  }
  
  const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);
  
  try {
    return JSON.parse(jsonStr);
  } catch (err: any) {
    console.error('JSON parse failed on cleaned string:', 
      jsonStr.slice(0, 200));
    throw new Error(`JSON parse error: ${err.message}`);
  }
};

function getRepoPath(repoId: string): string {
  const repoName = repoId.split('/').pop()?.replace('.git', '') || 'unknown-repo';
  return path.join(process.cwd(), '.repos', repoName);
}

// Helpers for Stage 1 (Locate), Stage 2 (Plan), and Stage 3 (Execute)

function getAllRepositoryFiles(repoPath: string): Map<string, string> {
  const allFiles = new Map<string, string>();
  
  function traverse(dir: string) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      if (['node_modules', '.git', '.next', 'dist', 'build', '.repos'].includes(item)) {
        continue;
      }
      
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        traverse(fullPath);
      } else {
        const ext = path.extname(item).toLowerCase();
        if (['.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.json', '.md', '.py', '.go', '.java', '.c', '.cpp', '.h', '.cs', '.rs'].includes(ext)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const relPath = path.relative(repoPath, fullPath).replace(/\\/g, '/');
            allFiles.set(relPath, content);
          } catch (e) {
            // ignore
          }
        }
      }
    }
  }
  
  if (fs.existsSync(repoPath)) {
    traverse(repoPath);
  }
  return allFiles;
}

const findAnchorInFiles = (anchor: string, allFiles: Map<string, string>): string | null => {
  if (!anchor || anchor.trim().length < 5) return null;
  
  for (const [filePath, content] of allFiles.entries()) {
    if (content.includes(anchor)) {
      return filePath;
    }
  }
  
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normalizedAnchor = normalize(anchor);
  for (const [filePath, content] of allFiles.entries()) {
    if (normalize(content).includes(normalizedAnchor)) {
      return filePath;
    }
  }
  
  return null;
};

function findFunction(fileContent: string, funcName: string) {
  const regexes = [
    new RegExp(`\\bfunction\\s+${funcName}\\s*\\(`),
    new RegExp(`\\b(?:const|let|var)\\s+${funcName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`),
    new RegExp(`\\b(?:const|let|var)\\s+${funcName}\\s*=\\s*(?:async\\s*)?function`),
    new RegExp(`^\\s*${funcName}\\s*\\([^)]*\\)\\s*\\{`, 'm'),
    new RegExp(`^\\s*${funcName}\\s*:\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`, 'm')
  ];

  for (const regex of regexes) {
    const match = fileContent.match(regex);
    if (match && match.index !== undefined) {
      const beforeMatch = fileContent.substring(0, match.index);
      const lineHint = beforeMatch.split('\n').length;
      
      const endOfLine = fileContent.indexOf('\n', match.index);
      const currentCode = fileContent.substring(match.index, endOfLine !== -1 ? endOfLine : match.index + 100);
      
      return {
        function: funcName,
        lineHint,
        currentCode: currentCode.trim(),
        changeType: 'replace',
        reason: `Found function ${funcName}`
      };
    }
  }
  return null;
}

function findEndOfBlock(fileContent: string, insertPoint: number): number {
  let openBraces = 0;
  let hasOpened = false;
  
  for (let i = insertPoint; i < fileContent.length; i++) {
    const char = fileContent[i];
    if (char === '{') {
      openBraces++;
      hasOpened = true;
    } else if (char === '}') {
      openBraces--;
      if (hasOpened && openBraces === 0) {
        return i + 1;
      }
    }
  }
  
  const nextDoubleNewline = fileContent.indexOf('\n\n', insertPoint);
  if (nextDoubleNewline !== -1) {
    return nextDoubleNewline;
  }
  return fileContent.length;
}

const findChangeLocations = (fileContent: string, changeRequest: string) => {
  const request = changeRequest.toLowerCase();
  const locations: any[] = [];

  const aboveFunctionMatch = request.match(
    /above (?:the )?([a-zA-Z_$][\w$]*)\s*(?:function)?/
  );
  if (aboveFunctionMatch) {
    const funcName = aboveFunctionMatch[1];
    const funcLocation = findFunction(fileContent, funcName);
    if (funcLocation) {
      locations.push({
        ...funcLocation,
        type: 'insert_before',
        reason: `Insert above function ${funcName}`
      });
    }
  }
  
  const addToFunctionMatch = request.match(
    /add (.+) to (?:the )?(\w+)\s*(?:function)?/
  );
  if (addToFunctionMatch) {
    const funcName = addToFunctionMatch[2];
    const funcLocation = findFunction(fileContent, funcName);
    if (funcLocation) locations.push(funcLocation);
  }
  
  const removeMatch = request.match(/remove|delete (.+)/);
  if (removeMatch) {
    const target = removeMatch[1];
    const targetLocation = fileContent.indexOf(target);
    if (targetLocation > -1) {
      locations.push({
        type: 'delete',
        position: targetLocation,
        function: 'GLOBAL SCOPE',
        lineHint: fileContent.substring(0, targetLocation).split('\n').length,
        currentCode: target,
        reason: `Remove ${target}`
      });
    }
  }
  
  const replaceMatch = request.match(/replace (.+) with (.+)/);
  if (replaceMatch) {
    const target = replaceMatch[1];
    const targetLocation = fileContent.indexOf(target);
    if (targetLocation > -1) {
      locations.push({
        type: 'replace',
        position: targetLocation,
        function: 'GLOBAL SCOPE',
        lineHint: fileContent.substring(0, targetLocation).split('\n').length,
        currentCode: target,
        reason: `Replace ${target} with ${replaceMatch[2]}`
      });
    }
  }
  
  const newFunctionMatch = request.match(/add (?:a )?(?:new )?function/);
  if (newFunctionMatch) {
    const lastExport = fileContent.lastIndexOf('export function');
    const position = lastExport !== -1 ? lastExport : fileContent.length;
    locations.push({
      type: 'insert_after',
      position: position,
      function: 'GLOBAL SCOPE',
      lineHint: fileContent.substring(0, position).split('\n').length,
      currentCode: lastExport !== -1 ? 'export function' : '',
      reason: 'New function added after last existing function'
    });
  }
  
  return locations;
};

const getConfidence = (fileContent: string, currentCode: string, funcName: string): 'HIGH' | 'MEDIUM' | 'LOW' => {
  if (!fileContent) return 'LOW';
  if (currentCode && fileContent.includes(currentCode)) {
    if (currentCode.includes('...')) {
      return 'MEDIUM';
    }
    return 'HIGH';
  }
  
  if (funcName && funcName !== 'GLOBAL SCOPE' && funcName !== 'GLOBAL') {
    const funcRegex = new RegExp(`\\b(?:function\\s+${funcName}\\b|(?:const|let|var|export)\\s+${funcName}\\b\\s*=)`);
    if (funcRegex.test(fileContent)) {
      return 'MEDIUM';
    }
  }
  
  return 'LOW';
};

const isValidAnchor = (anchor: string | null, fileContent: string): boolean => {
  if (!anchor) return false;
  if (typeof anchor !== 'string') return false;
  
  // Block ANY form of truncation
  if (anchor.includes('...')) return false;
  if (anchor.includes('…')) return false; // unicode ellipsis
  if (anchor.endsWith('|')) return false; // mid-line cut
  if (anchor.endsWith(',')) return false; // mid-statement cut
  if (anchor.endsWith('(')) return false; // mid-expression cut
  
  // Must actually exist in file
  if (!fileContent.includes(anchor)) return false;
  
  // Must be at least 20 chars (too short = not unique enough)
  if (anchor.trim().length < 20) return false;
  
  return true;
};

const applyFunctionLevelReplacement = async (
  fileContent: string, 
  funcName: string, 
  changeReason: string,
  newCode?: string
): Promise<string> => {
  // Extract complete function
  const lines = fileContent.split('\n');
  const funcStartIdx = lines.findIndex(line =>
    line.includes(`function ${funcName}`) ||
    line.includes(`${funcName} =`) ||
    line.includes(`${funcName}(`)
  );
  if (funcStartIdx === -1) return fileContent;
  
  let depth = 0, started = false, funcEndIdx = funcStartIdx;
  for (let i = funcStartIdx; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === '{') { depth++; started = true; }
      if (char === '}') depth--;
    }
    if (started && depth === 0) { funcEndIdx = i; break; }
  }
  
  const originalFunc = lines
    .slice(funcStartIdx, funcEndIdx + 1)
    .join('\n');
  
  console.log(`Function-level replacement for ${funcName}: ${originalFunc.length} chars`);
  
  const systemPrompt = `You are a senior software engineer modifying a single function.
Modify the function body to satisfy the change request.
Return ONLY the modified function, no explanation, no markdown, no code fences.`;

  const userPrompt = `Original function:
${originalFunc}

Change request: ${changeReason}
${newCode ? `New code to integrate: ${newCode}` : ''}`;
  
  let generated = await askLLM(systemPrompt, userPrompt, false, 0.1);
  const modifiedFunc = generated
    .replace(/```[\w]*/g, '')
    .replace(/```/g, '')
    .trim();
  
  // Replace original function with modified version
  return fileContent.replace(originalFunc, modifiedFunc);
};

export const findExactAnchor = async (fileContent: string, funcName: string, reason: string): Promise<string | null> => {
  const lines = fileContent.split('\n');
  
  // Find function start
  const funcStartIdx = lines.findIndex(line =>
    line.includes(`function ${funcName}`) ||
    line.includes(`${funcName} =`) ||
    line.includes(`${funcName}(`)
  );
  
  if (funcStartIdx === -1) return null;
  
  // Find function end using brace counting
  let depth = 0;
  let funcEndIdx = funcStartIdx;
  let started = false;
  
  for (let i = funcStartIdx; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === '{') { depth++; started = true; }
      if (char === '}') depth--;
    }
    if (started && depth === 0) {
      funcEndIdx = i;
      break;
    }
  }
  
  // Score lines by relevance to the reason
  const reasonKeywords = reason.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3);
  
  const funcLines = lines.slice(funcStartIdx, funcEndIdx + 1);
  
  const scoredLines = funcLines.map((line, idx) => ({
    line,
    absoluteIdx: funcStartIdx + idx,
    score: reasonKeywords.filter(kw =>
      line.toLowerCase().includes(kw)
    ).length
  }))
  .filter(l => l.score > 0 && l.line.trim().length > 0)
  .sort((a, b) => b.score - a.score);
  
  if (scoredLines.length === 0) {
    // Return first 3 complete lines of function as fallback
    return funcLines.slice(0, 3).join('\n');
  }
  
  // Return best matching line + 2 lines context
  // ALWAYS complete lines, never mid-line slices
  const bestIdx = scoredLines[0].absoluteIdx;
  const start = Math.max(funcStartIdx, bestIdx - 1);
  const end = Math.min(funcEndIdx, bestIdx + 2);
  
  // Join COMPLETE lines only
  const anchor = lines.slice(start, end + 1).join('\n');
  
  // Final safety check — no truncation markers
  if (anchor.includes('...') || anchor.includes('…')) {
    console.error('Extraction produced truncated anchor — using function signature instead');
    return lines[funcStartIdx]; // just the signature line
  }
  
  return anchor;
};

export const validateAndFixAnchors = async (plan: any, repoBasePath: string) => {
  const validationIssues: any[] = [];
  
  if (!plan || !plan.files) return { valid: true, issues: [] };
  
  for (const file of plan.files) {
    const fullPath = path.join(repoBasePath, file.path);
    if (!fs.existsSync(fullPath)) continue;
    
    const content = fs.readFileSync(fullPath, 'utf8');
    
    if (file.changes) {
      for (const change of file.changes) {
        if (!change.currentCode) continue;
        
        const exactMatch = content.includes(change.currentCode);
        const hasTruncation = change.currentCode.includes('...');
        
        if (hasTruncation) {
          validationIssues.push({
            file: file.path,
            function: change.function,
            problem: 'Anchor contains truncation (...)',
            severity: 'high'
          });
          
          console.log(`Auto-healing truncated anchor in ${file.path} for ${change.function}...`);
          try {
            const healed = await findExactAnchor(content, change.function, change.reason);
            const healedAnchor = healed || '';
            if (isValidAnchor(healedAnchor, content)) {
              console.log(`✅ Healed anchor successfully: "${healedAnchor.slice(0, 40)}..."`);
              change.currentCode = healedAnchor;
            } else {
              console.error('Healed anchor still invalid:', healedAnchor.slice(0, 80));
              
              // Last resort: use entire function as anchor
              // and do function-level replacement instead
              console.log('Falling back to function-level replacement');
              change.usesFunctionLevel = true;
            }
          } catch (err) {
            console.error('Failed to auto-heal anchor:', err);
          }
        } else if (!exactMatch) {
          validationIssues.push({
            file: file.path,
            function: change.function,
            problem: 'Anchor not found in file',
            severity: 'medium'
          });
        }
      }
    }
  }
  
  return { valid: validationIssues.length === 0, issues: validationIssues };
};

const generateSnippetChange = async (originalFunc: string, reason: string, newCode: string): Promise<string> => {
  const systemPrompt = `You are a senior software engineer modifying a single function.
Modify the function body to satisfy the change request.
Return ONLY the modified function body.
No explanation. No markdown. No code fences. Raw code only.`;
  const userPrompt = `Function to modify:
${originalFunc}

Change request: ${reason}
New code to integrate: ${newCode}`;

  let generated = await askLLM(systemPrompt, userPrompt, false, 0.1);
  let cleaned = generated.trim();
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    if (lines[0].startsWith('```')) {
      lines.shift();
    }
    if (lines[lines.length - 1].startsWith('```')) {
      lines.pop();
    }
    cleaned = lines.join('\n');
  }
  return cleaned;
};

export const applyFunctionLevelChange = async (fileContent: string, change: any): Promise<string> => {
  const funcRegex = new RegExp(
    `\\b(?:function\\s+${change.function}\\b|(?:const|let|var|export)\\s+${change.function}\\b\\s*=)`,
    'g'
  );
  
  const match = funcRegex.exec(fileContent);
  if (!match) {
    console.error(`Function ${change.function} not found in file`);
    return fileContent;
  }
  
  // Find the opening brace of the function body
  let idx = match.index;
  let openBraceIndex = fileContent.indexOf('{', idx);
  if (openBraceIndex === -1) return fileContent;

  // Find the end of the function using brace counting starting from the opening brace
  let depth = 1;
  let i = openBraceIndex + 1;
  let funcEnd = -1;
  
  while (i < fileContent.length) {
    if (fileContent[i] === '{') depth++;
    if (fileContent[i] === '}') {
      depth--;
      if (depth === 0) {
        funcEnd = i + 1;
        break;
      }
    }
    i++;
  }
  
  if (funcEnd === -1) return fileContent;
  
  const funcStart = match.index;
  const originalFunc = fileContent.slice(funcStart, funcEnd);
  console.log(`Found function ${change.function}, length: ${originalFunc.length} chars`);
  
  const modifiedFunc = await generateSnippetChange(
    originalFunc,
    change.reason,
    change.newCode
  );
  
  return fileContent.slice(0, funcStart) + 
         modifiedFunc + 
         fileContent.slice(funcEnd);
};

export const applySurgicalChange = async (fileContent: string, change: any): Promise<string> => {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normalizedContent = normalize(fileContent);
  const normalizedCurrent = normalize(change.currentCode);

  const escapeRegex = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // First try exact match
  if (change.currentCode && fileContent.includes(change.currentCode)) {
    console.log('✅ Exact match found');
    if (change.type === 'replace') {
      return fileContent.replace(change.currentCode, change.newCode);
    } else if (change.type === 'insert_after') {
      const idx = fileContent.indexOf(change.currentCode);
      const endOfBlock = findEndOfBlock(fileContent, idx);
      return fileContent.slice(0, endOfBlock) + '\n\n' + change.newCode + fileContent.slice(endOfBlock);
    } else if (change.type === 'insert_before') {
      return fileContent.replace(change.currentCode, change.newCode + '\n\n' + change.currentCode);
    } else if (change.type === 'delete') {
      return fileContent.replace(change.currentCode, '');
    }
  }

  // Try flexible whitespace match
  if (change.currentCode) {
    const flexPattern = escapeRegex(change.currentCode.trim()).replace(/\s+/g, '\\s+');
    const flexRegex = new RegExp(flexPattern);

    if (flexRegex.test(fileContent)) {
      console.log('✅ Fuzzy match found, using regex replace');
      if (change.type === 'replace') {
        return fileContent.replace(flexRegex, change.newCode);
      } else if (change.type === 'insert_after') {
        const match = fileContent.match(flexRegex);
        if (match && match.index !== undefined) {
          const endOfBlock = findEndOfBlock(fileContent, match.index);
          return fileContent.slice(0, endOfBlock) + '\n\n' + change.newCode + fileContent.slice(endOfBlock);
        }
        return fileContent.replace(flexRegex, `$&\n\n${change.newCode}`);
      } else if (change.type === 'insert_before') {
        return fileContent.replace(flexRegex, `${change.newCode}\n\n$&`);
      } else if (change.type === 'delete') {
        return fileContent.replace(flexRegex, '');
      }
    }
  }

  // Final fallback: function-level replacement
  if (change.function && change.function !== 'GLOBAL SCOPE' && change.function !== 'GLOBAL') {
    console.warn(`⚠️ Anchor not found, falling back to function-level replacement for ${change.function}`);
    return await applyFunctionLevelChange(fileContent, change);
  }

  // Log all function names in file to help debug
  const funcs = [...fileContent.matchAll(
    /function\s+(\w+)|const\s+(\w+)\s*=/g
  )].map(m => m[1] || m[2]);
  
  console.error('❌ All matching strategies failed for:', change.currentCode?.slice(0, 80));
  console.error('Functions available in file:', funcs);
  console.error('Change was targeting function:', change.function);

  // Don't throw — skip this change and return fileContent unchanged
  return fileContent;
};

export const validateModifiedCode = (original: string, modified: string) => {
  const issues: string[] = [];
  
  if (modified.length < original.length * 0.5) {
    issues.push('File is suspiciously short — possible truncation');
  }
  
  if (modified.includes('```')) {
    issues.push('Contains markdown fences — stripping');
    modified = modified.replace(/```[\w]*/g, '').replace(/```/g, '').trim();
  }
  
  const openBraces = (modified.match(/\{/g) || []).length;
  const closeBraces = (modified.match(/\}/g) || []).length;
  if (Math.abs(openBraces - closeBraces) > 2) {
    issues.push(
      `Brace mismatch: ${openBraces} open vs ${closeBraces} close`
    );
  }
  
  // Extract all function parameters to exclude from orphan check
  const parameterNames = new Set<string>();
  const paramMatches = modified.matchAll(
    /function\s+\w+\s*\(([^)]*)\)|=>\s*\(([^)]*)\)|\(([^)]*)\)\s*=>/g
  );
  for (const match of paramMatches) {
    const params = (match[1] || match[2] || match[3] || '')
      .split(',')
      .map(p => p.trim()
        .split('=')[0]  // remove default values
        .split(':')[0]  // remove TypeScript types
        .trim()
      )
      .filter(Boolean);
    params.forEach(p => parameterNames.add(p));
  }
  
  console.log('Detected parameters (excluded from orphan check):', 
    [...parameterNames]);

  // Also extract all imported names
  const importedNames = new Set<string>();
  const importMatches = modified.matchAll(
    /import\s+{([^}]*)}\s+from|import\s+(\w+)\s+from/g
  );
  for (const match of importMatches) {
    const names = (match[1] || match[2] || '')
      .split(',')
      .map(n => n.trim().split(' as ')[0].trim())
      .filter(Boolean);
    names.forEach(n => importedNames.add(n));
  }

  const ALWAYS_SAFE = new Set([
    'random',      // common parameter name
    'callback',    // common parameter name  
    'resolve',     // Promise parameter
    'reject',      // Promise parameter
    'next',        // Express middleware parameter
    'err',         // error callback parameter
    'done',        // callback parameter
    'fn',          // function parameter
    'handler',     // common parameter name
  ]);

  // Extract all globally known names to whitelist
  const globallyKnown = new Set<string>([
    // JS keywords and control structures
    'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof',
    'import', 'export', 'super', 'define', 'requirejs',
    // JS built-ins
    'Math', 'Object', 'Array', 'String', 'Number', 'Boolean',
    'Promise', 'Set', 'Map', 'JSON', 'console', 'process',
    'Error', 'Date', 'RegExp', 'Symbol', 'parseInt', 'parseFloat',
    'isNaN', 'isFinite', 'setTimeout', 'setInterval', 'clearInterval',
    'clearTimeout', 'fetch', 'require', 'module', 'exports',
    'Buffer', 'crypto', 'fs', 'path',
    // Common patterns
    'undefined', 'null', 'true', 'false', 'NaN', 'Infinity',
    ...parameterNames,
    ...importedNames,
    ...ALWAYS_SAFE,
  ]);

  // Now check for orphaned calls excluding all known names
  const functionCalls = [...modified.matchAll(/\b(\w+)\s*\(/g)]
    .map(m => m[1])
    .filter(name => !globallyKnown.has(name));

  const functionDefs = new Set<string>([
    ...[...modified.matchAll(/function\s+(\w+)/g)].map(m => m[1]),
    ...[...modified.matchAll(/const\s+(\w+)\s*=/g)].map(m => m[1]),
    ...[...modified.matchAll(/let\s+(\w+)\s*=/g)].map(m => m[1]),
    ...[...modified.matchAll(/var\s+(\w+)\s*=/g)].map(m => m[1]),
  ]);

  const orphaned = functionCalls.filter(
    call => !functionDefs.has(call)
  );

  if (orphaned.length > 0) {
    orphaned.forEach(name => {
      // Find the line where it's called
      const lines = modified.split('\n');
      const callLines = lines
        .map((line, i) => ({ line, num: i + 1 }))
        .filter(({ line }) => new RegExp(`\\b${name}\\s*\\(`).test(line));
      
      console.warn(`Flagged '${name}' called at:`, 
        callLines.map(l => `line ${l.num}: ${l.line.trim()}`));
    });

    // Extra filter: only flag if it's called MORE than once
    // (single calls are likely valid external references)
    const trulyOrphaned = orphaned.filter(name => {
      const occurrences = (modified.match(
        new RegExp(`\\b${name}\\s*\\(`, 'g')
      ) || []).length;
      return occurrences > 1 && !globallyKnown.has(name);
    });

    if (trulyOrphaned.length > 0) {
      issues.push(
        `Possibly undefined functions called: ${trulyOrphaned.join(', ')}`
      );
    }
  }

  return { valid: issues.length === 0, issues, modified };
};

function getEnclosingFunction(content: string | null, startLine: number): string | null {
  if (!content) return null;
  const lines = content.split('\n');
  
  const startIndex = Math.min(startLine - 1, lines.length - 1);
  
  const functionRegexes = [
    /\bfunction\s+([a-zA-Z0-9_$]+)\s*\(/,
    /\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(.*?\)\s*=>/,
    /\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?function/,
    /^\s*([a-zA-Z0-9_$]+)\s*\(.*?\)\s*\{/,
    /^\s*([a-zA-Z0-9_$]+)\s*:\s*(?:async\s*)?\(.*?\)\s*=>/
  ];

  for (let i = startIndex; i >= 0; i--) {
    const line = lines[i].trim();
    
    if (line.startsWith('if ') || line.startsWith('if(') || 
        line.startsWith('for ') || line.startsWith('for(') || 
        line.startsWith('while ') || line.startsWith('while(') || 
        line.startsWith('switch ') || line.startsWith('switch(') ||
        line.startsWith('catch ') || line.startsWith('catch(')) {
      continue;
    }

    for (const regex of functionRegexes) {
      const match = line.match(regex);
      if (match && match[1]) {
        return match[1] + '()';
      }
    }
  }
  return null;
}

// 1. Generate change plan
router.post('/plan', async (req: Request, res: Response): Promise<any> => {
  try {
    const { userRequest, repoId } = req.body;
    if (!userRequest || !repoId) {
      return res.status(400).json({ error: 'userRequest and repoId are required' });
    }

    const repoPath = getRepoPath(repoId);
    if (!fs.existsSync(repoPath)) {
      return res.status(404).json({ error: `Repository path not found on disk: ${repoPath}` });
    }

    const semanticChunks = await VectorStore.search(userRequest, 15);
    const contextBlock = semanticChunks
      .map(chunk => `--- File: ${chunk.metadata.path} ---\n${chunk.text}\n`)
      .join('\n');

    // STAGE 1: LOCATE
    // Run smart pattern detectors on relevant files
    const normalizeFilePath = (p?: string) => p?.replace(/\\/g, '/') ?? '';
    const affectedFiles = Array.from(
      new Set(semanticChunks.map(chunk => normalizeFilePath(chunk.metadata.path)).filter(Boolean))
    );
    const requestTokens = Array.from(new Set<string>(
      userRequest
        .match(/[a-zA-Z_$][\w$]*/g)
        ?.filter((token: string) => token.length > 3 && ![
          'above', 'comment', 'function', 'explaining', 'what', 'does',
          'add', 'the', 'this', 'that', 'with', 'from', 'into'
        ].includes(token.toLowerCase())) || []
    ));
    const repositoryFilesForLocate = getAllRepositoryFiles(repoPath);
    for (const [relPath, content] of repositoryFilesForLocate.entries()) {
      if (requestTokens.some(token => content.includes(token)) && !affectedFiles.includes(relPath)) {
        affectedFiles.push(relPath);
      }
    }
    const fileContents: Record<string, string> = {};

    for (const filePath of affectedFiles) {
      const fullPath = path.join(repoPath, normalizeFilePath(filePath));
      if (fs.existsSync(fullPath)) {
        fileContents[filePath] = fs.readFileSync(fullPath, 'utf8');
        console.log('Loaded actual content for:', filePath, fileContents[filePath].length, 'chars');
      }
    }

    const patternLocations: any[] = [];
    
    for (const relPath of affectedFiles) {
      const fileContent = fileContents[relPath];
      if (!fileContent) continue;
      const localLocations = findChangeLocations(fileContent, userRequest);
      for (const loc of localLocations) {
        patternLocations.push({
          file: relPath,
          function: loc.function || 'GLOBAL SCOPE',
          lineHint: loc.lineHint || 1,
          currentCode: loc.currentCode || '',
          reason: loc.reason || 'Pattern matched location',
          changeType: loc.type || 'replace'
        });
      }
    }

    // Call Groq for AI location analysis
    const locationSystemPrompt = `You are a code location expert. Your ONLY job is to find 
exactly where a change needs to happen in this codebase.

Change request: '${userRequest}'

CRITICAL RULE FOR currentCode:
You must copy the EXACT code from the file character for character.
Do NOT use '...' or any placeholder.
Do NOT summarize or paraphrase.
Do NOT truncate with ellipsis.

If the anchor is a return statement, copy the ENTIRE return 
statement exactly as it appears — every field, every comma.

BAD example:
  'currentCode': 'return { ... };'

GOOD example:  
  'currentCode': 'return {\\n    ...state,\\n    snake: nextSnake,\\n    direction,\\n    food: ateFood ? getRandomFreeCell(state.gridSize, nextSnake, random) : state.food,\\n    score: ateFood ? state.score + 1 : state.score\\n  };'

The currentCode must be long enough to be UNIQUE in the file.
Copy at minimum 3-5 lines of actual code.
If in doubt, copy more — never less.

Analyze the code and return ONLY this JSON, nothing else:
{
  "locations": [
    {
      "file": "src/snake-game.js",
      "function": "stepGame",
      "lineHint": 45,
      "currentCode": "exact code snippet that needs changing",
      "reason": "why this location needs to change",
      "changeType": "replace | insert_after | insert_before | delete"
    }
  ],
  "dependencies": [
    "list any relationships between changes",
    "e.g. stepGame calls hitsWall — removing it affects stepGame"
  ],
  "conflictingLogic": [
    "list any existing logic that conflicts with the new change",
    "e.g. hitsWall death check conflicts with wrap-around"
  ],
  "newFunctionsNeeded": [
    "list any new functions that must be defined",
    "e.g. wrapAround() must be defined if called"
  ]
}`;

    const locationUserPrompt = `
ACTUAL FILE CONTENTS (copy code EXACTLY from these):
${Object.entries(fileContents).map(([filePath, content]) => `
=== ${filePath} ===
${content}
`).join('\n')}

CRITICAL RULES for currentCode field:
1. Copy code CHARACTER FOR CHARACTER from the files above
2. NEVER invent or paraphrase code
3. NEVER use '...' or placeholders of any kind
4. Copy minimum 2-3 full lines to ensure uniqueness
5. Include 'export' keyword if present in the original
6. Use the exact parameter names from the actual signature
7. If you cannot find the exact code, say so in the reason field
   and leave currentCode as an empty string

Relevant code chunks:
${contextBlock}

User Request: ${userRequest}`;
    const locationResultText = await askLLM(locationSystemPrompt, locationUserPrompt, { jsonMode: true, temperature: 0.1, expectJSON: true });

    let aiAnalysis: any = { locations: [], dependencies: [], conflictingLogic: [], newFunctionsNeeded: [] };
    try {
      aiAnalysis = safeParseJSON(locationResultText);
    } catch (e) {
      const match = locationResultText.match(/\{[\s\S]*\}/);
      if (match) {
        aiAnalysis = safeParseJSON(match[0]);
      }
    }

    const getFileContentForLocation = (filePath?: string) => {
      const normalized = normalizeFilePath(filePath);
      return fileContents[normalized] || fileContents[filePath || ''];
    };

    const verifyLocationAnchors = (locations: any[]) => {
      for (const location of locations) {
        location.file = normalizeFilePath(location.file);
        const fileContent = getFileContentForLocation(location.file);
        if (!fileContent || !location.currentCode) continue;
        
        const exactMatch = fileContent.includes(location.currentCode);
        
        if (!exactMatch) {
          console.error('Hallucinated anchor detected:', {
            file: location.file,
            function: location.function,
            anchor: location.currentCode.slice(0, 100),
          });
          
          // Auto-fix: find real function signature from file
          const lines = fileContent.split('\n');
          const realLine = lines.find(line =>
            line.includes(`function ${location.function}`) ||
            line.includes(`${location.function} =`)
          );
          
          if (realLine) {
            console.log('Auto-corrected anchor to:', realLine.trim());
            location.currentCode = realLine.trim();
            location.confidence = 'HIGH';
          } else {
            console.error('Could not auto-fix anchor for:', location.function);
            // Mark as low confidence so UI can warn user
            location.confidence = 'LOW';
          }
        } else {
          console.log('✅ Anchor verified for:', location.function);
          location.confidence = 'HIGH';
        }
      }
    };

    verifyLocationAnchors(aiAnalysis.locations || []);

    // Merge Stage 1 Location results
    const mergedLocations = [...patternLocations];
    const aiLocations = aiAnalysis.locations || [];
    for (const aiLoc of aiLocations) {
      aiLoc.file = normalizeFilePath(aiLoc.file);
      aiLoc.changeType = aiLoc.changeType || aiLoc.type || 'replace';
      const isDuplicate = mergedLocations.some(loc => 
        loc.file === aiLoc.file && 
        (loc.currentCode === aiLoc.currentCode || (loc.function === aiLoc.function && Math.abs(loc.lineHint - aiLoc.lineHint) < 3))
      );
      if (!isDuplicate) {
        mergedLocations.push(aiLoc);
      }
    }

    verifyLocationAnchors(mergedLocations);

    const locationAnalysis = {
      locations: mergedLocations,
      dependencies: aiAnalysis.dependencies || [],
      conflictingLogic: aiAnalysis.conflictingLogic || [],
      newFunctionsNeeded: aiAnalysis.newFunctionsNeeded || []
    };

    // STAGE 2: PLAN
    const planningSystemPrompt = `You are a senior engineer creating a change plan.

Change request: '${userRequest}'

Location analysis already identified exactly where changes are needed:
${JSON.stringify(locationAnalysis, null, 2)}

Rules:
- Create one change item per identified location
- Do not invent new locations
- Do not miss any identified location
- If conflictingLogic exists, add explicit DELETE change items
- If newFunctionsNeeded exists, add explicit INSERT change items

CRITICAL RULE FOR currentCode:
You must copy the EXACT code from the file character for character.
Do NOT use '...' or any placeholder.
Do NOT summarize or paraphrase.
Do NOT truncate with ellipsis.

If the anchor is a return statement, copy the ENTIRE return 
statement exactly as it appears — every field, every comma.

BAD example:
  'currentCode': 'return { ... };'

GOOD example:  
  'currentCode': 'return {\\n    ...state,\\n    snake: nextSnake,\\n    direction,\\n    food: ateFood ? getRandomFreeCell(state.gridSize, nextSnake, random) : state.food,\\n    score: ateFood ? state.score + 1 : state.score\\n  };'

The currentCode must be long enough to be UNIQUE in the file.
Copy at minimum 3-5 lines of actual code.
If in doubt, copy more — never less.

Before finalizing the plan, ask yourself:
1. Does this change require NEW helper functions?
   If yes — add them as insert_after change items
2. Does this change conflict with EXISTING logic?
   If yes — add explicit delete items for the conflicting code
3. Does this change affect object initialization?
   If yes — find every place that object is created and list it

Return plan as JSON matching this format:
{
  "intent": "one sentence describing the full change",
  "scope": "small | medium | large",
  "files": [
    {
      "path": "src/snake-game.js",
      "action": "modify",
      "reason": "why this file changes",
      "changes": [
        {
          "function": "stepGame",
          "currentCode": "exact current code to find and replace",
          "newCode": "exact replacement code",
          "type": "replace | insert_before | insert_after | delete",
          "reason": "why this specific change is needed",
          "lineHint": 45
        }
      ]
    }
  ],
  "warnings": [
    "any risks or things the user should know before proceeding"
  ],
  "estimatedChanges": {
    "filesModified": 0,
    "filesCreated": 0,
    "filesDeleted": 0
  }
}`;

    const planningUserPrompt = `Relevant code chunks:\n${contextBlock}\n\nUser Request: ${userRequest}`;
    const planningResultText = await askLLM(planningSystemPrompt, planningUserPrompt, { jsonMode: true, temperature: 0.1, expectJSON: true });

    let plan: any;
    try {
      plan = safeParseJSON(planningResultText);
    } catch (parseErr) {
      const match = planningResultText.match(/\{[\s\S]*\}/);
      if (match) {
        plan = safeParseJSON(match[0]);
      } else {
        throw new Error('Failed to parse planning response as JSON: ' + planningResultText);
      }
    }

    // Preserve verified LOCATE anchors if PLAN drops or mutates them.
    if (plan && plan.files) {
      for (const file of plan.files) {
        const normalizedPlanPath = normalizeFilePath(file.path);
        if (file.changes) {
          for (const change of file.changes) {
            const matchedLocation = locationAnalysis.locations.find((location: any) =>
              normalizeFilePath(location.file) === normalizedPlanPath &&
              location.function === change.function &&
              location.currentCode
            );
            const fileContent = getFileContentForLocation(normalizedPlanPath);
            const hasVerifiedAnchor = change.currentCode && fileContent?.includes(change.currentCode);
            if (matchedLocation && !hasVerifiedAnchor) {
              console.log('Restored verified LOCATE anchor for:', change.function);
              change.currentCode = matchedLocation.currentCode;
              change.lineHint = change.lineHint || matchedLocation.lineHint || 1;
              change.type = change.type || matchedLocation.type || matchedLocation.changeType || 'replace';
              change.confidence = matchedLocation.confidence || 'HIGH';
            }
          }
        }
      }
    }

    // Validate and auto-heal anchors
    await validateAndFixAnchors(plan, repoPath);

    // Annotate changes with confidence levels
    if (plan && plan.files) {
      for (const file of plan.files) {
        const filePath = path.resolve(repoPath, file.path);
        const fileContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        if (file.changes) {
          for (const change of file.changes) {
            change.confidence = getConfidence(fileContent, change.currentCode, change.function);
          }
        }
      }
    }

    res.json(plan);
  } catch (error: any) {
    console.error('Plan Generation Error:', error);
    if (error.message && error.message.includes('All LLM providers unavailable')) {
      return res.status(503).json({
        error: "AI providers temporarily unavailable",
        message: "Groq daily limit reached and Ollama is not running. Options: wait 21 minutes for Groq to reset, run 'ollama serve' in terminal, or add MISTRAL_API_KEY to .env",
        retryAfter: 1268
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// 2. Generate code modifications & structured diffs in memory (NO disk writes)
router.post('/generate', async (req: Request, res: Response): Promise<any> => {
  try {
    const { plan, repoId } = req.body;
    if (!plan || !repoId) {
      return res.status(400).json({ error: 'plan and repoId are required' });
    }

    const repoPath = getRepoPath(repoId);
    if (!fs.existsSync(repoPath)) {
      return res.status(404).json({ error: `Repository path not found on disk: ${repoPath}` });
    }

    // Load all repository files into a Map for cross-file anchor detection
    const repositoryFiles = getAllRepositoryFiles(repoPath);
    const filesContentMap = new Map<string, string>(repositoryFiles);

    // Track original contents to generate diffs later
    const originalContentsMap = new Map<string, string>();
    for (const [relPath, content] of repositoryFiles.entries()) {
      originalContentsMap.set(relPath, content);
    }

    const diffs: any[] = [];
    const modifiedContents: Array<{ path: string; action: string; content: string; originalContent: string | null }> = [];
    const warnings: string[] = [];

    const filesToProcess = plan.files || [];
    const skippedChangesMap = new Map<string, Array<{ function: string; reason: string; suggestion: string }>>();

    // We keep track of which files are actually modified
    const modifiedFilePaths = new Set<string>();

    for (const file of filesToProcess) {
      const targetPath = file.path.replace(/\\/g, '/');
      const fileChanges = file.changes || [];

      // Handle delete action
      if (file.action === 'delete') {
        const originalContent = originalContentsMap.get(targetPath) || '';
        const hunks = diff.structuredPatch(
          file.path,
          file.path,
          originalContent,
          '',
          '',
          '',
          { context: 3 }
        );

        diffs.push({
          path: file.path,
          action: 'delete',
          status: 'success',
          skippedChanges: [],
          hunks: hunks.hunks.map(h => ({
            ...h,
            functionName: getEnclosingFunction(originalContent, h.oldStart)
          })),
          additions: 0,
          deletions: hunks.hunks.reduce((sum, h) => 
            sum + h.lines.filter(l => l.startsWith('-')).length, 0),
        });

        modifiedContents.push({
          path: file.path,
          action: 'delete',
          content: '',
          originalContent,
        });
        continue;
      }

      // Loop through changes
      for (const change of fileChanges) {
        let activePath = targetPath;
        let fileContent = filesContentMap.get(activePath) || '';

        // GATE: verify anchor before executing
        if (change.currentCode) {
          if (change.currentCode.includes('...') || change.currentCode.includes('…')) {
            console.error('❌ BLOCKED: truncated anchor reached execution stage:', change.currentCode.slice(0, 80));
            change.usesFunctionLevel = true;
            change.currentCode = null;
          } else if (!fileContent.includes(change.currentCode)) {
            console.error('❌ BLOCKED: anchor not in file:', change.currentCode.slice(0, 80));
            change.usesFunctionLevel = true;
            change.currentCode = null;
          } else {
            console.log('✅ Pre-execution anchor verified:', change.function);
          }
        }

        const usesFuncLevel = change.usesFunctionLevel;

        if (!usesFuncLevel) {
          // Check if anchor exists in target path
          const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
          const hasExact = change.currentCode ? fileContent.includes(change.currentCode) : true;
          const hasFuzzy = change.currentCode ? normalize(fileContent).includes(normalize(change.currentCode)) : true;

          if (!hasExact && !hasFuzzy && change.currentCode) {
            // Cross-file anchor detection
            const correctFile = findAnchorInFiles(change.currentCode, filesContentMap);
            if (correctFile) {
              console.warn(`Anchor found in ${correctFile} instead of ${targetPath}`);
              activePath = correctFile;
              fileContent = filesContentMap.get(correctFile) || '';
            } else {
              // Skipped change
              console.error('❌ No match found for:', change.currentCode.slice(0, 80));
              if (!skippedChangesMap.has(targetPath)) {
                skippedChangesMap.set(targetPath, []);
              }
              skippedChangesMap.get(targetPath)!.push({
                function: change.function,
                reason: `Could not locate anchor: ${change.currentCode.slice(0, 60)}`,
                suggestion: 'This code may be in a different file or was already modified'
              });
              continue;
            }
          }
        }

        let modifiedFileContent = fileContent;

        if (usesFuncLevel) {
          console.log(`Applying function-level fallback for ${change.function} in ${activePath}`);
          modifiedFileContent = await applyFunctionLevelReplacement(
            fileContent,
            change.function,
            change.reason,
            change.newCode
          );
        } else {
          console.log(`Applying: ${change.type} in ${change.function} to ${activePath}`);
          let newCode = '';

          if (change.type !== 'delete') {
            const plannedNewCode = typeof change.newCode === 'string' ? change.newCode.trim() : '';
            if ((change.type === 'insert_before' || change.type === 'insert_after') && plannedNewCode) {
              newCode = plannedNewCode;
              if (change.currentCode && newCode.includes(change.currentCode)) {
                newCode = newCode.replace(change.currentCode, '').trim();
              }
            } else {
              const systemPrompt = `You are a senior software engineer making a precise code change.

## Your process:

STEP 1 — UNDERSTAND
Read this code snippet carefully:
${change.currentCode}

It is inside function '${change.function}' in file '${activePath}'.
The full file context is: ${fileContent}

STEP 2 — PLAN
Before writing anything, think:
- What exactly needs to change in this snippet
- Whether this change requires new functions to be defined
- Whether any existing logic conflicts and must be removed
- Whether any const needs to become let

STEP 3 — EXECUTE
Apply the change with surgical precision:
- If you call wrapAround(), you MUST define wrapAround()
- If you add wall wrapping, you MUST remove the wall death check
- If you change const to let, update every reference
- Never leave orphaned function calls without definitions
- Never leave conflicting logic alongside new logic

STEP 4 — VERIFY
Before returning, check:
□ Every function call has a definition
□ No conflicting logic remains
□ No undefined variables
□ Syntactically valid
□ No markdown fences in output

Return ONLY the replacement code for this specific snippet.
No explanation. No markdown. No code fences. Raw code only.`;

              const userPrompt = `The change to make: ${change.reason}
Current code: ${change.currentCode}`;

              let generated = await askLLM(systemPrompt, userPrompt, false, 0.1);
              let cleaned = generated.trim();
              if (cleaned.startsWith('```')) {
                const lines = cleaned.split('\n');
                if (lines[0].startsWith('```')) {
                  lines.shift();
                }
                if (lines[lines.length - 1].startsWith('```')) {
                  lines.pop();
                }
                cleaned = lines.join('\n');
              }
              newCode = cleaned;
            }
          }

          const changeToApply = { ...change, newCode };
          modifiedFileContent = await applySurgicalChange(fileContent, changeToApply);
        }

        // Check if match was actually found/changed (or if it skipped)
        if (modifiedFileContent === fileContent && change.type !== 'delete') {
          console.warn(`⚠️ Match not found during applySurgicalChange for change in ${change.function}`);
          if (!skippedChangesMap.has(activePath)) {
            skippedChangesMap.set(activePath, []);
          }
          skippedChangesMap.get(activePath)!.push({
            function: change.function,
            reason: usesFuncLevel 
              ? `Could not extract/modify function body for ${change.function}`
              : `Could not locate anchor: ${change.currentCode ? change.currentCode.slice(0, 60) : ''}`,
            suggestion: 'This code may be in a different file or was already modified'
          });
        } else {
          filesContentMap.set(activePath, modifiedFileContent);
          modifiedFilePaths.add(activePath);
        }
        console.log(`Done: ${change.function}`);
      }
    }

    // Now validate and run self-healing on all modified files
    for (const relPath of modifiedFilePaths) {
      const originalContent = originalContentsMap.get(relPath) || '';
      let finalContent = filesContentMap.get(relPath) || '';

      let validationResult = validateModifiedCode(originalContent, finalContent);
      let retries = 0;

      while (!validationResult.valid && retries < 2) {
        retries++;
        console.log(`Validation failed for ${relPath}. Running self-healing retry ${retries}/2:`, validationResult.issues);
        
        const retrySystemPrompt = `You are a senior software engineer fixing a code change.
Your previous attempt had the following validation issues:
${validationResult.issues.map(iss => `- ${iss}`).join('\n')}

Fix ALL of these before responding:
- If you called a function, define it
- If you added wall wrapping, remove the wall death check
- If const needs to be let, change it
- Return the COMPLETE corrected file
- No markdown, no code fences, raw code only`;

        const retryUserPrompt = `Original file content:
${originalContent}

Currently modified code (with issues):
${validationResult.modified}`;

        let retryContent = await askLLM(retrySystemPrompt, retryUserPrompt, false, 0.1);
        let cleanedRetry = retryContent.trim();
        if (cleanedRetry.startsWith('```')) {
          const lines = cleanedRetry.split('\n');
          if (lines[0].startsWith('```')) {
            lines.shift();
          }
          if (lines[lines.length - 1].startsWith('```')) {
            lines.pop();
          }
          cleanedRetry = lines.join('\n');
        }

        finalContent = cleanedRetry;
        validationResult = validateModifiedCode(originalContent, finalContent);
      }

      if (!validationResult.valid) {
        throw new Error(`Code validation failed for ${relPath} after 2 self-healing retries: ${validationResult.issues.join(', ')}`);
      } else {
        filesContentMap.set(relPath, validationResult.modified);
      }
    }

    // Generate diffs and fill modifiedContents
    for (const relPath of modifiedFilePaths) {
      const originalContent = originalContentsMap.get(relPath) || '';
      const finalContent = filesContentMap.get(relPath) || '';
      const skippedChanges = skippedChangesMap.get(relPath) || [];

      // Generate structured diff
      const hunks = diff.structuredPatch(
        relPath,
        relPath,
        originalContent,
        finalContent,
        '',
        '',
        { context: 3 }
      );

      diffs.push({
        path: relPath,
        action: 'modify',
        status: skippedChanges.length > 0 ? 'partial' : 'success',
        skippedChanges,
        hunks: hunks.hunks.map(h => ({
          ...h,
          functionName: getEnclosingFunction(originalContent, h.oldStart)
        })),
        additions: hunks.hunks.reduce((sum, h) => 
          sum + h.lines.filter(l => l.startsWith('+')).length, 0),
        deletions: hunks.hunks.reduce((sum, h) => 
          sum + h.lines.filter(l => l.startsWith('-')).length, 0),
      });

      modifiedContents.push({
        path: relPath,
        action: 'modify',
        content: finalContent,
        originalContent,
      });
    }

    // Also include files that had only skipped changes (no actual modifications)
    for (const [relPath, skipped] of skippedChangesMap.entries()) {
      if (!modifiedFilePaths.has(relPath)) {
        const originalContent = originalContentsMap.get(relPath) || '';
        diffs.push({
          path: relPath,
          action: 'modify',
          status: 'partial',
          skippedChanges: skipped,
          hunks: [],
          additions: 0,
          deletions: 0
        });
      }
    }

    res.json({
      success: true,
      diffs,
      modifiedContents,
      warnings,
    });
  } catch (error: any) {
    console.error('Code Generation Error:', error);
    if (error.message && error.message.includes('All LLM providers unavailable')) {
      return res.status(503).json({
        error: "AI providers temporarily unavailable",
        message: "Groq daily limit reached and Ollama is not running. Options: wait 21 minutes for Groq to reset, run 'ollama serve' in terminal, or add MISTRAL_API_KEY to .env",
        retryAfter: 1268
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// 3. Execute plan - WRITE changes to disk (structured diff response)
router.post('/execute', async (req: Request, res: Response): Promise<any> => {
  try {
    const { repoId, modifiedContents } = req.body;
    
    console.log('Execute called with:', {
      repoId,
      modifiedContentsLength: modifiedContents?.length,
    });

    if (!repoId || !modifiedContents || !Array.isArray(modifiedContents)) {
      return res.status(400).json({ error: 'repoId and modifiedContents array are required' });
    }

    const repoPath = getRepoPath(repoId);
    console.log('Resolved repository path:', repoPath);

    if (!fs.existsSync(repoPath)) {
      console.error(`Repository directory not found on disk: ${repoPath}`);
      return res.status(500).json({ 
        error: `Repository directory not found on disk: ${repoPath}` 
      });
    }

    const originals: Array<{ path: string; content: string | null }> = [];
    const filesWritten: string[] = [];
    const diffs: any[] = [];

    for (const item of modifiedContents) {
      console.log('Processing file write:', item.path);
      const filePath = path.resolve(repoPath, item.path);
      
      // Safety check: path traversal
      if (!filePath.startsWith(path.resolve(repoPath))) {
        console.error(`Path traversal attempt blocked: ${item.path}`);
        return res.status(403).json({ error: `Access denied: path traversal blocked for ${item.path}` });
      }

      const existsBefore = fs.existsSync(filePath);
      const originalFileContent = existsBefore ? fs.readFileSync(filePath, 'utf8') : null;

      // Save pre-existing content for rollback
      originals.push({ path: filePath, content: originalFileContent });

      console.log('=== WRITE VERIFICATION ===');
      console.log('Writing to:', filePath);
      console.log('Original length:', originalFileContent?.length || 0);
      console.log('Modified length:', item.content?.length || 0);
      console.log('Are they identical?:', originalFileContent === item.content);

      if (item.action === 'delete') {
        if (existsBefore) {
          fs.unlinkSync(filePath);
          console.log('Deleted file on disk:', item.path);
        }
      } else {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, item.content || '', 'utf8');
        console.log('Write complete for:', item.path);
      }

      // After writing, verify on disk
      if (item.action !== 'delete') {
        const verified = fs.readFileSync(filePath, 'utf8');
        console.log('Verified on disk length:', verified.length);
        console.log('Write successful:', verified === item.content);
      }
      console.log('==========================');

      // Generate structured diff
      const hunks = diff.structuredPatch(
        item.path,
        item.path,
        originalFileContent || '',
        item.content || '',
        '',
        '',
        { context: 3 }
      );

      diffs.push({
        path: item.path,
        action: item.action,
        hunks: hunks.hunks.map(h => ({
          ...h,
          functionName: getEnclosingFunction(originalFileContent, h.oldStart)
        })),
        additions: hunks.hunks.reduce((sum, h) => 
          sum + h.lines.filter(l => l.startsWith('+')).length, 0),
        deletions: hunks.hunks.reduce((sum, h) => 
          sum + h.lines.filter(l => l.startsWith('-')).length, 0),
      });

      filesWritten.push(item.path);
    }

    const rollbackId = Math.random().toString(36).substring(7);
    rollbackStore.set(rollbackId, originals);

    console.log('Execute successful. Rollback ID registered:', rollbackId);

    return res.json({
      success: true,
      rollbackId,
      filesWritten,
      diffs,
      message: `Successfully modified ${filesWritten.length} files`
    });
  } catch (error: any) {
    console.error('Execution Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Rollback execution
router.post('/rollback', async (req: Request, res: Response): Promise<any> => {
  try {
    const { rollbackId } = req.body;
    if (!rollbackId) {
      return res.status(400).json({ error: 'rollbackId is required' });
    }

    const originals = rollbackStore.get(rollbackId);
    if (!originals) {
      return res.status(404).json({ error: 'Rollback session not found or expired' });
    }

    // Restore files in reverse order
    for (const file of [...originals].reverse()) {
      if (file.content === null) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } else {
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        fs.writeFileSync(file.path, file.content, 'utf8');
      }
    }

    rollbackStore.delete(rollbackId);

    res.json({ success: true, message: 'All changes successfully rolled back' });
  } catch (error: any) {
    console.error('Rollback Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
