'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Copy, Check, Download, Sparkles, X } from 'lucide-react';

interface ReadmeGeneratorProps {
  onClose: () => void;
}

function renderMarkdown(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold text-white mt-6 mb-3">{line.slice(2)}</h1>;
    if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold text-violet-300 mt-5 mb-2 border-b border-white/5 pb-2">{line.slice(3)}</h2>;
    if (line.startsWith('### ')) return <h3 key={i} className="text-base font-semibold text-cyan-300 mt-4 mb-2">{line.slice(4)}</h3>;
    if (line.startsWith('```')) return null;
    if (line.startsWith('> ')) return <blockquote key={i} className="border-l-2 border-violet-500/50 pl-4 my-2 text-gray-500 italic text-sm">{line.slice(2)}</blockquote>;
    if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="text-sm text-gray-400 ml-4 list-disc">{line.slice(2)}</li>;
    if (/^\d+\. /.test(line)) return <li key={i} className="text-sm text-gray-400 ml-4 list-decimal">{line.replace(/^\d+\. /, '')}</li>;
    if (line.trim() === '') return <div key={i} className="h-2" />;
    return <p key={i} className="text-sm text-gray-400 leading-relaxed">{line}</p>;
  });
}

export default function ReadmeGenerator({ onClose }: ReadmeGeneratorProps) {
  const [content, setContent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setContent('');
    setGenerating(true);
    setDone(false);

    try {
      const res = await fetch('/api/generate-readme', { method: 'POST' });
      if (!res.ok || !res.body) throw new Error('Failed to generate');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          setContent(prev => prev + chunk);
        }
      }
      setDone(true);
    } catch {
      setContent('Error generating documentation. Please try again.');
      setDone(true);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'README.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#07070f' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
          >
            <FileText className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Doc Generator</p>
            <p className="text-xs text-gray-600">AI-powered README creation</p>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Not started */}
        {!content && !generating && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(6,182,212,0.1))',
                border: '1px solid rgba(124,58,237,0.3)',
                boxShadow: '0 0 30px rgba(124,58,237,0.15)',
              }}
            >
              <Sparkles className="w-7 h-7 text-violet-400" />
            </motion.div>
            <h3 className="text-base font-semibold text-white mb-2">Generate README</h3>
            <p className="text-xs text-gray-600 mb-6 max-w-xs leading-relaxed">
              AI will analyze the indexed codebase and create a comprehensive, professional README file.
            </p>
            <motion.button
              onClick={generate}
              className="btn-primary flex items-center gap-2"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              <Sparkles className="w-4 h-4" />
              Generate Documentation
            </motion.button>
          </div>
        )}

        {/* Generating state */}
        {generating && !content && (
          <div className="flex flex-col items-center justify-center h-full">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="w-10 h-10 rounded-full mb-4"
              style={{ border: '2px solid rgba(124,58,237,0.3)', borderTopColor: '#7c3aed' }}
            />
            <p className="text-sm text-gray-500">Generating documentation...</p>
          </div>
        )}

        {/* Content streaming */}
        {content && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* Toolbar */}
            {done && (
              <div className="flex items-center gap-2 mb-5 p-3 rounded-xl"
                style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)' }}
              >
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-xs text-green-400 flex-1">Generated successfully</span>
                <button onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-violet-400 transition-colors px-2 py-1 rounded"
                >
                  {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button onClick={handleDownload}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-cyan-400 transition-colors px-2 py-1 rounded"
                >
                  <Download className="w-3 h-3" />
                  Download
                </button>
                <button onClick={generate}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-violet-400 transition-colors px-2 py-1 rounded"
                >
                  <Sparkles className="w-3 h-3" />
                  Regenerate
                </button>
              </div>
            )}

            {/* Rendered content */}
            <div className="prose-dark space-y-1">
              {renderMarkdown(content)}
              {generating && (
                <span className="inline-block w-0.5 h-4 ml-0.5 align-text-bottom animate-blink"
                  style={{ background: '#7c3aed' }}
                />
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
