import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, X, AlertTriangle, FileText, Plus, Trash2, Edit2, Check } from 'lucide-react';
import { ChangePlan, PlanFile } from '../hooks/useActMode';

interface ActModeCardProps {
  plan: ChangePlan;
  repoUrl: string;
  onExecute: () => void;
  onCancel: () => void;
  onEditPlan: (updatedPlan: ChangePlan) => void;
}

export default function ActModeCard({ plan, repoUrl, onExecute, onCancel, onEditPlan }: ActModeCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set());

  const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'unknown-repo';

  const toggleExcludePath = (path: string) => {
    const updated = new Set(excludedPaths);
    if (updated.has(path)) {
      updated.delete(path);
    } else {
      updated.add(path);
    }
    setExcludedPaths(updated);
  };

  const handleSaveEdit = () => {
    const updatedFiles = plan.files.filter(f => !excludedPaths.has(f.path));
    
    const filesModified = updatedFiles.filter(f => f.action === 'modify').length;
    const filesCreated = updatedFiles.filter(f => f.action === 'create').length;
    const filesDeleted = updatedFiles.filter(f => f.action === 'delete').length;

    onEditPlan({
      ...plan,
      files: updatedFiles,
      estimatedChanges: {
        filesModified,
        filesCreated,
        filesDeleted,
      }
    });
    setIsEditing(false);
  };

  const activeFiles = plan.files;
  const modifyCount = activeFiles.filter(f => f.action === 'modify').length;
  const createCount = activeFiles.filter(f => f.action === 'create').length;
  const deleteCount = activeFiles.filter(f => f.action === 'delete').length;

  // Calculate if there are any LOW confidence changes in non-excluded files
  const hasLowConfidence = activeFiles.some(f => 
    !excludedPaths.has(f.path) && f.changes.some(c => c.confidence === 'LOW')
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="p-5 rounded-2xl flex flex-col gap-4 text-left w-full relative"
      style={{
        background: 'rgba(17, 17, 28, 0.85)',
        border: '1px solid rgba(124, 58, 237, 0.25)',
        boxShadow: '0 8px 32px rgba(124, 58, 237, 0.12)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-violet-400 font-bold text-sm">⚡ Act Mode</span>
        </div>
        <span className="text-[10px] text-gray-500 font-mono">
          Repo: <span className="text-gray-400 font-bold">{repoName}</span>
        </span>
      </div>

      {/* Intent / Request */}
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Intent</p>
        <blockquote className="text-sm text-violet-200 pl-3 border-l-2 border-violet-500 italic py-0.5">
          &ldquo;{plan.intent}&rdquo;
        </blockquote>
      </div>

      {/* Scope and Estimated changes summary */}
      <div className="flex items-center justify-between text-xs text-gray-400 bg-white/[0.02] p-2.5 rounded-lg border border-white/5">
        <span>Scope: <strong className="text-violet-300 capitalize">{plan.scope}</strong></span>
        <span>
          Change: {modifyCount} ~ · {createCount} + · {deleteCount} -
        </span>
      </div>

      {/* Files proposed list */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
            {isEditing ? 'Exclude Files from Plan' : `Files to change (${activeFiles.length})`}
          </p>
          <button
            onClick={() => {
              if (isEditing) {
                handleSaveEdit();
              } else {
                setExcludedPaths(new Set());
                setIsEditing(true);
              }
            }}
            className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 font-medium transition-colors"
          >
            {isEditing ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Done Editing
              </>
            ) : (
              <>
                <Edit2 className="w-3 h-3" />
                Edit Plan
              </>
            )}
          </button>
        </div>

        <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1">
          {activeFiles.map((file) => {
            const isExcluded = excludedPaths.has(file.path);
            let actionColor = '#fbbf24'; // modify (amber)
            let actionBg = 'rgba(251, 191, 36, 0.1)';
            let fileIcon = <FileText className="w-3.5 h-3.5 text-amber-400" />;

            if (file.action === 'create') {
              actionColor = '#34d399'; // create (green)
              actionBg = 'rgba(52, 211, 153, 0.1)';
              fileIcon = <Plus className="w-3.5 h-3.5 text-green-400" />;
            } else if (file.action === 'delete') {
              actionColor = '#f87171'; // delete (red)
              actionBg = 'rgba(248, 113, 113, 0.1)';
              fileIcon = <Trash2 className="w-3.5 h-3.5 text-red-400" />;
            }

            return (
              <div
                key={file.path}
                className={`p-2.5 rounded-xl border transition-all ${
                  isExcluded ? 'opacity-40 bg-transparent border-white/5' : 'bg-white/[0.02] border-white/10'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 truncate mr-2">
                    {fileIcon}
                    <span className="font-mono text-xs text-gray-300 truncate" title={file.path}>
                      {file.path}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[9px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded"
                      style={{ color: actionColor, backgroundColor: actionBg }}
                    >
                      {file.action}
                    </span>
                    {isEditing && (
                      <button
                        onClick={() => toggleExcludePath(file.path)}
                        className={`p-1 rounded hover:bg-white/10 transition-colors ${
                          isExcluded ? 'text-gray-500 hover:text-white' : 'text-red-400 hover:text-red-300'
                        }`}
                      >
                        {isExcluded ? <Plus className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>

                {!isExcluded && file.changes && (
                  <div className="flex flex-col gap-2 pl-4 mt-2 border-l border-white/5">
                    {file.changes.map((change, cIdx) => {
                      let dotColor = '#fbbf24'; // yellow
                      if (change.confidence === 'HIGH') dotColor = '#34d399'; // green
                      else if (change.confidence === 'LOW') dotColor = '#f87171'; // red

                      const lineText = change.lineHint ? `line ~${change.lineHint}` : '';
                      const scopeText = change.function === 'GLOBAL SCOPE' 
                        ? 'GLOBAL SCOPE' 
                        : `${change.function}()`;
                        
                      const headerText = `IN ${scopeText}${lineText ? ` — ${lineText}` : ''}`;

                      return (
                        <div key={cIdx} className="text-[11px] font-mono text-gray-400 flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 font-sans font-medium text-gray-500 text-[10px]">
                            <span 
                              className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0"
                              style={{ backgroundColor: dotColor }}
                              title={`Confidence: ${change.confidence || 'MEDIUM'}`}
                            />
                            <span>{headerText}</span>
                            <span className="text-[9px] text-gray-600 font-normal">({change.reason})</span>
                          </div>

                          {/* Specific code comparison block */}
                          {change.type === 'replace' && (
                            <div className="pl-3 py-1 flex flex-col gap-0.5 border-l border-white/5 bg-white/[0.01] rounded">
                              <div className="text-red-400 flex items-start gap-1">
                                <span className="text-red-600 flex-shrink-0">┌ REMOVE:</span>
                                <code className="whitespace-pre-wrap leading-tight text-[10px]">{change.currentCode}</code>
                              </div>
                              <div className="text-green-400 flex items-start gap-1">
                                <span className="text-green-600 flex-shrink-0">└ ADD:</span>
                                <code className="whitespace-pre-wrap leading-tight text-[10px]">{change.newCode}</code>
                              </div>
                            </div>
                          )}

                          {change.type === 'delete' && (
                            <div className="pl-3 py-1 flex items-start gap-1 border-l border-white/5 bg-white/[0.01] rounded text-red-400">
                              <span className="text-red-600 flex-shrink-0">└ DELETE:</span>
                              <code className="whitespace-pre-wrap leading-tight text-[10px]">{change.currentCode}</code>
                            </div>
                          )}

                          {(change.type === 'insert_after' || change.type === 'insert_before') && (
                            <div className="pl-3 py-1 flex flex-col gap-0.5 border-l border-white/5 bg-white/[0.01] rounded">
                              <div className="text-gray-500 flex items-start gap-1 text-[9px]">
                                <span className="flex-shrink-0">┌ ANCHOR:</span>
                                <code className="whitespace-pre-wrap leading-tight text-[10px]">{change.currentCode || '(start/end of file)'}</code>
                              </div>
                              <div className="text-green-400 flex items-start gap-1">
                                <span className="text-green-600 flex-shrink-0">└ ADD:</span>
                                <code className="whitespace-pre-wrap leading-tight text-[10px]">{change.newCode}</code>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Warnings block */}
      {plan.warnings && plan.warnings.length > 0 && (
        <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 flex gap-2.5 items-start">
          <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">Warnings</span>
            {plan.warnings.map((warning, wIdx) => (
              <p key={wIdx} className="text-xs text-orange-200 leading-tight">
                {warning}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Low confidence warning banner */}
      {hasLowConfidence && (
        <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 flex gap-2.5 items-start">
          <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-orange-200 leading-tight">
            ⚠️ RepoMind could not precisely locate one or more changes. Review the diff carefully before confirming.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onCancel}
          disabled={isEditing}
          className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-all disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (isEditing) {
              handleSaveEdit();
            }
            onExecute();
          }}
          className="flex-[2] py-2 px-4 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all shadow-lg"
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
            boxShadow: '0 4px 14px rgba(124, 58, 237, 0.3)',
          }}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          Approve & Execute
        </button>
      </div>
    </motion.div>
  );
}
