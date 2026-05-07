'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Copy, Check, GitBranch } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { ChatMessage } from '../types';

const SUGGESTIONS = [
  "Where is authentication handled?",
  "Explain the folder structure",
  "What does the main entry point do?",
  "How is state managed?",
  "What are the key dependencies?",
];

// Parse markdown and render code blocks with syntax highlighting
function MessageContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="prose-dark text-sm leading-relaxed">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0].trim() || 'text';
          const code = lines.slice(1).join('\n');
          return <CodeBlock key={i} code={code} language={lang} />;
        }
        // Render inline code, bold, and regular text
        const segments = part.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
        return (
          <span key={i}>
            {segments.map((seg, j) => {
              if (seg.startsWith('`') && seg.endsWith('`')) {
                return <code key={j} className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>{seg.slice(1,-1)}</code>;
              }
              if (seg.startsWith('**') && seg.endsWith('**')) {
                return <strong key={j} className="font-semibold text-white">{seg.slice(2,-2)}</strong>;
              }
              return <span key={j}>{seg}</span>;
            })}
          </span>
        );
      })}
      {isStreaming && <span className="inline-block w-0.5 h-4 ml-0.5 align-text-bottom animate-blink" style={{ background: '#7c3aed' }} />}
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-3 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2"
        style={{ background: 'rgba(10,10,15,0.9)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <span className="text-xs font-mono text-gray-600">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-violet-400 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          background: 'rgba(6,6,10,0.95)',
          fontSize: '0.75rem',
          padding: '1rem',
          fontFamily: "'JetBrains Mono', monospace",
        }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

interface ChatInterfaceProps {
  activeFile?: string | null;
}

export default function ChatInterface({ activeFile }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [localActiveFile, setLocalActiveFile] = useState<string | null>(activeFile || null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [fallbackToast, setFallbackToast] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (activeFile) setLocalActiveFile(activeFile);
  }, [activeFile]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '' };
    setMessages(prev => [...prev, assistantPlaceholder]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, activeFile: localActiveFile }),
      });

      if (!res.ok || !res.body) throw new Error('Request failed');

      if (res.headers.get('x-fallback-used') === 'true') {
        setFallbackToast(true);
        setTimeout(() => setFallbackToast(false), 5000);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: updated[updated.length - 1].content + chunk };
            return updated;
          });
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' };
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        height: '100%',
        minHeight: 0,          // ← critical: allows the column to shrink within its parent
        background: '#080810',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
        >
          <GitBranch className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">RepoMind AI</p>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <p className="text-xs text-gray-600">Semantic search active</p>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {fallbackToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-medium backdrop-blur-md z-50 flex items-center gap-2"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            Using cloud fallback (Groq)
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages — flex:1 + minHeight:0 means it fills space and scrolls internally */}
      <div
        style={{
          flex: 1,
          minHeight: 0,          // ← critical flex overflow fix
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Empty state */}
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center h-full text-center pb-8"
          >
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(6,182,212,0.1))',
                border: '1px solid rgba(124,58,237,0.2)',
              }}
            >
              <GitBranch className="w-7 h-7 text-violet-400" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">Ask about the codebase</h3>
            <p className="text-xs text-gray-600 mb-6 max-w-[220px] leading-relaxed">
              I have indexed the repository and I am ready to answer your questions.
            </p>
            {/* Suggestion chips */}
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {SUGGESTIONS.map((s) => (
                <motion.button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-400 hover:text-white transition-all duration-200"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                  whileHover={{ scale: 1.02, borderColor: 'rgba(124,58,237,0.3)', backgroundColor: 'rgba(124,58,237,0.06)' }}
                  whileTap={{ scale: 0.98 }}
                >
                  {s}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Message list */}
        <AnimatePresence initial={false}>
          {messages.map((msg, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex items-start gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar */}
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5"
                  style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.3)' }}
                >
                  <GitBranch className="w-3.5 h-3.5 text-violet-400" />
                </div>
              )}

              {/* Bubble */}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role === 'user' ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}
                style={msg.role === 'user' ? {
                  background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                  boxShadow: '0 4px 20px rgba(124,58,237,0.25)',
                } : {
                  background: 'rgba(17,17,28,0.8)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  backdropFilter: 'blur(10px)',
                }}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm text-white leading-relaxed">{msg.content}</p>
                ) : (
                  <MessageContent
                    content={msg.content}
                    isStreaming={isLoading && idx === messages.length - 1 && msg.content !== ''}
                  />
                )}
                {/* Loading dots */}
                {isLoading && idx === messages.length - 1 && msg.content === '' && (
                  <div className="flex gap-1 py-1">
                    {[0, 1, 2].map(i => (
                      <motion.div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-violet-400"
                        animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="px-4 pb-4 flex-shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        <AnimatePresence>
          {localActiveFile && (
            <motion.div
              initial={{ opacity: 0, y: 10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: 10, height: 0 }}
              className="mt-3 flex"
            >
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-mono">
                <span>📄</span>
                <span className="truncate max-w-[200px]">{localActiveFile.split('/').pop()}</span>
                <button
                  onClick={() => setLocalActiveFile(null)}
                  className="ml-1 hover:text-white transition-colors"
                  title="Clear file context"
                >
                  &times;
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="relative mt-2 rounded-xl overflow-hidden"
          style={{
            background: 'rgba(17,17,28,0.8)',
            border: '1px solid rgba(124,58,237,0.2)',
            boxShadow: '0 0 20px rgba(124,58,237,0.08)',
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about the codebase..."
            rows={1}
            disabled={isLoading}
            className="w-full px-4 pt-3.5 pb-3 pr-12 bg-transparent text-gray-200 text-sm placeholder-gray-600 focus:outline-none resize-none font-sans"
            style={{ maxHeight: '120px' }}
          />
          <motion.button
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            className="absolute right-2 bottom-2 w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{
              background: input.trim() && !isLoading ? 'linear-gradient(135deg, #7c3aed, #06b6d4)' : 'rgba(255,255,255,0.04)',
            }}
            whileHover={input.trim() && !isLoading ? { scale: 1.05 } : {}}
            whileTap={input.trim() && !isLoading ? { scale: 0.95 } : {}}
          >
            <Send className="w-3.5 h-3.5 text-white" />
          </motion.button>
        </div>
        <p className="text-center text-xs text-gray-700 mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
