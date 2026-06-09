import { Router, Request, Response } from 'express';
import path from 'path';
import crypto from 'crypto';
import { askLLM } from '../services/llm';
import { buildFileIndex, extractStaticDependencies } from '../services/dependencyAnalyzer';

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskTarget {
  type: 'function' | 'file' | 'module' | 'feature' | 'concept';
  name: string;
  file: string | null;
  description: string;
}

export interface AffectedFunction {
  name: string;
  reason: string;
  changeRequired: boolean;
}

export interface AffectedFile {
  path: string;
  relationshipType: 'direct_dependency' | 'indirect_dependency' | 'test' | 'shared_state' | 'similar_logic';
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  affectedFunctions: AffectedFunction[];
  changeRequired: boolean;
  suggestedAction: string;
  dependsOn?: string; // for graph edges
}

export interface CircularDependency {
  chain: string[];
  severity: 'warning' | 'error';
  description: string;
}

export interface DependencyMap {
  affectedFiles: AffectedFile[];
  circularDependencies: CircularDependency[];
  hiddenRisks: string[];
  safeFiles: string[];
}

export interface RiskScore {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  color: string;
  emoji: string;
  summary: {
    totalAffected: number;
    criticalFiles: number;
    highRiskFiles: number;
    circularDeps: number;
    testCoverage: string;
    changeRequired: number;
  };
}

export interface ChangeOrderStep {
  step: number;
  file: string;
  action: string;
  reason: string;
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
}

export interface ChangeOrder {
  changeOrder: ChangeOrderStep[];
  warnings: string[];
  estimatedImpact: {
    timeEstimate: string;
    breakingChange: boolean;
    requiresTeamReview: boolean;
  };
}

export type RiskRadarJobStatus =
  | 'queued'
  | 'identifying'
  | 'mapping'
  | 'scoring'
  | 'ordering'
  | 'complete'
  | 'error';

export interface RiskRadarJob {
  status: RiskRadarJobStatus;
  currentStage: number; // 0-4
  stageLabel: string;
  userRequest: string;
  error?: string;
  // Results (populated as stages complete)
  target?: RiskTarget;
  dependencyMap?: DependencyMap;
  riskScore?: RiskScore;
  changeOrder?: ChangeOrder;
  repoId?: string;
}

// ─── Job Store ────────────────────────────────────────────────────────────────

const jobs = new Map<string, RiskRadarJob>();

// ─── Robust JSON Parser (same pattern as act.ts) ─────────────────────────────

const safeParseJSON = (raw: string | null | undefined): any => {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Empty or non-string response from LLM');
  }

  let cleaned = raw;
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) {
    throw new Error('No JSON object found in LLM response');
  }

  let jsonStart: number;
  if (firstBrace === -1) jsonStart = firstBracket;
  else if (firstBracket === -1) jsonStart = firstBrace;
  else jsonStart = Math.min(firstBrace, firstBracket);

  const lastBrace = cleaned.lastIndexOf('}');
  const lastBracket = cleaned.lastIndexOf(']');
  const jsonEnd = Math.max(lastBrace, lastBracket);

  if (jsonEnd === -1) throw new Error('No JSON closing bracket found');

  const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (err: any) {
    // Try to repair common issues: trailing commas, single quotes
    const repaired = jsonStr
      .replace(/,\s*([}\]])/g, '$1')        // trailing commas
      .replace(/'/g, '"')                    // single → double quotes
      .replace(/(\w+):\s*"/g, '"$1": "');   // unquoted keys
    try {
      return JSON.parse(repaired);
    } catch {
      throw new Error(`JSON parse error: ${err.message}`);
    }
  }
};

// ─── Repo path resolution (same as act.ts) ───────────────────────────────────

function getRepoPath(repoId: string): string {
  const repoName = repoId.split('/').pop()?.replace('.git', '') || 'unknown-repo';
  // Check backend/.repos first, then root .repos
  const backendPath = path.join(process.cwd(), '.repos', repoName);
  const rootPath = path.join(process.cwd(), '..', '.repos', repoName);
  const { existsSync } = require('fs');
  if (existsSync(backendPath)) return backendPath;
  if (existsSync(rootPath)) return rootPath;
  return backendPath;
}

// ─── Stage 1: Identify Target ─────────────────────────────────────────────────

