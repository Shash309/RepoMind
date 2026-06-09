import { useState, useRef } from 'react';

// ─── Types (mirrored from backend, avoids cross-boundary import) ──────────────

export type RiskRadarStatus =
  | 'idle'
  | 'queued'
  | 'identifying'
  | 'mapping'
  | 'scoring'
  | 'ordering'
  | 'complete'
  | 'error';

export interface RiskStep {
  stage: number;
  label: string;
  icon: string;
  done: boolean;
  active: boolean;
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
  dependsOn?: string;
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

export interface RiskRadarResult {
  userRequest: string;
  target?: { type: string; name: string; file: string | null; description: string };
  dependencyMap?: DependencyMap;
  riskScore?: RiskScore;
  changeOrder?: ChangeOrder;
}

// ─── Analysis Steps Definition ────────────────────────────────────────────────

const ANALYSIS_STEPS: Omit<RiskStep, 'done' | 'active'>[] = [
  { stage: 1, label: 'Identifying change target...', icon: '🔍' },
  { stage: 2, label: 'Mapping dependencies...', icon: '🗺️' },
  { stage: 3, label: 'Calculating risk score...', icon: '⚖️' },
  { stage: 4, label: 'Generating change order...', icon: '📋' },
];

const POLL_INTERVAL_MS = 800;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRiskRadar() {
  const [status, setStatus] = useState<RiskRadarStatus>('idle');
  const [userRequest, setUserRequest] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [result, setResult] = useState<RiskRadarResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const getSteps = (): RiskStep[] => {
    return ANALYSIS_STEPS.map(step => ({
      ...step,
      done: currentStage > step.stage || status === 'complete',
      active: currentStage === step.stage && status !== 'complete' && status !== 'error',
    }));
  };

  const pollStatus = (id: string, originalRequest: string) => {
    stopPolling();

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/risk-radar/status/${id}`);
        if (!res.ok) {
          stopPolling();
          setStatus('error');
          setError('Failed to poll analysis status');
          return;
        }

        const job = await res.json() as {
          status: RiskRadarStatus;
          currentStage: number;
          stageLabel: string;
          error?: string;
          target?: RiskRadarResult['target'];
          dependencyMap?: DependencyMap;
          riskScore?: RiskScore;
          changeOrder?: ChangeOrder;
        };

        setCurrentStage(job.currentStage ?? 0);
        setStatus(job.status);

        if (job.status === 'complete') {
          stopPolling();
          setResult({
            userRequest: originalRequest,
            target: job.target,
            dependencyMap: job.dependencyMap,
            riskScore: job.riskScore,
            changeOrder: job.changeOrder,
          });
        } else if (job.status === 'error') {
          stopPolling();
          setError(job.error || 'Analysis failed');
        }
      } catch (err) {
        stopPolling();
        setStatus('error');
        setError('Lost connection to server');
      }
    }, POLL_INTERVAL_MS);
  };

  const startAnalysis = async (request: string, repoUrl: string) => {
    setUserRequest(request);
    setStatus('queued');
    setCurrentStage(0);
    setResult(null);
    setError(null);
    setJobId(null);

    try {
      const res = await fetch('/api/risk-radar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userRequest: request, repoId: repoUrl }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const { jobId: id } = await res.json() as { jobId: string };
      setJobId(id);
      pollStatus(id, request);
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Failed to start analysis');
    }
  };

  const clear = () => {
    stopPolling();
    setStatus('idle');
    setUserRequest('');
    setJobId(null);
    setCurrentStage(0);
    setResult(null);
    setError(null);
  };

  const isActive = status !== 'idle';

  return {
    status,
    userRequest,
    jobId,
    currentStage,
    result,
    error,
    steps: getSteps(),
    isActive,
    startAnalysis,
    clear,
  };
}
