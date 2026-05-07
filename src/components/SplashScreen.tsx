'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const PHASES = [
  "Initializing neural index...",
  "Calibrating semantic engine...",
  "Warming up embeddings...",
  "Mounting vector store...",
  "System ready.",
];

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Animate progress bar
    const progressInterval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return p + 1;
      });
    }, 22);

    // Cycle through phases
    const phaseInterval = setInterval(() => {
      setPhase(p => Math.min(p + 1, PHASES.length - 1));
    }, 550);

    // Complete after 2.8 seconds
    const timer = setTimeout(() => {
      setDone(true);
      setTimeout(onComplete, 600);
    }, 2800);

    return () => {
      clearInterval(progressInterval);
      clearInterval(phaseInterval);
      clearTimeout(timer);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          key="splash"
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
          style={{ background: '#04040a' }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
        >
          {/* Animated grid background */}
          <div className="absolute inset-0 grid-bg opacity-30" />

          {/* Radial glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(124,58,237,0.12) 0%, transparent 70%)',
            }}
          />

          {/* Floating particles */}
          {[...Array(20)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                width: Math.random() * 3 + 1,
                height: Math.random() * 3 + 1,
                background: i % 2 === 0 ? '#7c3aed' : '#06b6d4',
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                opacity: 0.4,
              }}
              animate={{
                y: [0, -30, 0],
                opacity: [0.2, 0.6, 0.2],
              }}
              transition={{
                duration: 2 + Math.random() * 3,
                repeat: Infinity,
                delay: Math.random() * 2,
                ease: 'easeInOut',
              }}
            />
          ))}

          {/* Logo */}
          <motion.div
            className="relative mb-16"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: 'backOut' }}
          >
            {/* Outer ring */}
            <motion.div
              className="absolute -inset-8 rounded-full border border-violet-600/20"
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            />
            <motion.div
              className="absolute -inset-4 rounded-full border border-cyan-500/20"
              animate={{ rotate: -360 }}
              transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
            />

            {/* Glow center */}
            <div
              className="relative flex items-center justify-center w-20 h-20 rounded-2xl"
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(6,182,212,0.1))',
                border: '1px solid rgba(124,58,237,0.4)',
                boxShadow: '0 0 40px rgba(124,58,237,0.3), 0 0 80px rgba(124,58,237,0.1)',
              }}
            >
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <path d="M8 32 L8 12 L20 4 L32 12 L32 32 L20 28 Z" stroke="url(#logoGrad)" strokeWidth="1.5" fill="none" />
                <path d="M8 12 L20 20 L32 12" stroke="url(#logoGrad)" strokeWidth="1.5" fill="none" />
                <path d="M20 20 L20 28" stroke="url(#logoGrad)" strokeWidth="1.5" fill="none" />
                <circle cx="20" cy="20" r="3" fill="#7c3aed" />
                <defs>
                  <linearGradient id="logoGrad" x1="0" y1="0" x2="40" y2="40">
                    <stop offset="0%" stopColor="#a78bfa" />
                    <stop offset="100%" stopColor="#06b6d4" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </motion.div>

          {/* Brand name */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="text-center mb-12"
          >
            <h1 className="text-4xl font-bold tracking-tight mb-1">
              <span className="gradient-text">RepoMind</span>
            </h1>
            <p className="text-sm text-gray-500 font-mono tracking-widest uppercase">Live Codebase Intelligence</p>
          </motion.div>

          {/* Progress bar */}
          <motion.div
            className="w-72"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <div className="relative h-0.5 bg-white/5 rounded-full overflow-hidden mb-4">
              <motion.div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #7c3aed, #06b6d4)',
                  boxShadow: '0 0 8px rgba(124,58,237,0.6)',
                }}
              />
            </div>

            {/* Phase text */}
            <div className="h-5 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.p
                  key={phase}
                  className="text-center text-xs font-mono text-gray-500"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                >
                  {PHASES[phase]}
                </motion.p>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
