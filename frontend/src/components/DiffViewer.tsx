import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, RotateCcw, Check, AlertTriangle, FileText, Plus, Trash, Save, X } from 'lucide-react';
import { FileDiff } from '../hooks/useActMode';

interface DiffViewerProps {
  diffs: FileDiff[];
  warnings: string[];
  onRollback: () => void;
  onAccept: () => void;
  rollbackLabel?: string;
  acceptLabel?: string;
  isConfirmed?: boolean;
}

export default function DiffViewer({
  diffs,
  warnings,
  onRollback,
  onAccept,
  rollbackLabel = 'Rollback',
  acceptLabel = 'Accept Changes',
  isConfirmed = true,
}: DiffViewerProps) {
  // Use a collapsedFiles map so that all files are expanded by default
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  const toggleExpand = (path: string) => {
    setCollapsedFiles(prev => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const totalFiles = diffs.length;
  const totalAdditions = diffs.reduce((sum, d) => sum + (d.additions || 0), 0);
  const totalDeletions = diffs.reduce((sum, d) => sum + (d.deletions || 0), 0);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="p-5 rounded-2xl flex flex-col gap-4 text-left w-full relative"
      style={{
        background: 'rgba(17, 17, 28, 0.85)',
        border: isConfirmed 
          ? '1px solid rgba(16, 185, 129, 0.25)' 
          : '1px solid rgba(124, 58, 237, 0.25)', 
        boxShadow: isConfirmed
          ? '0 8px 32px rgba(16, 185, 129, 0.12)'
          : '0 8px 32px rgba(124, 58, 237, 0.12)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className={isConfirmed ? "text-green-400 font-bold text-sm" : "text-violet-400 font-bold text-sm"}>
            {isConfirmed ? '✅ Changes Applied Successfully' : '🔍 Review Changes'}
          </span>
        </div>
        <span className="text-[10px] text-gray-500 font-mono">
          {totalFiles} {totalFiles === 1 ? 'file' : 'files'} affected
        </span>
      </div>

      {/* Summary Bar */}
      <div className="flex items-center gap-1.5 text-xs text-gray-300 font-semibold bg-white/[0.02] p-3 rounded-xl border border-white/5 justify-center">
        <span>✅ {totalFiles} {totalFiles === 1 ? 'file' : 'files'} modified</span>
        <span className="text-gray-600 px-1">·</span>
        <span className="text-green-400">+{totalAdditions} {totalAdditions === 1 ? 'addition' : 'additions'}</span>
        <span className="text-gray-600 px-1">·</span>
        <span className="text-red-400 font-semibold">-{totalDeletions} {totalDeletions === 1 ? 'deletion' : 'deletions'}</span>
      </div>

      {/* Diffs list */}
      <div className="flex flex-col gap-3 max-h-[350px] overflow-y-auto pr-1">
        {diffs.map((fileDiff) => {
          const isExpanded = !collapsedFiles[fileDiff.path];
          let actionLabel = 'modify';
          let badgeColor = '#fbbf24';
          let badgeBg = 'rgba(251, 191, 36, 0.1)';
          let FileIcon = FileText;

          if (fileDiff.action === 'create') {
            actionLabel = 'create';
            badgeColor = '#34d399';
            badgeBg = 'rgba(52, 211, 153, 0.1)';
            FileIcon = Plus;
          } else if (fileDiff.action === 'delete') {
            actionLabel = 'delete';
            badgeColor = '#f87171';
            badgeBg = 'rgba(248, 113, 113, 0.1)';
            FileIcon = Trash;
          }

          return (
            <div
              key={fileDiff.path}
              className="rounded-xl border border-white/5 overflow-hidden bg-white/[0.01]"
            >
              {/* File Title Bar */}
              <button
                onClick={() => toggleExpand(fileDiff.path)}
                className="w-full p-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 truncate mr-2">
                  <FileIcon className="w-4 h-4 flex-shrink-0" style={{ color: badgeColor }} />
                  <span className="font-mono text-xs text-gray-300 truncate">
                    {fileDiff.path}
                  </span>
                </div>

                <div className="flex items-center gap-3 select-none">
                  <span className="text-[10px] font-mono font-medium flex items-center gap-1.5 mr-1">
                    <span className="text-green-400">+{fileDiff.additions}</span>
                    <span className="text-red-400">-{fileDiff.deletions}</span>
                  </span>
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                    style={{ color: badgeColor, backgroundColor: badgeBg }}
                  >
                    {actionLabel}
                  </span>
                  <motion.div
                    animate={{ rotate: isExpanded ? 0 : -90 }}
                    transition={{ duration: 0.15 }}
                  >
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  </motion.div>
                </div>
              </button>

              {/* Collapsible Diff Body */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 pt-0 border-t border-white/5 bg-black/10 flex flex-col gap-3">
                      {fileDiff.status === 'partial' && fileDiff.skippedChanges && fileDiff.skippedChanges.length > 0 && (
                        <div className="p-3 mt-3 rounded-xl bg-orange-500/10 border border-orange-500/20 flex gap-2.5 items-start">
                          <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                          <div className="flex flex-col gap-1 text-xs">
                            <span className="font-bold text-orange-400">
                              ⚠️ {fileDiff.skippedChanges.length} {fileDiff.skippedChanges.length === 1 ? 'change' : 'changes'} could not be applied in {fileDiff.path}
                            </span>
                            {fileDiff.skippedChanges.map((sk, skIdx) => (
                              <div key={skIdx} className="text-orange-200 leading-normal">
                                • <span className="font-semibold">{sk.function}</span>: {sk.reason}. <span className="text-gray-400 italic">Suggestion: {sk.suggestion}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {fileDiff.hunks && fileDiff.hunks.map((hunk: any, hIdx: number) => {
                        let oldLineNum = hunk.oldStart;
                        let newLineNum = hunk.newStart;

                        return (
                          <div key={hIdx} className="flex flex-col">
                            {/* Hunk Header */}
                            <div className="text-[11px] font-mono font-semibold text-violet-400 py-1.5 px-3">
                              {hunk.functionName ? `${hunk.functionName}  line ${hunk.newStart}` : `line ${hunk.newStart}`}
                            </div>
                            
                            {/* Hunk Lines */}
                            <div className="flex flex-col py-1 bg-black/20 rounded-lg overflow-hidden border border-white/5">
                              {hunk.lines.map((line: string, lIdx: number) => {
                                let lineNum: string | number = '';
                                let bgColor = 'transparent';
                                let textColor = '#9ca3af';
                                const indicator = line[0];
                                const codeText = line.substring(1);

                                if (indicator === '+') {
                                  lineNum = newLineNum++;
                                  bgColor = '#0d2b0d';
                                  textColor = '#4ade80';
                                } else if (indicator === '-') {
                                  lineNum = oldLineNum++;
                                  bgColor = '#2b0d0d';
                                  textColor = '#f87171';
                                } else {
                                  lineNum = oldLineNum++;
                                  newLineNum++;
                                  textColor = '#6b7280';
                                }

                                return (
                                  <div
                                    key={lIdx}
                                    className="flex items-stretch text-[11px] font-mono hover:bg-white/[0.02] transition-colors leading-relaxed"
                                    style={{ backgroundColor: bgColor }}
                                  >
                                    {/* Line Number Column */}
                                    <div className="w-10 flex-shrink-0 text-right pr-2 select-none text-gray-500 border-r border-white/5 mr-2">
                                      {lineNum}
                                    </div>
                                    {/* Indicator Column */}
                                    <div 
                                      className="w-4 flex-shrink-0 text-center select-none font-bold"
                                      style={{ color: textColor }}
                                    >
                                      {indicator}
                                    </div>
                                    {/* Code Content Column */}
                                    <div className="flex-1 px-2 whitespace-pre overflow-x-auto" style={{ color: textColor }}>
                                      {codeText}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {/* Hunk Divider */}
                            {hIdx < fileDiff.hunks.length - 1 && (
                              <div className="border-t border-white/5 my-2" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Warnings block */}
      {warnings && warnings.length > 0 && (
        <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 flex gap-2.5 items-start">
          <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">Warnings during execution</span>
            {warnings.map((warning, wIdx) => (
              <p key={wIdx} className="text-xs text-orange-200 leading-tight">
                {warning}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onRollback}
          className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold border border-red-500/20 text-red-400 hover:text-red-300 hover:bg-red-500/5 transition-all flex items-center justify-center gap-1.5"
        >
          {isConfirmed ? <RotateCcw className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
          {rollbackLabel}
        </button>
        <button
          onClick={onAccept}
          className="flex-1 py-2 px-4 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all shadow-lg"
          style={{
            background: isConfirmed 
              ? 'linear-gradient(135deg, #10b981, #059669)'
              : 'linear-gradient(135deg, #7c3aed, #06b6d4)',
            boxShadow: isConfirmed
              ? '0 4px 14px rgba(16, 185, 129, 0.3)'
              : '0 4px 14px rgba(124, 58, 237, 0.3)',
          }}
        >
          {isConfirmed ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {acceptLabel}
        </button>
      </div>
    </motion.div>
  );
}
