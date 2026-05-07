'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Copy, Check, FileText } from 'lucide-react';

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', java: 'java', rs: 'rust',
    css: 'css', html: 'html', json: 'json', md: 'markdown',
    sh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'toml', c: 'c', cpp: 'cpp',
  };
  return map[ext] || 'text';
}

interface FileViewerProps {
  filePath: string | null;
}

export default function FileViewer({ filePath }: FileViewerProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!filePath) return;
    const fetchFile = async () => {
      setLoading(true);
      setError('');
      setContent('');
      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error('File not found or could not be read.');
        const text = await res.text();
        setContent(text);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchFile();
  }, [filePath]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!filePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <FileText className="w-6 h-6 text-gray-700" />
        </div>
        <p className="text-sm text-gray-600">Select a file from the explorer</p>
        <p className="text-xs text-gray-700 mt-1">to view its contents with syntax highlighting</p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={filePath}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        {/* File path breadcrumb */}
        <div className="flex items-center justify-between px-4 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          <p className="text-xs font-mono text-gray-600 truncate flex-1">{filePath}</p>
          {content && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-violet-400 transition-colors ml-3 flex-shrink-0"
            >
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {loading && (
            <div className="flex items-center justify-center h-full">
              {/* Skeleton loader */}
              <div className="w-full max-w-lg px-6 space-y-3">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-3 rounded animate-pulse"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      width: `${40 + Math.random() * 55}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-red-400/70">{error}</p>
            </div>
          )}

          {!loading && !error && content && (
            <SyntaxHighlighter
              language={getLanguage(filePath)}
              style={oneDark}
              showLineNumbers
              customStyle={{
                margin: 0,
                background: 'transparent',
                fontSize: '0.72rem',
                padding: '1rem',
                fontFamily: "'JetBrains Mono', monospace",
                height: '100%',
              }}
              lineNumberStyle={{
                color: 'rgba(255,255,255,0.12)',
                minWidth: '2.5rem',
              }}
              wrapLongLines={false}
            >
              {content}
            </SyntaxHighlighter>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
