'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Check, Link, Package, FolderTree, Brain, Sparkles } from 'lucide-react';

export type IngestionStep =
  | 'connecting'
  | 'cloning'
  | 'parsing'
  | 'embedding'
  | 'ready';

const STEPS: { key: IngestionStep; icon: React.ElementType; label: string; detail: string }[] = [
  { key: 'connecting', icon: Link, label: 'Connecting to GitHub', detail: 'Resolving repository...' },
  { key: 'cloning', icon: Package, label: 'Cloning repository', detail: 'Fetching source files...' },
  { key: 'parsing', icon: FolderTree, label: 'Parsing file structure', detail: 'Walking directory tree...' },
  { key: 'embedding', icon: Brain, label: 'Generating embeddings', detail: 'Vectorizing codebase...' },
  { key: 'ready', icon: Sparkles, label: 'Ready to chat', detail: 'Index complete!' },
];

const STEP_ORDER: IngestionStep[] = ['connecting', 'cloning', 'parsing', 'embedding', 'ready'];

interface IngestionLoaderProps {
  currentStep: IngestionStep;
  repoUrl: string;
  error?: string;
}

export default function IngestionLoader({ currentStep, repoUrl, error }: IngestionLoaderProps) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{ background: '#04040a' }}
    >
      {/* Animated grid */}
      <div className="absolute inset-0 grid-bg opacity-30" />

      {/* Central radial glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(124,58,237,0.1) 0%, transparent 70%)' }}
      />

      {/* Flowing lines animation */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute h-px w-96 opacity-20"
          style={{
            background: `linear-gradient(90deg, transparent, ${i % 2 === 0 ? '#7c3aed' : '#06b6d4'}, transparent)`,
            top: `${15 + i * 14}%`,
            left: '-50%',
          }}
          animate={{ x: ['0%', '200%'] }}
          transition={{
            duration: 3 + i * 0.5,
            repeat: Infinity,
            delay: i * 0.4,
            ease: 'linear',
          }}
        />
      ))}

      <div className="relative z-10 w-full max-w-md px-4">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h2 className="text-2xl font-bold gradient-text mb-2">Indexing Codebase</h2>
          <p className="text-xs font-mono text-gray-600 truncate">{repoUrl}</p>
        </motion.div>

        {/* Steps */}
        <div className="space-y-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const stepIndex = STEP_ORDER.indexOf(step.key);
            const isCompleted = stepIndex < currentIndex;
            const isActive = step.key === currentStep;
            const isPending = stepIndex > currentIndex;

            return (
              <motion.div
                key={step.key}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="relative flex items-center gap-4 rounded-xl px-4 py-3 transition-all duration-500"
                style={{
                  background: isActive
                    ? 'rgba(124,58,237,0.1)'
                    : isCompleted
                    ? 'rgba(6,182,212,0.05)'
                    : 'rgba(255,255,255,0.02)',
                  border: isActive
                    ? '1px solid rgba(124,58,237,0.3)'
                    : isCompleted
                    ? '1px solid rgba(6,182,212,0.15)'
                    : '1px solid rgba(255,255,255,0.04)',
                  boxShadow: isActive ? '0 0 20px rgba(124,58,237,0.1)' : 'none',
                }}
              >
                {/* Icon / Check */}
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-500"
                  style={{
                    background: isCompleted
                      ? 'rgba(6,182,212,0.2)'
                      : isActive
                      ? 'rgba(124,58,237,0.2)'
                      : 'rgba(255,255,255,0.04)',
                  }}
                >
                  <AnimatePresence mode="wait">
                    {isCompleted ? (
                      <motion.div
                        key="check"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                      >
                        <Check className="w-4 h-4 text-cyan-400" />
                      </motion.div>
                    ) : isActive ? (
                      <motion.div
                        key="spinner"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                      >
                        <Icon className="w-4 h-4 text-violet-400" />
                      </motion.div>
                    ) : (
                      <Icon key="idle" className="w-4 h-4 text-gray-700" />
                    )}
                  </AnimatePresence>
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium transition-colors ${
                    isCompleted ? 'text-cyan-400' : isActive ? 'text-white' : 'text-gray-600'
                  }`}>
                    {step.label}
                  </p>
                  {isActive && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs text-gray-600 font-mono mt-0.5"
                    >
                      {step.detail}
                    </motion.p>
                  )}
                </div>

                {/* Active shimmer */}
                {isActive && (
                  <motion.div
                    className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <motion.div
                      className="absolute inset-0"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.08), transparent)',
                      }}
                      animate={{ x: ['-100%', '200%'] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    />
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Error state */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 p-4 rounded-xl text-sm text-red-400 font-mono"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <p className="font-semibold mb-1">Error</p>
            <p className="text-red-500/80 text-xs">{error}</p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
