import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { AutonomyReport } from '../../../../lib/api';
import { periodForPreset, percentText, routineLabel, type Period } from '../../lib/desempenho';
import { useAutonomyReport } from '../../lib/desempenhoData';
import { num, plural } from '../../lib/format';
import { ChartCard, GoalProgress, RankedBars } from '../../ui/charts';
import { ErrorState, ModeBadge, Panel, Skeleton } from '../../ui/kit';

/** Aviso das decisões que não contam por não terem sugestão do sistema. */
export function withoutSuggestion(report: AutonomyReport): { count: number; reason: string } | null {
    const hit = (report.excluded ?? []).find((item) => item.count > 0 && /sem sugest/i.test(item.reason));
    return hit ? { count: hit.count, reason: hit.reason } : null;
}

export const RulerBody: React.FC<{ report: AutonomyReport }> = ({ report }) => {
    const overall = report.overall;
    const skipped = withoutSuggestion(report);
    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 items-end gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
                <p>
                    <span className="gx-num gx-royal-text text-[44px] leading-none">{percentText(overall.acceptedPercent)}</span>
                    <span className="gx-soft mt-1.5 block text-[13.5px]">
                        das sugestões foram aceitas sem alteração · {plural(overall.suggestions, 'sugestão', 'sugestões')} no período
                    </span>
                </p>
                <GoalProgress value={overall.acceptedPercent} target={report.targetPercent} label="Sugestões aceitas sem alteração" />
            </div>
            <p className="gx-soft text-[13px]">
                {num(overall.accepted)} aceitas sem alteração · {num(overall.modified)} aceitas com alteração · {num(overall.rejected)} recusadas.
            </p>
            {skipped ? (
                <p className="gx-yellow-text text-[13px] font-semibold" role="note">
                    {plural(skipped.count, 'decisão não conta', 'decisões não contam')} por não ter sugestão do sistema: {skipped.reason}
                </p>
            ) : null}
            {report.coverage.truncated ? (
                <p className="gx-yellow-text text-[13px] font-semibold" role="status">
                    Relatório cortado pelo limite: analisamos {report.coverage.feedbackAnalysed} registros (limite de {report.coverage.limit}).
                </p>
            ) : null}
        </div>
    );
};

export const RoutineBreakdown: React.FC<{ report: AutonomyReport }> = ({ report }) => {
    const rows = report.byRoutine;
    if (rows.length === 0) return <p className="gx-soft text-[13.5px]">Nenhuma rotina sugeriu consolidação no período.</p>;
    const ba = (b: { beforePercent: number | null; afterPercent: number | null; samples: number }) =>
        b.samples > 0 ? `${percentText(b.beforePercent, 0)} → ${percentText(b.afterPercent, 0)} (${b.samples})` : 'Sem amostra';
    return (
        <ChartCard
            title="Aceitas sem alteração, por rotina"
            hint="Só entram decisões em que o sistema tinha sugerido algo."
            table={{
                head: ['Rotina', 'Sugestões', 'Aceitas', 'Alteradas', 'Recusadas', '% aceitas', 'Ocupação antes → depois', 'Margem antes → depois'],
                rows: rows.map((r) => [routineLabel(r.routine), num(r.suggestions), num(r.accepted), num(r.modified), num(r.rejected), percentText(r.acceptedPercent), ba(r.utilization), ba(r.margin)]),
            }}
        >
            <RankedBars
                ariaLabel="Aceitas sem alteração por rotina"
                items={rows.map((r) => ({
                    key: r.routine,
                    label: routineLabel(r.routine),
                    value: r.acceptedPercent ?? 0,
                    display: percentText(r.acceptedPercent),
                    detail: `${plural(r.suggestions, 'sugestão', 'sugestões')} · ocupação ${ba(r.utilization)} · margem ${ba(r.margin)}`,
                    tone: r.acceptedPercent != null && r.acceptedPercent < report.targetPercent ? 'red' : 'royal',
                    badge: r.acceptedPercent != null && r.acceptedPercent < report.targetPercent ? 'abaixo da meta' : undefined,
                }))}
            />
        </ChartCard>
    );
};

/** Régua de autonomia compacta, para Sistema › Como a torre trabalha (últimos 30 dias). */
export const AutonomyRuler: React.FC = () => {
    const period = useMemo<Period>(() => periodForPreset('30'), []);
    const state = useAutonomyReport(period);
    return (
        <Panel
            tint="auto"
            title="Régua de autonomia"
            hint={`Dos últimos 30 dias: quanto das sugestões do sistema a pessoa aceitou sem mexer. A meta é subir uma rotina de modo só depois de medir.`}
            actions={<ModeBadge mode="copilot" />}
        >
            {state.data?.overall ? (
                <>
                    <RulerBody report={state.data} />
                    <p className="mt-3 text-[13px]">
                        <Link to="/gestaos/desempenho?aba=aprendizado" className="gx-royal-text font-semibold">Ver por rotina em Desempenho</Link>
                    </p>
                </>
            ) : state.error ? (
                <ErrorState message={state.error} onRetry={state.reload} />
            ) : state.data ? (
                <p className="gx-soft text-[13.5px]">Sem dados de autonomia para mostrar.</p>
            ) : (
                <Skeleton rows={2} height={32} />
            )}
        </Panel>
    );
};
