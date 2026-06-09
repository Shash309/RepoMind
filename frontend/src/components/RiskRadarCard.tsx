'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, ChevronDown, ChevronRight,
  Copy, Check, Zap, RotateCcw, GitBranch,
} from 'lucide-react';
import type { RiskRadarResult, AffectedFile, RiskStep } from '../hooks/useRiskRadar';
import DependencyGraph from './DependencyGraph';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RiskRadarCardProps {
  result: RiskRadarResult;
  onSwitchToActMode: () => void;
  onDismiss: () => void;
  onOpenFile?: (filePath: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
};

const RISK_BG: Record<string, string> = {
  critical: 'rgba(239,68,68,0.10)',
  high:     'rgba(249,115,22,0.10)',
  medium:   'rgba(234,179,8,0.10)',
  low:      'rgba(34,197,94,0.10)',
};

const RISK_GLOW: Record<string, string> = {
  critical: '0 0 24px rgba(239,68,68,0.18)',
  high:     '0 0 16px rgba(249,115,22,0.12)',
  medium:   '0 0 10px rgba(234,179,8,0.08)',
  low:      'none',
};

const RISK_EMOJI: Record<string, string> = {
  critical: '🔴', high: '🟠', medium: '🟡', low: '🟢',
};

const COMPLEXITY_COLOR: Record<string, string> = {
  complex:  '#ef4444',
  moderate: '#f97316',
  simple:   '#22c55e',
};

const RELATION_LABEL: Record<string, string> = {
  direct_dependency:   'Direct dep',
  indirect_dependency: 'Indirect dep',
  test:                'Test file',
  shared_state:        'Shared state',
  similar_logic:       'Similar logic',
};

function riskLevel(level: string) {
  return (level || 'low').toLowerCase() as 'critical' | 'high' | 'medium' | 'low';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RiskScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-400 font-medium">Risk Score</span>
        <span className="text-sm font-bold tabular-nums" style={{ color }}>
          {score}<span className="text-xs text-gray-500 font-normal">/100</span>
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}99, ${color})` }}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        />
      </div>
    </div>
  );
}

function ImpactStat({ value, label, color }: { value: string | number; label: string; color?: string }) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center p-2.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <span className="text-base font-bold leading-none" style={{ color: color || '#fff' }}>
        {value}
      </span>
      <span className="text-[9px] text-gray-500 mt-1 text-center leading-tight">{label}</span>
    </div>
  );
}

function CircularDepBadge({ chain, description }: { chain: string[]; description: string }) {
  return (
    <motion.div
      animate={{ borderColor: ['rgba(249,115,22,0.3)', 'rgba(249,115,22,0.7)', 'rgba(249,115,22,0.3)'] }}
      transition={{ duration: 2, repeat: Infinity }}
      className="flex items-start gap-2.5 p-3 rounded-xl"
      style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.3)' }}
    >
      <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-1">
          Circular Dependency Detected
        </p>
        <p className="text-[11px] text-orange-200 font-mono leading-tight break-all">
          {chain.join(' → ')}
        </p>
        {description && (
          <p className="text-[10px] text-orange-300/70 mt-1">{description}</p>
        )}
      </div>
    </motion.div>
  );
}

function FileRow({
  file,
  onOpenFile,
}: {
  file: AffectedFile;
  onOpenFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const level = riskLevel(file.riskLevel);
  const color = RISK_COLORS[level];
  const bg = RISK_BG[level];
  const emoji = RISK_EMOJI[level];
  const funcCount = file.affectedFunctions?.length ?? 0;

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{ border: `1px solid ${color}22`, background: bg }}
    >
      {/* Header row */}
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 text-left group"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm flex-shrink-0">{emoji}</span>
          <span
            className="font-mono text-xs text-gray-300 truncate group-hover:text-white transition-colors"
            title={file.path}
            onClick={e => { e.stopPropagation(); onOpenFile?.(file.path); }}
          >
            {file.path}
          </span>
          {file.changeRequired && (
            <span
              className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ color, background: `${color}22` }}
            >
              Change Required
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span
            className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ color, background: `${color}22` }}
          >
            {level}
          </span>
          <span className="text-[10px] text-gray-600">
            {RELATION_LABEL[file.relationshipType] || file.relationshipType}
          </span>
          {funcCount > 0 && (
            expanded
              ? <ChevronDown className="w-3 h-3 text-gray-500 flex-shrink-0" />
              : <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />
          )}
        </div>
      </button>

      {/* Reason */}
      <div className="px-3 pb-2">
        <p className="text-[10px] text-gray-500 leading-tight">{file.reason}</p>
      </div>

      {/* Expanded: functions + action */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="px-3 pb-3 pt-1 flex flex-col gap-2 border-t"
              style={{ borderColor: `${color}20` }}
            >
              {/* Affected functions */}
              {funcCount > 0 && (
                <div>
                  <p className="text-[9px] text-gray-600 uppercase tracking-wider font-semibold mb-1.5">
                    Affected Functions
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {file.affectedFunctions.map(fn => (
                      <span
                        key={fn.name}
                        className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                        title={fn.reason}
                      >
                        <span style={{ color }}>{fn.changeRequired ? '⚠' : '·'}</span>
                        <span className="text-gray-300">{fn.name}()</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested action */}
              {file.suggestedAction && (
                <div>
                  <p className="text-[9px] text-gray-600 uppercase tracking-wider font-semibold mb-0.5">
                    Suggested Action
                  </p>
                  <p className="text-[10px] text-gray-400 leading-tight">{file.suggestedAction}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RiskRadarCard({
  result,
  onSwitchToActMode,
  onDismiss,
  onOpenFile,
}: RiskRadarCardProps) {
  const [copied, setCopied] = useState(false);

  const { dependencyMap, riskScore, changeOrder, target, userRequest } = result;
  const affected = dependencyMap?.affectedFiles ?? [];
  const circulars = dependencyMap?.circularDependencies ?? [];
  const hiddenRisks = dependencyMap?.hiddenRisks ?? [];
  const orderSteps = changeOrder?.changeOrder ?? [];
  const overallLevel = (riskScore?.level ?? 'LOW').toLowerCase() as 'critical' | 'high' | 'medium' | 'low';
  const riskColor = riskScore?.color ?? RISK_COLORS.low;
  const glowStyle = RISK_GLOW[overallLevel];

  const handleCopyReport = () => {
    const report = [
      `# Risk Radar Report`,
      `Request: "${userRequest}"`,
      `Risk Level: ${riskScore?.level} (${riskScore?.score}/100)`,
      `\n## Affected Files (${affected.length})`,
      ...affected.map(f =>
        `- [${f.riskLevel.toUpperCase()}] ${f.path}\n  Reason: ${f.reason}\n  Action: ${f.suggestedAction}`
      ),
      `\n## Change Order`,
      ...orderSteps.map(s => `${s.step}. ${s.file} (${s.estimatedComplexity}) — ${s.action}`),
      changeOrder?.estimatedImpact
        ? `\n## Impact\nTime: ${changeOrder.estimatedImpact.timeEstimate} | Breaking: ${changeOrder.estimatedImpact.breakingChange}`
        : '',
    ].join('\n');

    navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="w-full flex flex-col gap-4 p-5 rounded-2xl"
      style={{
        background: 'rgba(17,17,28,0.9)',
        border: `1px solid ${riskColor}33`,
        boxShadow: `0 8px 40px rgba(0,0,0,0.4), ${glowStyle}`,
        backdropFilter: 'blur(16px)',
      }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${riskColor}18`, border: `1px solid ${riskColor}40` }}
          >
            <span className="text-base leading-none">🎯</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-widest uppercase text-gray-400">
                Risk Radar
              </span>
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ color: riskColor, background: `${riskColor}22`, border: `1px solid ${riskColor}44` }}
              >
                {riskScore?.emoji} {riskScore?.level ?? 'UNKNOWN'} RISK
              </span>
            </div>
            <blockquote className="text-[11px] text-gray-400 italic mt-0.5 leading-tight">
              &ldquo;{userRequest}&rdquo;
            </blockquote>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-600 hover:text-gray-400 transition-colors text-xs flex-shrink-0"
        >
          ✕
        </button>
      </div>

      {/* ── Risk Score Bar ────────────────────────────────────────────────── */}
      {riskScore && (
        <RiskScoreBar score={riskScore.score} color={riskColor} />
      )}

      {/* ── Impact Summary Grid ───────────────────────────────────────────── */}
      {riskScore?.summary && (
        <div className="flex gap-2">
          <ImpactStat
            value={riskScore.summary.totalAffected}
            label="Files Affected"
            color="#a78bfa"
          />
          <ImpactStat
            value={riskScore.summary.criticalFiles}
            label="Critical Risk"
            color="#ef4444"
          />
          <ImpactStat
            value={riskScore.summary.highRiskFiles}
            label="High Risk"
            color="#f97316"
          />
          <ImpactStat
            value={riskScore.summary.changeRequired}
            label="Must Change"
            color="#eab308"
          />
        </div>
      )}

      {/* Test coverage note */}
      {riskScore?.summary.testCoverage && (
        <p className="text-[10px] text-gray-600">
          🧪 {riskScore.summary.testCoverage}
        </p>
      )}

      {/* ── Circular Dependencies ─────────────────────────────────────────── */}
      {circulars.length > 0 && (
        <div className="flex flex-col gap-2">
          {circulars.map((c, i) => (
            <CircularDepBadge key={i} chain={c.chain} description={c.description} />
          ))}
        </div>
      )}

      {/* ── Dependency Graph (≤10 files) ──────────────────────────────────── */}
      {affected.length > 0 && affected.length <= 10 && (
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold mb-2">
            Dependency Graph
          </p>
          <DependencyGraph
            affectedFiles={affected}
            targetFile={target?.file ?? null}
            onNodeClick={onOpenFile}
          />
        </div>
      )}

      {/* ── Files at Risk ─────────────────────────────────────────────────── */}
      {affected.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-2.5">
            Files at Risk ({affected.length})
          </p>
          <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
            {affected
              .sort((a, b) => {
                const order = { critical: 0, high: 1, medium: 2, low: 3 };
                return (order[riskLevel(a.riskLevel)] ?? 4) - (order[riskLevel(b.riskLevel)] ?? 4);
              })
              .map(file => (
                <FileRow key={file.path} file={file} onOpenFile={onOpenFile} />
              ))}
          </div>
        </div>
      )}

      {/* ── Hidden Risks ──────────────────────────────────────────────────── */}
      {hiddenRisks.length > 0 && (
        <div
          className="p-3 rounded-xl"
          style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.15)' }}
        >
          <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-1.5">
            ⚡ Hidden Risks
          </p>
          <div className="flex flex-col gap-1">
            {hiddenRisks.map((r, i) => (
              <p key={i} className="text-[10px] text-violet-300/80 leading-tight">• {r}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── Safe Change Order ─────────────────────────────────────────────── */}
      {orderSteps.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-2.5">
            📋 Recommended Change Order
          </p>
          <div className="flex flex-col gap-1.5">
            {orderSteps.map(step => (
              <div key={step.step} className="flex items-start gap-2.5">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold mt-0.5"
                  style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}
                >
                  {step.step}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[11px] text-gray-300 truncate"
                      title={step.file}
                    >
                      {step.file}
                    </span>
                    <span
                      className="text-[8px] font-semibold uppercase px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{
                        color: COMPLEXITY_COLOR[step.estimatedComplexity] || '#a78bfa',
                        background: `${COMPLEXITY_COLOR[step.estimatedComplexity] || '#7c3aed'}18`,
                      }}
                    >
                      {step.estimatedComplexity}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-600 leading-tight mt-0.5">{step.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Warnings from change order ────────────────────────────────────── */}
      {(changeOrder?.warnings?.length ?? 0) > 0 && (
        <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 flex gap-2.5 items-start">
          <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">
              Warnings
            </span>
            {changeOrder!.warnings.map((w, i) => (
              <p key={i} className="text-[10px] text-orange-200 leading-tight">{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── Estimated Impact Footer ───────────────────────────────────────── */}
      {changeOrder?.estimatedImpact && (
        <div
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-[10px]"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <span className="text-gray-500">
            🕐 <span className="text-gray-300 font-medium">{changeOrder.estimatedImpact.timeEstimate}</span>
          </span>
          {changeOrder.estimatedImpact.breakingChange && (
            <span className="text-red-400 font-semibold">⚠ Breaking change</span>
          )}
          {changeOrder.estimatedImpact.requiresTeamReview && (
            <span className="text-yellow-400 font-semibold">👥 Team review required</span>
          )}
        </div>
      )}

      {/* ── Action Buttons ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 pt-1">
        <button
          onClick={handleCopyReport}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-all"
        >
          {copied
            ? <><Check className="w-3.5 h-3.5 text-green-400" /> Copied!</>
            : <><Copy className="w-3.5 h-3.5" /> Copy Report</>
          }
        </button>

        <button
          onClick={onSwitchToActMode}
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all shadow-lg"
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
            boxShadow: '0 4px 14px rgba(124,58,237,0.3)',
          }}
        >
          <Zap className="w-3.5 h-3.5 fill-current" />
          Switch to Act Mode
        </button>
      </div>
    </motion.div>
  );
}