const identifyTarget = async (
  userRequest: string,
  fileIndex: Record<string, string>
): Promise<RiskTarget> => {
  // Give LLM just the file paths (not content) to identify the target
  const filePaths = Object.keys(fileIndex).slice(0, 100).join('\n');

  const systemPrompt = `You are a code analysis expert. Analyze what the user wants to change and identify the primary target in the codebase.
Return ONLY valid JSON. No explanation. No markdown.`;

  const userPrompt = `User's change request: "${userRequest}"

Available files in the repository:
${filePaths}

Return ONLY this JSON (no explanation, no markdown fences):
{
  "type": "function | file | module | feature | concept",
  "name": "exact name if specific, or short description if broad",
  "file": "most likely file path if identifiable, or null",
  "description": "one sentence describing exactly what the user wants to change"
}`;

  const raw = await askLLM(systemPrompt, userPrompt, { temperature: 0.1, expectJSON: true });
  const parsed = safeParseJSON(raw);

  return {
    type: parsed.type || 'concept',
    name: parsed.name || userRequest.slice(0, 60),
    file: parsed.file || null,
    description: parsed.description || userRequest,
  };
};

// ─── Stage 2: Build Dependency Map ───────────────────────────────────────────

const buildDependencyMap = async (
  target: RiskTarget,
  fileIndex: Record<string, string>,
  staticDeps: ReturnType<typeof extractStaticDependencies>
): Promise<DependencyMap> => {
  // Build a compact summary of static deps to give LLM grounding
  const staticSummary = Object.entries(staticDeps)
    .map(([fp, dep]) => {
      const imps = dep.imports.slice(0, 8).join(', ');
      const exps = dep.exports.slice(0, 5).join(', ');
      return `${fp}${imps ? ` | imports: ${imps}` : ''}${exps ? ` | exports: ${exps}` : ''}`;
    })
    .join('\n');

  // Build file content snippets (top 2000 chars each, already trimmed)
  const fileSnippets = Object.entries(fileIndex)
    .slice(0, 40) // cap at 40 files to avoid token overflow
    .map(([fp, content]) => `=== ${fp} ===\n${content}`)
    .join('\n\n');

  const systemPrompt = `You are a senior software engineer performing dependency impact analysis.
Your job: find every file that will be affected by a code change.
Be thorough. Include direct and indirect dependencies.
Return ONLY valid JSON. No explanation. No markdown fences.`;

  const userPrompt = `Change request: "${target.description}"
Primary target: ${target.name}${target.file ? ` in ${target.file}` : ''}

STATIC DEPENDENCY MAP (imports/exports extracted from code):
${staticSummary}

FILE CONTENTS (first 2000 chars of each, imports are at top):
${fileSnippets}

Analyze ALL files above. Find EVERY file that:
1. Directly imports or calls the target
2. Is imported by the target  
3. Shares state or types with the target
4. Would break if the target's API/interface changes
5. Tests the target functionality

Return ONLY this JSON (no explanation, no markdown):
{
  "affectedFiles": [
    {
      "path": "src/auth.js",
      "relationshipType": "direct_dependency",
      "riskLevel": "critical",
      "reason": "specific reason why this file is affected",
      "dependsOn": "path/of/file/this/depends/on or null",
      "affectedFunctions": [
        {
          "name": "functionName",
          "reason": "why this function is affected",
          "changeRequired": true
        }
      ],
      "changeRequired": true,
      "suggestedAction": "what needs to be updated in this file"
    }
  ],
  "circularDependencies": [
    {
      "chain": ["fileA.js", "fileB.js", "fileA.js"],
      "severity": "warning",
      "description": "what this circular dep means"
    }
  ],
  "hiddenRisks": [
    "non-obvious risk or side effect"
  ],
  "safeFiles": ["files confirmed unaffected"]
}`;

  const raw = await askLLM(systemPrompt, userPrompt, { temperature: 0.1, expectJSON: true });
  const parsed = safeParseJSON(raw);

  return {
    affectedFiles: Array.isArray(parsed.affectedFiles) ? parsed.affectedFiles : [],
    circularDependencies: Array.isArray(parsed.circularDependencies) ? parsed.circularDependencies : [],
    hiddenRisks: Array.isArray(parsed.hiddenRisks) ? parsed.hiddenRisks : [],
    safeFiles: Array.isArray(parsed.safeFiles) ? parsed.safeFiles : [],
  };
};

