'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, ArrowRight, Zap, Brain, Search, FileCode } from 'lucide-react';

const TYPEWRITER_TEXTS = [
  "Ask anything. About any codebase.",
  "Understand any repo. Instantly.",
  "Your AI-powered code navigator.",
];

const FEATURES = [
  { icon: GitBranch, title: "Clone & Index", desc: "Any public GitHub repo cloned and indexed in seconds" },
  { icon: Brain, title: "AI Chat", desc: "Ask questions in plain English, get expert answers" },
  { icon: Search, title: "Semantic Search", desc: "Find relevant code with vector embeddings" },
  { icon: FileCode, title: "Doc Generator", desc: "One-click README and documentation creation" },
];

interface LandingPageProps {
  onSubmit: (url: string) => void;
}

export default function LandingPage({ onSubmit }: LandingPageProps) {
  const [url, setUrl] = useState('');
  const [focused, setFocused] = useState(false);
  const [textIndex, setTextIndex] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const mouseRef = useRef({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Typewriter effect
  useEffect(() => {
    const target = TYPEWRITER_TEXTS[textIndex];
    const timeout = setTimeout(() => {
      if (!isDeleting) {
        if (displayed.length < target.length) {
          setDisplayed(target.slice(0, displayed.length + 1));
        } else {
          setTimeout(() => setIsDeleting(true), 2000);
        }
      } else {
        if (displayed.length > 0) {
          setDisplayed(displayed.slice(0, -1));
        } else {
          setIsDeleting(false);
          setTextIndex((i) => (i + 1) % TYPEWRITER_TEXTS.length);
        }
      }
    }, isDeleting ? 40 : 65);
    return () => clearTimeout(timeout);
  }, [displayed, isDeleting, textIndex]);

  // Mouse parallax
  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouse);
    return () => window.removeEventListener('mousemove', handleMouse);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit(url.trim());
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden animated-gradient">
      {/* Grid background */}
      <div className="absolute inset-0 grid-bg opacity-40" />

      {/* Radial glow that follows mouse */}
      <div
        className="pointer-events-none absolute inset-0 transition-all duration-1000"
        style={{
          background: `radial-gradient(600px at ${mousePos.x}px ${mousePos.y}px, rgba(124,58,237,0.07) 0%, transparent 70%)`,
        }}
      />

      {/* Corner glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl"
        style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }} />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl"
        style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)' }} />

      {/* Floating particles */}
      {[...Array(25)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: Math.random() * 4 + 1,
            height: Math.random() * 4 + 1,
            background: i % 3 === 0 ? 'rgba(124,58,237,0.6)' : i % 3 === 1 ? 'rgba(6,182,212,0.4)' : 'rgba(167,139,250,0.3)',
            left: `${10 + Math.random() * 80}%`,
            top: `${10 + Math.random() * 80}%`,
          }}
          animate={{
            y: [0, -40, 0],
            x: [0, Math.random() * 20 - 10, 0],
            opacity: [0.2, 0.7, 0.2],
          }}
          transition={{
            duration: 4 + Math.random() * 4,
            repeat: Infinity,
            delay: Math.random() * 4,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Scanline */}
      <div className="scanline" />

      {/* Header nav */}
      <motion.nav
        className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(6,182,212,0.2))',
              border: '1px solid rgba(124,58,237,0.4)',
            }}
          >
            <GitBranch className="w-4 h-4 text-violet-400" />
          </div>
          <span className="font-bold text-white text-lg tracking-tight">RepoMind</span>
        </div>
        <div className="text-xs font-mono text-gray-600 hidden sm:block">v1.0.0 · AI-powered</div>
      </motion.nav>

      {/* Hero content */}
      <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-mono mb-8"
          style={{
            background: 'rgba(124,58,237,0.1)',
            border: '1px solid rgba(124,58,237,0.25)',
            color: '#a78bfa',
          }}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
          </span>
          Powered by Gemini AI + Semantic Embeddings
        </motion.div>

        {/* Headline with typewriter */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="mb-6"
        >
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight leading-tight mb-0">
            <span className="text-white">Chat with</span>{' '}
            <span className="gradient-text">any codebase.</span>
          </h1>
          <div className="h-14 flex items-center justify-center mt-3">
            <p className="text-xl text-gray-400 font-medium">
              {displayed}
              <span className="animate-blink text-violet-400 ml-0.5">|</span>
            </p>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-gray-500 text-sm mb-10 max-w-md mx-auto leading-relaxed"
        >
          Paste any public GitHub URL. RepoMind clones, indexes, and lets you
          have a conversation with the entire codebase using AI.
        </motion.p>

        {/* URL Input */}
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto"
        >
          <div className="relative flex-1">
            <motion.div
              className="absolute inset-0 rounded-xl pointer-events-none"
              animate={{
                boxShadow: focused
                  ? '0 0 0 1px rgba(124,58,237,0.5), 0 0 20px rgba(124,58,237,0.2), 0 0 40px rgba(124,58,237,0.1)'
                  : '0 0 0 1px rgba(255,255,255,0.06)',
              }}
              transition={{ duration: 0.3 }}
            />
            <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
              <GitBranch className="w-4 h-4 text-gray-600" />
            </div>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="https://github.com/user/repository"
              required
              className="w-full pl-11 pr-4 py-4 rounded-xl text-sm bg-space-800/80 text-gray-200 placeholder-gray-600 focus:outline-none font-mono"
              style={{
                background: 'rgba(17,17,24,0.8)',
                border: '1px solid transparent',
              }}
            />
          </div>

          <motion.button
            type="submit"
            className="btn-primary flex items-center gap-2 whitespace-nowrap"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            <Zap className="w-4 h-4" />
            Analyze Repo
            <ArrowRight className="w-4 h-4" />
          </motion.button>
        </motion.form>

        {/* Example repos */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="mt-4 flex flex-wrap items-center justify-center gap-2"
        >
          <span className="text-xs text-gray-600">Try:</span>
          {['vercel/next.js', 'facebook/react', 'tailwindlabs/tailwindcss'].map(repo => (
            <button
              key={repo}
              onClick={() => setUrl(`https://github.com/${repo}`)}
              className="text-xs font-mono text-gray-500 hover:text-violet-400 transition-colors px-2 py-1 rounded border border-white/5 hover:border-violet-500/30 hover:bg-violet-500/5"
            >
              {repo}
            </button>
          ))}
        </motion.div>
      </div>

      {/* Feature cards */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.0, duration: 0.6 }}
        className="absolute bottom-8 left-0 right-0 px-8"
      >
        <div className="max-w-3xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-3">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              className="glass rounded-xl p-4 text-center group cursor-default"
              whileHover={{ y: -3, transition: { duration: 0.2 } }}
              style={{ border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <div className="w-8 h-8 rounded-lg mx-auto mb-3 flex items-center justify-center"
                style={{ background: 'rgba(124,58,237,0.15)' }}
              >
                <Icon className="w-4 h-4 text-violet-400 group-hover:text-cyan-400 transition-colors" />
              </div>
              <p className="text-xs font-semibold text-white mb-1">{title}</p>
              <p className="text-xs text-gray-600 leading-relaxed hidden sm:block">{desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
