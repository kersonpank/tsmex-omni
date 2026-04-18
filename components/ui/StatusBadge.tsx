import React from 'react';
import type { StatusTone } from '../../lib/demandStatusUi';

const toneClasses: Record<StatusTone, string> = {
  neutral:
    'bg-tower-200/80 text-tower-800 dark:bg-tower-700/80 dark:text-tower-100',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  success: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
};

interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  className?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ label, tone = 'neutral', className = '' }) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${toneClasses[tone]} ${className}`}
  >
    {label}
  </span>
);

export default StatusBadge;
