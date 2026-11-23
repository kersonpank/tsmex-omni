import React from 'react';
import { Link } from 'react-router-dom';
import type { ExceptionsReport } from '../../../../lib/api';
import { categoryLabel, hoursText, percentText, type Period } from '../../lib/desempenho';
import { useExceptionsReport } from '../../lib/desempenhoData';
import { num } from '../../lib/format';
import { ChartCard, Highlight, RankedBars } from '../../ui/charts';
import { EmptyState, Loadable, Panel } from '../../ui/kit';
import { Honesty } from './Honesty';

const View: React.FC<{ report: ExceptionsReport }> = ({ report }) => {
    const by = report.resolvedBy;
    const categories = [...report.byCategory].sort((a, b) => b.opened - a.opened);
    const hubs = [...report.byHub].sort((a, b) => b.opened - a.opened);
    const who = [
        { key: 'system', label: 'Pelo sistema', value: by.system },
        { key: 'person', label: 'Por uma pessoa', value: by.person },
        { key: 'unattributed', label: 'Sem registro de quem', value: by.unattributed },
    ];
    return (
        <div className="flex flex-col gap-6">
            <Panel title="Exceções do período" hint="Alertas que a torre precisou tratar, abertos e fechados dentro das datas.">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <Highlight label="Abertas" value={num(report.opened)} compare="Surgiram no período" />
                    <Highlight label="Resolvidas" value={num(report.resolved)} compare={`Tempo médio ${hoursText(report.timeToResolve.avgHours)} · mediana ${hoursText(report.timeToResolve.medianHours)}`} />
                    <Highlight
                        label="Dentro do prazo"
                        value={percentText(report.withinDue.percent, 0)}
                        compare={`${num(report.withinDue.within)} de ${num(report.withinDue.measured)} resolvidas com prazo`}
                    />
                    <Highlight
                        label="Pendentes agora"
                        value={num(report.backlogNow.total)}
                        compare="Posição de hoje, não do período"
                        status={report.backlogNow.overdue > 0 ? { text: `${num(report.backlogNow.overdue)} vencidas`, tone: 'red' } : undefined}
                    />
                </div>
                <p className="gx-muted mt-3 text-[12.5px]">
                    <Link to="/gestaos" className="gx-royal-text font-semibold">Ver as pendentes em Hoje</Link>
                </p>
            </Panel>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Panel title="Quem resolveu" hint="Sistema contra pessoa, entre as resolvidas.">
                    {report.resolved === 0 ? (
                        <EmptyState title="Nada resolvido no período" />
                    ) : (
                        <ChartCard title="Resolvidas por quem" table={{ head: ['Quem', 'Quantidade'], rows: who.map((w) => [w.label, num(w.value)]) }}>
                            <RankedBars ariaLabel="Resolvidas por quem" items={who.map((w) => ({ ...w, display: num(w.value) }))} />
                        </ChartCard>
                    )}
                </Panel>
                <Panel title="Por categoria" hint="Mais abertas primeiro.">
                    {categories.length === 0 ? (
                        <EmptyState title="Sem exceções no período" />
                    ) : (
                        <ChartCard
                            title="Abertas por categoria"
                            table={{
                                head: ['Categoria', 'Abertas', 'Resolvidas', 'Tempo médio'],
                                rows: categories.map((c) => [categoryLabel(c.category), num(c.opened), num(c.resolved), hoursText(c.avgHoursToResolve)]),
                            }}
                        >
                            <RankedBars
                                ariaLabel="Abertas por categoria"
                                items={categories.map((c) => ({
                                    key: c.category,
                                    label: categoryLabel(c.category),
                                    value: c.opened,
                                    display: num(c.opened),
                                    detail: `${num(c.resolved)} resolvidas · tempo médio ${hoursText(c.avgHoursToResolve)}`,
                                }))}
                            />
                        </ChartCard>
                    )}
                </Panel>
            </div>

            <Panel title="Por hub" hint="Onde as exceções nascem.">
                {hubs.length === 0 ? (
                    <EmptyState title="Sem exceções ligadas a hubs" />
                ) : (
                    <ChartCard
                        title="Abertas por hub"
                        table={{ head: ['Hub', 'Abertas', 'Resolvidas', 'Tempo médio'], rows: hubs.map((h) => [h.hubName ?? 'Sem hub', num(h.opened), num(h.resolved), hoursText(h.avgHoursToResolve)]) }}
                    >
                        <RankedBars
                            ariaLabel="Abertas por hub"
                            items={hubs.slice(0, 12).map((h) => ({
                                key: h.hubId,
                                label: h.hubName ?? 'Sem hub',
                                value: h.opened,
                                display: num(h.opened),
                                detail: `${num(h.resolved)} resolvidas · tempo médio ${hoursText(h.avgHoursToResolve)}`,
                            }))}
                        />
                    </ChartCard>
                )}
            </Panel>

            <Honesty
                excluded={report.excluded}
                truncated={report.coverage.truncated ? `analisamos ${report.coverage.alertsAnalysed} alertas (limite de ${report.coverage.limit}).` : null}
            />
        </div>
    );
};

export const ExcecoesTab: React.FC<{ period: Period }> = ({ period }) => {
    const state = useExceptionsReport(period);
    return <Loadable state={state}>{(report) => <View report={report} />}</Loadable>;
};