// ─── Stage 3: Calculate Risk Score (pure math, no LLM) ───────────────────────

const calculateRiskScore = (dependencyMap: DependencyMap): RiskScore => {
  const affected = dependencyMap.affectedFiles || [];

  const criticalCount = affected.filter(f => f.riskLevel === 'critical').length;
  const highCount = affected.filter(f => f.riskLevel === 'high').length;
  const mediumCount = affected.filter(f => f.riskLevel === 'medium').length;
  const circularCount = (dependencyMap.circularDependencies || []).length;
  const testsCovered = affected.filter(f => f.relationshipType === 'test').length;
  const hasTests = testsCovered > 0;

  let score = 0;
  score += criticalCount * 30;
  score += highCount * 15;
  score += mediumCount * 5;
  score += affected.length * 3;
  score += circularCount * 20;
  score -= hasTests ? 10 : 0; // test coverage reduces risk

  score = Math.min(100, Math.max(0, score));

  let level: RiskScore['level'];
  let color: string;
  let emoji: string;

  if (score >= 75) {
    level = 'CRITICAL'; color = '#ef4444'; emoji = '🔴';
  } else if (score >= 50) {
    level = 'HIGH'; color = '#f97316'; emoji = '🟠';
  } else if (score >= 25) {
    level = 'MEDIUM'; color = '#eab308'; emoji = '🟡';
  } else {
    level = 'LOW'; color = '#22c55e'; emoji = '🟢';
  }

  return {
    score,
    level,
    color,
    emoji,
    summary: {
      totalAffected: affected.length,
      criticalFiles: criticalCount,
      highRiskFiles: highCount,
      circularDeps: circularCount,
      testCoverage: hasTests
        ? `${testsCovered} test file${testsCovered > 1 ? 's' : ''} affected`
        : 'No test coverage detected ⚠️',
      changeRequired: affected.filter(f => f.changeRequired).length,
    },
  };
};

// ─── Stage 4: Generate Safe Change Order ─────────────────────────────────────

const generateChangeOrder = async (
  dependencyMap: DependencyMap,
  target: RiskTarget
): Promise<ChangeOrder> => {
  const affected = dependencyMap.affectedFiles || [];
  if (affected.length === 0) {
    return {
      changeOrder: [],
      warnings: ['No affected files detected — change may be isolated'],
      estimatedImpact: { timeEstimate: '< 1 hour', breakingChange: false, requiresTeamReview: false },
    };
  }

  const systemPrompt = `You are a senior software engineer planning a safe sequence of code changes.
Rules for ordering — follow these STRICTLY:
1. Tests ALWAYS go last — never place test files before source files regardless of dependency order
2. Leaf dependencies (files nothing else depends on) change FIRST
3. Shared utilities and helpers change SECOND
4. Core/central modules change THIRD
5. Entry points and orchestrators change FOURTH
6. Test files ALWAYS change LAST — after all source files are updated
7. If circular dependency exists, note it as a warning

Example of CORRECT order for a 3-file change:
Step 1: src/utils.js        (leaf, nothing depends on it)
Step 2: src/snake-game.js   (core logic)
Step 3: tests/snake-game.test.js  (tests ALWAYS last)

Example of WRONG order — never do this:
Step 1: tests/snake-game.test.js  ← WRONG, tests never first
Step 2: src/snake-game.js

Return ONLY valid JSON. No explanation. No markdown fences.`;

  const userPrompt = `Change: "${target.description}"
Target: ${target.name}

Affected files:
${JSON.stringify(affected.map(f => ({
  path: f.path,
  risk: f.riskLevel,
  type: f.relationshipType,
  changeRequired: f.changeRequired,
  reason: f.reason,
})), null, 2)}

Circular dependencies: ${JSON.stringify(dependencyMap.circularDependencies || [])}

Return ONLY this JSON:
{
  "changeOrder": [
    {
      "step": 1,
      "file": "path/to/file",
      "action": "what to do in this file",
      "reason": "why this file changes at this step",
      "estimatedComplexity": "simple | moderate | complex"
    }
  ],
  "warnings": ["critical warnings before starting"],
  "estimatedImpact": {
    "timeEstimate": "e.g. 2-3 hours",
    "breakingChange": true,
    "requiresTeamReview": false
  }
}`;

  const raw = await askLLM(systemPrompt, userPrompt, { temperature: 0.1, expectJSON: true });
  const parsed = safeParseJSON(raw);

  return {
    changeOrder: Array.isArray(parsed.changeOrder) ? parsed.changeOrder : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    estimatedImpact: parsed.estimatedImpact || {
      timeEstimate: 'Unknown',
      breakingChange: true,
      requiresTeamReview: false,
    },
  };
};

