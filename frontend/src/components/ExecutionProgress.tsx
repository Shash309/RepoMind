import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, Play, AlertCircle } from 'lucide-react';
import { PlanFile } from '../hooks/useActMode';

interface ExecutionProgressProps {
  files: PlanFile[];
  progress: Record<string, 'waiting' | 'executing' | 'done' | 'skipped'>;
  status: string;
}

export default function ExecutionProgress({ files, progress, status }: ExecutionProgressProps) {
  return (
    <div
      className="p-5 rounded-2xl flex flex-col gap-4 text-left w-full select-none"
      style={{
        background: 'rgba(17, 17, 28, 0.8)',
        border: '1px solid rgba(124, 58, 237, 0.2)',
        boxShadow: '0 8px 32px rgba(124, 58, 237, 0.08)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2.5 pb-2 border-b border-white/5">
        <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
        <h3 className="text-sm font-semibold text-white tracking-wide">
          {status === 'executing' ? 'Executing changes...' : 'Processing...'}
        </h3>
      </div>

      <div className="flex flex-col gap-3 max-h-[220px] overflow-y-auto pr-1">
        {files.map((file, idx) => {
          const fileStatus = progress[file.path] || 'waiting';

          return (
            <motion.div
              key={file.path}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg transition-colors"
              style={{
                background:
                  fileStatus === 'executing'
                    ? 'rgba(124, 58, 237, 0.08)'
                    : 'transparent',
              }}
            >
              <div className="flex items-center gap-3 truncate mr-2">
                {fileStatus === 'waiting' && (
                  <Play className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                )}
                {fileStatus === 'executing' && (
                  <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin flex-shrink-0" />
                )}
                {fileStatus === 'done' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                )}
                {fileStatus === 'skipped' && (
                  <AlertCircle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                )}
                <span
                  className={`font-mono truncate ${
                    fileStatus === 'waiting'
                      ? 'text-gray-500'
                      : fileStatus === 'executing'
                      ? 'text-violet-200 font-semibold'
                      : 'text-gray-300'
                  }`}
                >
                  {file.path}
                </span>
              </div>

              <span
                className={`text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full ${
                  fileStatus === 'waiting'
                    ? 'text-gray-600 bg-gray-900/30'
                    : fileStatus === 'executing'
                    ? 'text-violet-400 bg-violet-500/10'
                    : fileStatus === 'done'
                    ? 'text-green-400 bg-green-500/10'
                    : 'text-orange-400 bg-orange-500/10'
                }`}
              >
                {fileStatus}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
