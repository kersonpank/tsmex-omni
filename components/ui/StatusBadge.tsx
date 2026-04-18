import React from 'react';
import type { StatusTone } from '../../lib/demandStatusUi';

/** Sucesso = chip azul marca (sem verde). Aviso = amarelo faixa com texto escuro. */
const toneClasses: Record<StatusTone, string> = {
  neutral:
    'bg-tower-200/90 text-tower-900 dark:bg-tower-700/90 dark:text-tower-100',
  info: 'bg-brand-100 text-brand-900 dark:bg-brand-800/90 dark:text-brand-50',
  warning:
    'bg-brand-yellow-400 text-tower-950 dark:bg-brand-yellow-500/90 dark:text-tower-950',
  success: 'bg-brand-200 text-brand-900 dark:bg-brand-700 dark:text-tower-50',
  danger: 'bg-red-50 text-brand-red-800 dark:bg-brand-red-900/45 dark:text-red-50',
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
