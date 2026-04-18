import React from 'react';

interface LoadingPanelProps {
  label?: string;
}

const LoadingPanel: React.FC<LoadingPanelProps> = ({ label = 'Carregando…' }) => (
  <div className="flex flex-col items-center justify-center gap-4 py-16" role="status" aria-live="polite">
    <div
      className="h-11 w-11 animate-spin rounded-full border-2 border-tower-200 border-t-brand-500 dark:border-tower-700 dark:border-t-brand-300"
      aria-hidden
    />
    <p className="text-sm text-tower-600 dark:text-tower-400">{label}</p>
  </div>
);

export default LoadingPanel;
