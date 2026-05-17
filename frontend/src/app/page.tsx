'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

import SplashScreen from '../components/SplashScreen';
import LandingPage from '../components/LandingPage';
import IngestionLoader, { IngestionStep } from '../components/IngestionLoader';
import AppLayout from '../components/AppLayout';
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

  const handleSplashComplete = () => {
    setAppState('landing');
  };

  const handleRepoSubmit = async (url: string) => {
    setRepoUrl(url);
    setIngestionError('');
    setAppState('loading');
    setIngestionStep('connecting');

    // Animate steps as we go
    await delay(400);
    setIngestionStep('cloning');

    try {
      const res = await fetch('/api/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      // Show parsing step partway through
      setTimeout(() => setIngestionStep('parsing'), 1500);
      setTimeout(() => setIngestionStep('embedding'), 4000);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to clone repository');
      }

      setIngestionStep('ready');
      setFileTree(data.fileTree);

      await delay(800);
      setAppState('app');
    } catch (err: any) {
      setIngestionError(err.message);
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
