'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, FileText, ChevronLeft, ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import FileTree from './FileTree';
import FileViewer from './FileViewer';
import ChatInterface from './ChatInterface';
import ReadmeGenerator from './ReadmeGenerator';
import { FileNode } from '../types';

interface AppLayoutProps {
  fileTree: FileNode[];
  repoUrl: string;
  onReset: () => void;
}

type CenterView = 'viewer' | 'readme';

const TOPBAR_HEIGHT = 52; // px — must match the actual rendered height below

export default function AppLayout({ fileTree, repoUrl, onReset }: AppLayoutProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [centerView, setCenterView] = useState<CenterView>('viewer');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const repoName = repoUrl.split('/').slice(-2).join('/');

  return (
    /**
     * Root: fill viewport exactly, no overflow.
     * flex-col so topbar sits above the panel row.
     */
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#07070f',
      }}
    >
      {/* ── TOPBAR ─────────────────────────────────────────────────────── */}
      <div
        style={{
          height: TOPBAR_HEIGHT,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: 'rgba(10,10,15,0.97)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)',
          zIndex: 20,
        }}
      >
        {/* Brand + repo pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28, height: 28, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(6,182,212,0.2))',
                border: '1px solid rgba(124,58,237,0.4)',
              }}
            >
              <GitBranch style={{ width: 14, height: 14, color: '#a78bfa' }} />
            </div>
            <span style={{ fontWeight: 700, color: '#fff', fontSize: 14, letterSpacing: '-0.02em' }}>
              RepoMind
            </span>
          </div>

          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 8,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#9ca3af' }}>{repoName}</span>
          </div>
        </div>

        {/* View tabs */}
        <div
          style={{
            display: 'flex', gap: 4, padding: 4, borderRadius: 12,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {([
            { key: 'viewer' as CenterView, icon: FileText, label: 'File Viewer' },
            { key: 'readme' as CenterView, icon: Sparkles, label: 'Docs Generator' },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setCenterView(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                cursor: 'pointer',
                background: centerView === key ? 'rgba(124,58,237,0.2)' : 'transparent',
                color: centerView === key ? '#a78bfa' : '#6b7280',
                border: centerView === key ? '1px solid rgba(124,58,237,0.35)' : '1px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              <Icon style={{ width: 13, height: 13 }} />
              {label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <button
          onClick={onReset}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 8, fontSize: 12,
            cursor: 'pointer',
            background: 'transparent',
            color: '#6b7280',
            border: '1px solid rgba(255,255,255,0.07)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#d1d5db')}
          onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
        >
          <RefreshCw style={{ width: 13, height: 13 }} />
          New Repo
        </button>
      </div>

      {/* ── PANEL ROW ──────────────────────────────────────────────────── */}
      {/*
        Key rules:
        - flex: 1 so it fills all remaining height below the topbar
        - flexDirection: row for 3-column layout
        - overflow: hidden on the row (each column scrolls internally)
        - NO width/height on children that could fight the flex sizing
      */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          minHeight: 0, // critical: lets flex children shrink past their content height
        }}
      >
        {/* ── LEFT: File Explorer ───────────────────────────────────────── */}
        {sidebarCollapsed ? (
          /* Collapsed stub */
          <div
            style={{
              width: 36, flexShrink: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              paddingTop: 12,
              background: '#080810',
              borderRight: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <button
              onClick={() => setSidebarCollapsed(false)}
              style={{ color: '#4b5563', cursor: 'pointer', padding: 4, transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
              onMouseLeave={e => (e.currentTarget.style.color = '#4b5563')}
            >
              <ChevronRight style={{ width: 16, height: 16 }} />
            </button>
          </div>
        ) : (
          <div
            style={{
              width: '22%',
              minWidth: 200,
              maxWidth: 320,
              flexShrink: 0,       // ← never let flex crush the sidebar
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden',
              background: '#080810',
              borderRight: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            {/* Explorer header */}
            <div
              style={{
                flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Explorer
              </span>
              <button
                onClick={() => setSidebarCollapsed(true)}
                style={{ color: '#374151', cursor: 'pointer', transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#9ca3af')}
                onMouseLeave={e => (e.currentTarget.style.color = '#374151')}
              >
                <ChevronLeft style={{ width: 15, height: 15 }} />
              </button>
            </div>

            {/* Scrollable file tree */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              <FileTree
                data={fileTree}
                onSelect={(path) => {
                  setSelectedFile(path);
                  setCenterView('viewer');
                }}
                selectedPath={selectedFile}
              />
            </div>
          </div>
        )}

        {/* ── CENTER: File Viewer / README ─────────────────────────────── */}
        <div
          style={{
            flex: 1,             // takes all remaining space
            minWidth: 0,         // ← critical flex bug fix
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
            background: '#07070f',
          }}
        >
          <AnimatePresence mode="wait">
            {centerView === 'viewer' ? (
              <motion.div
                key="viewer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
              >
                <FileViewer filePath={selectedFile} />
              </motion.div>
            ) : (
              <motion.div
                key="readme"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
              >
                <ReadmeGenerator onClose={() => setCenterView('viewer')} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Divider */}
        <div style={{ width: 1, flexShrink: 0, background: 'rgba(255,255,255,0.04)' }} />

        {/* ── RIGHT: Chat ──────────────────────────────────────────────── */}
        <div
          style={{
            width: '30%',
            minWidth: 300,
            maxWidth: 480,
            flexShrink: 0,       // ← never let flex crush the chat panel
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
            borderLeft: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <ChatInterface activeFile={selectedFile} />
        </div>
      </div>
    </div>
  );
}
