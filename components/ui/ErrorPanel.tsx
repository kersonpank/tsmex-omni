import React from 'react';

interface ErrorPanelProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

const ErrorPanel: React.FC<ErrorPanelProps> = ({ message, onRetry, retryLabel = 'Tentar novamente' }) => (
  <div
    role="alert"
    className="rounded-2xl border border-red-200 bg-red-50/90 p-6 text-center dark:border-red-900/50 dark:bg-red-950/40"
  >
    <p className="text-sm font-medium text-red-800 dark:text-red-200">{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="admin-focus mt-4 rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
      >
        {retryLabel}
      </button>
    )}
  </div>
);

export default ErrorPanel;
