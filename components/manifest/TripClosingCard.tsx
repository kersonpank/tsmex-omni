import React from 'react';
import type { ManifestMarginInfo } from '../../types/index';
import { describeTripClosing } from './tripClosing';

const TONE_CLASS = {
  good: 'text-emerald-700 dark:text-emerald-300',
  bad: 'text-red-700 dark:text-red-300',
  incomplete: 'text-tower-700 dark:text-tower-200',
} as const;

const Line: React.FC<{ label: string; value: string; strong?: boolean; className?: string }> = ({ label, value, strong, className }) => (
  <div className="flex items-baseline justify-between gap-3 py-1">
    <dt className="text-sm text-tower-600 dark:text-tower-300">{label}</dt>
    <dd className={`text-sm ${strong ? 'font-bold' : 'font-medium'} ${className ?? 'text-tower-900 dark:text-tower-50'}`}>{value}</dd>
  </div>
);

/**
 * Fechamento da viagem concluída (somente leitura): receita líquida, custo do transportador,
 * comissão do hub, margem e ocupação. Os números vêm prontos do servidor; aqui só se explica,
 * em linguagem simples, o que ainda falta quando o dado está incompleto.
 */
const TripClosingCard: React.FC<{ data: Partial<ManifestMarginInfo> }> = ({ data }) => {
  const view = describeTripClosing(data);
  return (
    <section aria-label="Fechamento da viagem" className="mb-5 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
      <h3 className="text-sm font-bold text-tower-800 dark:text-tower-100">Fechamento da viagem</h3>
      <dl className="mt-2 divide-y divide-tower-100 dark:divide-tower-700">
        <Line label={data.revenueEstimated ? 'Receita líquida (estimada)' : 'Receita líquida (sem ICMS)'} value={view.revenueNet} />
        <Line label="Custo do transportador" value={view.linkCost} />
        <Line label="Comissão do hub" value={view.hubCost} />
        <Line label="Margem" value={view.marginPercent === '—' ? view.margin : `${view.margin} (${view.marginPercent})`} strong className={TONE_CLASS[view.tone]} />
        <Line label="Ocupação do veículo" value={`peso ${view.occupancyWeight} · volume ${view.occupancyVolume}`} />
      </dl>
      {view.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
          {view.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
};

export default TripClosingCard;