// ─── Background Analysis Runner ───────────────────────────────────────────────

async function runAnalysis(jobId: string, userRequest: string, repoId: string) {
  try {
    const repoPath = getRepoPath(repoId);

    // Stage 1: Identify target
    jobs.set(jobId, {
      ...jobs.get(jobId)!,
      status: 'identifying',
      currentStage: 1,
      stageLabel: 'Identifying change target...',
    });

    const fileIndex = Object.fromEntries(buildFileIndex(repoPath));
    const fileCount = Object.keys(fileIndex).length;
    console.log(`[RiskRadar] ${fileCount} files indexed for analysis`);

    if (fileCount === 0) {
      throw new Error(`No files found at repo path: ${repoPath}`);
    }

    const target = await identifyTarget(userRequest, fileIndex);
    console.log(`[RiskRadar] Target identified:`, target);

    jobs.set(jobId, { ...jobs.get(jobId)!, target });

    // Stage 2: Map dependencies
    jobs.set(jobId, {
      ...jobs.get(jobId)!,
      status: 'mapping',
      currentStage: 2,
      stageLabel: 'Mapping dependencies...',
    });

    const staticDeps = extractStaticDependencies(fileIndex);
    const dependencyMap = await buildDependencyMap(target, fileIndex, staticDeps);
    console.log(`[RiskRadar] ${dependencyMap.affectedFiles.length} affected files found`);

    jobs.set(jobId, { ...jobs.get(jobId)!, dependencyMap });

    // Stage 3: Calculate risk score (instant — pure math)
    jobs.set(jobId, {
      ...jobs.get(jobId)!,
      status: 'scoring',
      currentStage: 3,
      stageLabel: 'Calculating risk score...',
    });

    const riskScore = calculateRiskScore(dependencyMap);
    console.log(`[RiskRadar] Risk score: ${riskScore.level} (${riskScore.score}/100)`);

    jobs.set(jobId, { ...jobs.get(jobId)!, riskScore });

    // Stage 4: Generate change order
    jobs.set(jobId, {
      ...jobs.get(jobId)!,
      status: 'ordering',
      currentStage: 4,
      stageLabel: 'Generating safe change order...',
    });

    const changeOrder = await generateChangeOrder(dependencyMap, target);

    // Done
    jobs.set(jobId, {
      ...jobs.get(jobId)!,
      status: 'complete',
      currentStage: 4,
      stageLabel: 'Analysis complete',
      changeOrder,
    });

    console.log(`[RiskRadar] Analysis complete for job ${jobId}`);
  } catch (err: any) {
    console.error(`[RiskRadar] Analysis failed for job ${jobId}:`, err);
    jobs.set(jobId, {
      ...jobs.get(jobId)!,
      status: 'error',
      stageLabel: 'Analysis failed',
      error: err.message || 'Unknown error during analysis',
    });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/risk-radar — start analysis, return jobId immediately
router.post('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const { userRequest, repoId } = req.body;

    if (!userRequest || typeof userRequest !== 'string') {
      return res.status(400).json({ error: 'userRequest is required' });
    }
    if (!repoId || typeof repoId !== 'string') {
      return res.status(400).json({ error: 'repoId is required' });
    }

    const jobId = crypto.randomUUID();

    jobs.set(jobId, {
      status: 'queued',
      currentStage: 0,
      stageLabel: 'Queued for analysis...',
      userRequest,
      repoId,
    });

    // Fire-and-forget background analysis
    runAnalysis(jobId, userRequest, repoId).catch(err => {
      console.error('[RiskRadar] Background runner crashed:', err);
    });

    res.json({ jobId });
  } catch (err: any) {
    console.error('[RiskRadar] POST error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/risk-radar/status/:jobId — poll job status
router.get('/status/:jobId', (req: Request, res: Response): any => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

export default router;
