import React from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon, action }) => (
  <div
    role="status"
    className="rounded-2xl border border-dashed border-tower-200 bg-white/80 p-10 text-center dark:border-tower-700 dark:bg-tower-900/60"
  >
    {icon && <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center text-tower-400 dark:text-tower-500">{icon}</div>}
    <p className="font-display text-lg font-semibold text-tower-800 dark:text-tower-100">{title}</p>
    {description && <p className="mx-auto mt-2 max-w-md text-sm text-tower-600 dark:text-tower-400">{description}</p>}
    {action && <div className="mt-6 flex justify-center">{action}</div>}
  </div>
);

export default EmptyState;
