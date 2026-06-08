'use client';

import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

import SplashScreen from '../components/SplashScreen';
import LandingPage from '../components/LandingPage';
import IngestionLoader, { IngestionStep } from '../components/IngestionLoader';

import { FileNode } from '../types';

// Dynamically import heavy components to avoid SSR issues
const DynamicAppLayout = dynamic(() => import('../components/AppLayout'), { ssr: false });

type AppState = 'splash' | 'landing' | 'loading' | 'app';

export default function Home() {
  const [appState, setAppState] = useState<AppState>('splash');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [repoUrl, setRepoUrl] = useState('');
  const [ingestionStep, setIngestionStep] = useState<IngestionStep>('connecting');
  const [ingestionError, setIngestionError] = useState('');
  const [ingestionDetail, setIngestionDetail] = useState('');

  const handleSplashComplete = () => {
    setAppState('landing');
  };

  const handleRepoSubmit = async (url: string) => {
    setRepoUrl(url);
    setIngestionError('');
    setAppState('loading');
    setIngestionStep('connecting');
    setIngestionDetail('Connecting to GitHub...');

    try {
      const res = await fetch('/api/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to initiate repository clone');
      }

      const jobId = data.jobId;
      if (!jobId) {
        throw new Error('No jobId returned from server');
      }

      // Poll for progress every 2 seconds
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const pollRes = await fetch(`/api/clone/status/${jobId}`);
            if (!pollRes.ok) {
              throw new Error('Failed to poll repository status');
            }
            const statusData = await pollRes.json();

            if (statusData.status && statusData.status !== 'complete' && statusData.status !== 'error') {
              setIngestionStep(statusData.status);
              if (statusData.step) {
                setIngestionDetail(statusData.step);
              }
            }

            if (statusData.status === 'complete') {
              clearInterval(interval);
              setIngestionStep('ready');
              setFileTree(statusData.fileTree || []);
              setTimeout(() => {
                setAppState('app');
                resolve();
              }, 800);
            }

            if (statusData.status === 'error') {
              clearInterval(interval);
              setIngestionError(statusData.error || 'Ingestion failed');
              reject(new Error(statusData.error || 'Ingestion failed'));
            }
          } catch (pollErr: any) {
            clearInterval(interval);
            setIngestionError(pollErr.message);
            reject(pollErr);
          }
        }, 2000);
      });
    } catch (err: unknown) {
      setIngestionError(err instanceof Error ? err.message : 'An unexpected error occurred');
    }
  };

  const handleReset = () => {
    setAppState('landing');
    setFileTree([]);
    setRepoUrl('');
    setIngestionError('');
  };

  return (
    <>
      <AnimatePresence>
        {appState === 'splash' && (
          <SplashScreen key="splash" onComplete={handleSplashComplete} />
        )}
      </AnimatePresence>

      {appState === 'landing' && (
        <LandingPage onSubmit={handleRepoSubmit} />
      )}

      {appState === 'loading' && (
        <IngestionLoader
          currentStep={ingestionStep}
          repoUrl={repoUrl}
          error={ingestionError}
          stepDetail={ingestionDetail}
        />
      )}

      {appState === 'app' && fileTree.length > 0 && (
        <DynamicAppLayout
          fileTree={fileTree}
          repoUrl={repoUrl}
          onReset={handleReset}
        />
      )}
    </>
  );
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
