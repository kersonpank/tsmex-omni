import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { ManifestJourneyStep, ManifestReadiness, ManifestStepState } from '../../types/index';
import StatusBadge from '../ui/StatusBadge';

export interface JourneyStepDefinition {
  key: ManifestJourneyStep;
  shortLabel: string;
  label: string;
  optional?: boolean;
}

export const manifestJourneySteps: JourneyStepDefinition[] = [
  { key: 'route', shortLabel: 'Rota', label: 'Rota e veículo' },
  { key: 'orders', shortLabel: 'Pedidos', label: 'Pedidos e capacidade' },
  { key: 'route_points', shortLabel: 'Percurso', label: 'Percurso e paradas', optional: true },
  { key: 'cover', shortLabel: 'Capa', label: 'Capa e programação' },
  { key: 'responsible', shortLabel: 'Responsável', label: 'Responsável pela viagem' },
  { key: 'freight', shortLabel: 'Frete', label: 'Carta Frete' },
  { key: 'review', shortLabel: 'Revisão', label: 'Revisão e oferta' },
  { key: 'fiscal', shortLabel: 'Fiscal', label: 'Documentos e execução' },
];

const stateStyle: Record<ManifestStepState, string> = {
  complete: 'bg-emerald-500 text-white',
  current: 'bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-900/40',
  attention: 'bg-amber-400 text-amber-950',
  locked: 'bg-tower-200 text-tower-500 dark:bg-tower-700 dark:text-tower-400',
  read_only: 'bg-tower-500 text-white',
};

const stateSymbol: Record<ManifestStepState, string> = {
  complete: '✓',
  current: '•',
  attention: '!',
  locked: '·',
  read_only: '✓',
};

interface Props {
  manifestId?: string;
  statusLabel?: string;
  statusTone?: React.ComponentProps<typeof StatusBadge>['tone'];
  currentStep: ManifestJourneyStep;
  readiness?: ManifestReadiness | null;
  backPath: string;
  onStepChange?: (step: ManifestJourneyStep) => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const ManifestJourneyShell: React.FC<Props> = ({
  manifestId,
  statusLabel = 'Nova viagem',
  statusTone = 'neutral',
  currentStep,
  readiness,
  backPath,
  onStepChange,
  children,
  footer,
}) => {
  const activeIndex = manifestJourneySteps.findIndex((step) => step.key === currentStep);

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-tower-50/70 pb-28 dark:bg-tower-950/30 md:pb-8">
      <header className="sticky top-16 z-20 border-b border-tower-200 bg-[var(--app-surface)]/95 px-4 py-3 backdrop-blur-sm dark:border-tower-700 md:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <RouterLink
              to={backPath}
              className="admin-focus grid size-11 shrink-0 place-items-center rounded-xl text-xl text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800"
              aria-label="Voltar para viagens"
            >
              ←
            </RouterLink>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-tower-900 dark:text-tower-50">
                {manifestId ? `Viagem #${manifestId.slice(0, 8).toUpperCase()}` : 'Nova viagem'}
              </p>
              <p className="truncate text-xs text-tower-500 dark:text-tower-400">
                {activeIndex >= 0 ? `Etapa ${activeIndex + 1} de ${manifestJourneySteps.length}` : 'Planejamento'}
              </p>
            </div>
          </div>
          <StatusBadge label={statusLabel} tone={statusTone} />
        </div>
      </header>

      <div className="mx-auto grid w-full min-w-0 max-w-7xl grid-cols-[minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[16rem_minmax(0,46rem)_18rem]">
        <nav
          aria-label="Etapas da viagem"
          className="min-w-0 border-b border-tower-200 bg-[var(--app-surface)] px-4 py-3 dark:border-tower-700 md:min-h-[calc(100dvh-8rem)] md:border-b-0 md:border-r md:px-4 md:py-6"
        >
          <ol className="flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
            {manifestJourneySteps.map((step, index) => {
              const state = readiness?.steps?.[step.key]?.state ?? (step.key === currentStep ? 'current' : index < activeIndex ? 'complete' : 'locked');
              const disabled = !onStepChange || (state === 'locked' && step.key !== currentStep);
              return (
                <li key={step.key} className="shrink-0 md:w-full">
                  <button
                    type="button"
                    onClick={() => onStepChange?.(step.key)}
                    disabled={disabled}
                    aria-current={step.key === currentStep ? 'step' : undefined}
                    className="admin-focus flex min-h-11 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-tower-100 disabled:cursor-default disabled:opacity-70 dark:hover:bg-tower-800 md:w-full"
                  >
                    <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${stateStyle[state]}`}>
                      {stateSymbol[state]}
                    </span>
                    <span className="text-sm font-medium text-tower-700 dark:text-tower-200">
                      <span className="md:hidden">{step.shortLabel}</span>
                      <span className="hidden md:inline">{step.label}</span>
                      {step.optional && <span className="ml-1 text-[10px] font-normal text-tower-400">(opcional)</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main id="manifest-journey-content" className="min-w-0 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>

        <aside className="hidden border-l border-tower-200 px-5 py-8 dark:border-tower-700 lg:block">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-400">Progresso</p>
          <p className="mt-3 text-sm leading-6 text-tower-600 dark:text-tower-300">
            Os dados são salvos por etapa. Itens concluídos continuam editáveis enquanto a viagem estiver em rascunho.
          </p>
          {readiness?.issues?.length ? (
            <div className="mt-6 space-y-3">
              {readiness.issues.slice(0, 4).map((item) => (
                <p key={`${item.code}-${item.field ?? ''}`} className="text-xs leading-5 text-tower-500 dark:text-tower-400">
                  <span aria-hidden="true">{item.severity === 'blocking' ? '•' : '○'}</span> {item.message}
                </p>
              ))}
            </div>
          ) : null}
        </aside>
      </div>

      {footer && (
        <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-tower-200 bg-[var(--app-surface)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] dark:border-tower-700 md:static md:ml-[15rem] md:shadow-none lg:ml-[16rem]">
          <div className="mx-auto flex max-w-[64rem] items-center justify-end gap-3">{footer}</div>
        </footer>
      )}
    </div>
  );
};
