import { useState } from 'react';

export type ActModeStatus = 
  | 'idle'
  | 'unsure'
  | 'planning'        // generating plan
  | 'plan_ready'      // showing plan, waiting for approval
  | 'generating'      // generating modified code in-memory
  | 'diff_ready'      // showing diff, waiting for confirmation
  | 'executing'       // writing to disk
  | 'complete'        // done, show success
  | 'error'           // something failed
  | 'rolled_back';

export interface PlanFileChange {
  function: string;
  currentCode: string;
  newCode: string;
  type: 'replace' | 'insert_before' | 'insert_after' | 'delete';
  reason: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  lineHint?: number;
}

export interface PlanFile {
  path: string;
  action: 'modify' | 'create' | 'delete';
  reason: string;
  changes: PlanFileChange[];
}

export interface ChangePlan {
  intent: string;
  scope: 'small' | 'medium' | 'large';
  files: PlanFile[];
  warnings: string[];
  estimatedChanges: {
    filesModified: number;
    filesCreated: number;
    filesDeleted: number;
  };
}

export interface SkippedChange {
  function: string;
  reason: string;
  suggestion: string;
}

export interface FileDiff {
  path: string;
  action: string;
  status?: 'success' | 'partial';
  skippedChanges?: SkippedChange[];
  hunks: any[];
  additions: number;
  deletions: number;
}

export interface ModifiedContent {
  path: string;
  action: string;
  content: string;
  originalContent: string | null;
}

export function useActMode() {
  const [status, setStatus] = useState<ActModeStatus>('idle');
  const [userRequest, setUserRequest] = useState('');
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [modifiedContents, setModifiedContents] = useState<ModifiedContent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileProgress, setFileProgress] = useState<Record<string, 'waiting' | 'executing' | 'done' | 'skipped'>>({});

  // Step 1: Request plan
  const startPlanning = async (request: string, repoUrl: string) => {
    setUserRequest(request);
    setStatus('planning');
    setError(null);
    setPlan(null);
    setDiffs([]);
    setModifiedContents([]);

    try {
      const res = await fetch('/api/act/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userRequest: request, repoId: repoUrl }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      setPlan(data);
      setStatus('plan_ready');
    } catch (err: any) {
      setError(err.message || 'Failed to generate plan');
      setStatus('error');
    }
  };

  // Step 2: Generate code in-memory (and produce diffs)
  const generateCode = async (repoUrl: string) => {
    if (!plan) return;
    setStatus('generating');
    setError(null);

    // Initialize progress
    const initialProgress: Record<string, 'waiting' | 'executing' | 'done' | 'skipped'> = {};
    plan.files.forEach(f => {
      initialProgress[f.path] = 'waiting';
    });
    setFileProgress(initialProgress);

    let isRequestDone = false;
    let currentIdx = 0;

    const simulateProgress = async () => {
      while (currentIdx < plan.files.length && !isRequestDone) {
        const file = plan.files[currentIdx];
        setFileProgress(prev => ({
          ...prev,
          [file.path]: 'executing',
        }));

        // Simulating progressive generation visual step
        await new Promise(resolve => setTimeout(resolve, 1500));

        if (!isRequestDone) {
          setFileProgress(prev => ({
            ...prev,
            [file.path]: 'done',
          }));
          currentIdx++;
        }
      }
    };

    const apiCall = async () => {
      try {
        const res = await fetch('/api/act/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan, repoId: repoUrl }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Generation failed' }));
          throw new Error(errData.error || 'Generation failed');
        }

        const data = await res.json();
        isRequestDone = true;

        const finalProgress = { ...initialProgress };
        plan.files.forEach(f => {
          const isSkipped = data.warnings.some((w: string) => 
            w.toLowerCase().includes(f.path.toLowerCase()) && w.toLowerCase().includes('skipped')
          );
          finalProgress[f.path] = isSkipped ? 'skipped' : 'done';
        });

        setFileProgress(finalProgress);
        setDiffs(data.diffs || []);
        setModifiedContents(data.modifiedContents || []);
        setWarnings(data.warnings || []);
        setStatus('diff_ready');
      } catch (err: any) {
        isRequestDone = true;
        setError(err.message || 'Generation failed');
        setStatus('error');
      }
    };

    simulateProgress();
    await apiCall();
  };

  // Step 3: Write modified contents to disk (Debug Step 2)
  const executePlan = async (repoUrl: string) => {
    if (modifiedContents.length === 0) return;
    setStatus('executing');
    setError(null);

    console.log('Calling /api/act/execute...');

    try {
      const response = await fetch('/api/act/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: repoUrl, modifiedContents }),
      });

      console.log('Execute response status:', response.status);

      if (!response.ok) {
        const text = await response.text();
        console.error('Execute failed:', text);
        
        let parsedErr;
        try {
          parsedErr = JSON.parse(text);
        } catch {
          // ignore
        }
        throw new Error(parsedErr?.error || text || 'Execution failed');
      }

      const result = await response.json();
      console.log('Execute result:', result);

      setRollbackId(result.rollbackId);
      if (result.diffs) {
        setDiffs(result.diffs);
      }
      setStatus('complete');
    } catch (err: any) {
      setError(err.message || 'Execution failed');
      setStatus('error');
    }
  };

  const rollbackChanges = async () => {
    if (!rollbackId) return;
    setStatus('executing');
    setError(null);

    try {
      const res = await fetch('/api/act/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollbackId }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Rollback failed' }));
        throw new Error(errData.error || 'Rollback failed');
      }

      setStatus('rolled_back');
    } catch (err: any) {
      setError(err.message || 'Rollback failed');
      setStatus('error');
    }
  };

  const cancel = () => {
    setStatus('idle');
    setPlan(null);
    setDiffs([]);
    setModifiedContents([]);
    setWarnings([]);
    setRollbackId(null);
    setError(null);
    setFileProgress({});
  };

  const editPlan = (updatedPlan: ChangePlan) => {
    setPlan(updatedPlan);
  };

  return {
    status,
    userRequest,
    plan,
    diffs,
    modifiedContents,
    warnings,
    rollbackId,
    error,
    fileProgress,
    startPlanning,
    generateCode,
    executePlan,
    rollbackChanges,
    cancel,
    editPlan,
    setStatus,
    setUserRequest,
  };
}
