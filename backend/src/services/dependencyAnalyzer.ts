import fs from 'fs';
import path from 'path';

export interface StaticDependency {
  imports: string[];
  exports: string[];
  functionCalls: string[];
}

export interface StaticDepMap {
  [filePath: string]: StaticDependency;
}

/** Helper: extract all regex matches from a string into an array */
function extractAll(pattern: RegExp, str: string, groupIdx = 1): string[] {
  // Always clone the regex to reset lastIndex
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    if (m[groupIdx]) results.push(m[groupIdx]);
  }
  return results;
}

/**
 * Extracts static imports, exports, and function calls from file contents.
 * Uses regex — fast, free, gives the LLM grounding so it hallucinates less.
 * File content must already be trimmed to top N chars (imports live at the top).
 */
export const extractStaticDependencies = (
  fileContents: Record<string, string>
): StaticDepMap => {
  const deps: StaticDepMap = {};

  for (const filePath of Object.keys(fileContents)) {
    const content = fileContents[filePath];
    deps[filePath] = { imports: [], exports: [], functionCalls: [] };

    // ES6 imports: import ... from '...'
    const esImports = extractAll(/import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g, content);

    // CommonJS require()
    const cjsImports = extractAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, content);

    // Dynamic import()
    const dynImports = extractAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, content);

    // Deduplicate imports
    const importSet: Record<string, true> = {};
    for (const imp of [...esImports, ...cjsImports, ...dynImports]) {
      importSet[imp] = true;
    }
    deps[filePath].imports = Object.keys(importSet);

    // Named and default exports
    const namedExports = extractAll(
      /export\s+(?:default\s+)?(?:function|class|const|let|var|async\s+function)\s+(\w+)/g,
      content
    );

    // Re-export: export { name } from '...'
    const reExportBlocks = extractAll(/export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g, content);
    const reExportNames: string[] = [];
    for (const block of reExportBlocks) {
      const names = block.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      for (const n of names) reExportNames.push(n);
    }

    const exportSet: Record<string, true> = {};
    for (const ex of [...namedExports, ...reExportNames]) {
      if (ex) exportSet[ex] = true;
    }
    deps[filePath].exports = Object.keys(exportSet);

    // Top-level function calls (heuristic — excludes common keywords)
    const SKIP: Record<string, true> = {
      if: true, for: true, while: true, switch: true, catch: true,
      return: true, typeof: true, import: true, export: true, super: true,
      require: true, describe: true, it: true, test: true, expect: true,
      beforeEach: true, afterEach: true, setTimeout: true, setInterval: true,
      console: true, Math: true, Object: true, Array: true, JSON: true, Promise: true,
    };

    const calls = extractAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, content);
    const callSet: Record<string, true> = {};
    for (const call of calls) {
      if (!SKIP[call]) callSet[call] = true;
    }
    deps[filePath].functionCalls = Object.keys(callSet).slice(0, 50);
  }

  return deps;
};

/**
 * Reads all code files in a repository, skipping generated/vendor dirs.
 * Trims content to maxChars chars from the TOP — imports/exports are at top.
 */
export const buildFileIndex = (
  repoPath: string,
  maxChars = 2000
): Map<string, string> => {
  const allFiles = new Map<string, string>();

  const SKIP_DIRS: Record<string, true> = {
    node_modules: true, '.git': true, '.next': true, dist: true,
    build: true, '.repos': true, coverage: true, '.turbo': true,
    '.cache': true, __pycache__: true, venv: true, '.venv': true,
  };

  const CODE_EXTS: Record<string, true> = {
    '.js': true, '.ts': true, '.tsx': true, '.jsx': true,
    '.css': true, '.html': true, '.json': true, '.md': true,
    '.py': true, '.go': true, '.java': true, '.c': true,
    '.cpp': true, '.h': true, '.cs': true, '.rs': true,
    '.rb': true, '.php': true, '.swift': true, '.kt': true,
  };

  function traverse(dir: string): void {
    let items: string[];
    try {
      items = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const item of items) {
      if (SKIP_DIRS[item]) continue;

      const fullPath = path.join(dir, item);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        traverse(fullPath);
      } else {
        const ext = path.extname(item).toLowerCase();
        if (!CODE_EXTS[ext]) continue;
        if (stat.size > 500_000) continue;

        try {
          const full = fs.readFileSync(fullPath, 'utf8');
          // Trim from the BOTTOM — imports/exports live at the TOP
          const trimmed = full.slice(0, maxChars);
          const relPath = path.relative(repoPath, fullPath).replace(/\\/g, '/');
          allFiles.set(relPath, trimmed);
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  if (fs.existsSync(repoPath)) {
    traverse(repoPath);
  }

  return allFiles;
};
