'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import {
  ChevronRight, ChevronDown,
  FileText, FileCode, FileJson, Folder, FolderOpen,
  FileType, Coffee, Braces,
} from 'lucide-react';
import { FileNode } from '../types';

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconClass = "w-3.5 h-3.5 flex-shrink-0";

  const icons: Record<string, JSX.Element> = {
    ts: <FileCode className={iconClass} style={{ color: '#3178c6' }} />,
    tsx: <FileCode className={iconClass} style={{ color: '#3178c6' }} />,
    js: <FileCode className={iconClass} style={{ color: '#f7df1e' }} />,
    jsx: <FileCode className={iconClass} style={{ color: '#f7df1e' }} />,
    json: <FileJson className={iconClass} style={{ color: '#f4a261' }} />,
    md: <FileText className={iconClass} style={{ color: '#a8d8ea' }} />,
    py: <Coffee className={iconClass} style={{ color: '#3572A5' }} />,
    css: <Braces className={iconClass} style={{ color: '#563d7c' }} />,
    html: <FileType className={iconClass} style={{ color: '#e34c26' }} />,
    go: <FileCode className={iconClass} style={{ color: '#00add8' }} />,
  };

  return icons[ext || ''] || <FileText className={iconClass} style={{ color: '#6b7280' }} />;
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function TreeNode({ node, depth, selectedId, onSelect }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(depth < 2);
  const isSelected = selectedId === node.id;

  if (node.isDir) {
    return (
      <div>
        <motion.button
          onClick={() => setIsOpen(o => !o)}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left group relative"
          style={{
            paddingLeft: `${8 + depth * 14}px`,
            background: 'transparent',
          }}
          whileHover={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
        >
          <span className="text-gray-600 flex-shrink-0 w-3">
            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
          {isOpen
            ? <FolderOpen className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
            : <Folder className="w-3.5 h-3.5 text-violet-500/70 flex-shrink-0" />
          }
          <span className="text-xs font-medium text-gray-300 truncate group-hover:text-white transition-colors">
            {node.name}
          </span>
        </motion.button>

        <AnimatePresence initial={false}>
          {isOpen && node.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              {node.children.map(child => (
                <TreeNode
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <motion.button
      onClick={() => onSelect(node.id)}
      className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left group relative"
      style={{
        paddingLeft: `${8 + depth * 14}px`,
        background: isSelected ? 'rgba(124,58,237,0.15)' : 'transparent',
        border: isSelected ? '1px solid rgba(124,58,237,0.25)' : '1px solid transparent',
      }}
      whileHover={{
        backgroundColor: isSelected ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.04)',
      }}
    >
      <span className="w-3 flex-shrink-0" />
      {getFileIcon(node.name)}
      <span className={`text-xs truncate transition-colors ${isSelected ? 'text-violet-300' : 'text-gray-400 group-hover:text-gray-200'}`}>
        {node.name}
      </span>
      {isSelected && (
        <motion.div
          layoutId="selectedIndicator"
          className="absolute right-2 w-1.5 h-1.5 rounded-full"
          style={{ background: '#7c3aed' }}
        />
      )}
    </motion.button>
  );
}

interface FileTreeProps {
  data: FileNode[];
  onSelect: (path: string) => void;
  selectedPath: string | null;
}

export default function FileTree({ data, onSelect, selectedPath }: FileTreeProps) {
  return (
    <div className="py-2">
      {data.map(node => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
