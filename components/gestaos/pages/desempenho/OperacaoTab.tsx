import React from 'react';
import { Link } from 'react-router-dom';
import type { TripsReport, TripsReportGroup } from '../../../../lib/api';
import { cents, percentText, type Period } from '../../lib/desempenho';
import { useTripsReport } from '../../lib/desempenhoData';
import { dateShort, money, num, plural } from '../../lib/format';
import { ChartCard, Highlight, RankedBars, type RankedItem } from '../../ui/charts';
import { EmptyState, Loadable, Panel } from '../../ui/kit';
import { Honesty } from './Honesty';

const sorted = (groups: TripsReportGroup[]) => [...groups].sort((a, b) => b.marginCents - a.marginCents);

const rankItems = (groups: TripsReportGroup[]): RankedItem[] =>
    sorted(groups)
        .slice(0, 10)
        .map((g) => ({
            key: g.key,
            label: g.label,
            value: g.marginCents,
            display: money(g.marginCents / 100),
            detail: `${plural(g.trips, 'viagem', 'viagens')} · margem ${percentText(g.marginPercent)} · ocupação ${percentText(g.avgOccupancyPercent, 0)} · no prazo ${percentText(g.onTimePercent, 0)}`,
            badge: g.marginCents < 0 ? 'abaixo de zero' : undefined,
        }));

const rankTable = (groups: TripsReportGroup[], first: string) => ({
    head: [first, 'Viagens', 'Margem', 'Margem %', 'Ocupação', 'No prazo'],
    rows: sorted(groups).map((g) => [g.label, num(g.trips), money(g.marginCents / 100), percentText(g.marginPercent), percentText(g.avgOccupancyPercent, 0), percentText(g.onTimePercent, 0)]),
});

const View: React.FC<{ report: TripsReport }> = ({ report }) => {
    const t = report.totals;
    const estimated = t.tripsWithEstimatedRevenue;
    return (
        <div className="flex flex-col gap-6">
            <Panel title="Viagens concluídas" hint="Margem realizada: receita líquida do frete menos custo do transportador e dos hubs.">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <Highlight
                        label="Margem"
                        value={money(cents(t.marginCents))}
                        compare={`${percentText(t.marginPercent)} da receita · ${t.tripsWithMargin} de ${t.trips} viagens medidas`}
                        status={t.marginCents < 0 ? { text: 'Negativa no período', tone: 'red' } : undefined}
                    />
                    <Highlight
                        label="Receita líquida"
                        value={money(cents(t.revenueNetCents))}
                        compare={`Realizada: ${money(cents(t.revenueRealizedCents))}`}
                        status={estimated > 0 ? { text: plural(estimated, 'viagem com receita estimada', 'viagens com receita estimada'), tone: 'yellow' } : undefined}
                    />
                    <Highlight label="Ocupação média" value={percentText(t.avgOccupancyPercent, 0)} compare="Carga transportada sobre a capacidade do veículo" />
                    <Highlight label="Pontualidade" value={percentText(t.onTimePercent, 0)} compare={`${t.onTimeTrips} de ${t.onTimeMeasured} viagens medidas chegaram no previsto`} />
                </div>
                <p className="gx-muted mt-3 text-[12.5px]">
                    Custo do transportador {money(cents(t.linkCostCents))} · custo dos hubs {money(cents(t.hubCostCents))}.
                </p>
            </Panel>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Panel title="Rotas" hint="Ranking pela margem em reais, as 10 maiores.">
                    {report.byRoute.length === 0 ? (
                        <EmptyState title="Sem rotas no período" />
                    ) : (
                        <ChartCard title="Margem por rota" table={rankTable(report.byRoute, 'Rota')}>
                            <RankedBars ariaLabel="Margem por rota" items={rankItems(report.byRoute)} />
                        </ChartCard>
                    )}
                </Panel>
                <Panel title="Transportadores" hint="Ranking pela margem em reais, os 10 maiores.">
                    {report.byCarrier.length === 0 ? (
                        <EmptyState title="Sem transportadores no período" />
                    ) : (
                        <ChartCard title="Margem por transportador" table={rankTable(report.byCarrier, 'Transportador')}>
                            <RankedBars ariaLabel="Margem por transportador" items={rankItems(report.byCarrier)} />
                        </ChartCard>
                    )}
                </Panel>
            </div>

            <Panel title="Viagem a viagem" hint="Realizado de cada viagem concluída. Receita estimada aparece marcada." padded={false}>
                {report.trips.length === 0 ? (
                    <div className="px-5 pb-5">
                        <EmptyState title="Nenhuma viagem concluída no período" />
                    </div>
                ) : (
                    <div className="gx-scroll-x px-5 pb-4">
                        <table className="w-full min-w-[720px] text-left text-[13px]">
                            <thead>
                                <tr>
                                    {['Concluída', 'Rota', 'Transportador', 'Margem', 'Ocupação', 'Prazo'].map((h, i) => (
                                        <th key={h} scope="col" className={`gx-label gx-hair-b py-2 pr-3 ${i >= 3 ? 'text-right' : ''}`}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {report.trips.slice(0, 30).map((trip) => (
                                    <tr key={trip.manifestId}>
                                        <td className="gx-hair-b py-2 pr-3">{dateShort(trip.completedAt)}</td>
                                        <td className="gx-hair-b py-2 pr-3">
                                            <Link to={`/gestaos/viagens/${trip.manifestId}`} className="gx-royal-text font-semibold">
                                                {trip.route}
                                            </Link>
                                        </td>
                                        <td className="gx-hair-b py-2 pr-3">{trip.carrierName ?? '—'}</td>
                                        <td className={`gx-hair-b gx-mono py-2 pr-3 text-right ${trip.marginCents != null && trip.marginCents < 0 ? 'gx-red-text' : ''}`}>
                                            {trip.costComplete === false ? 'Custo incompleto' : money(cents(trip.marginCents))}
                                            {trip.revenueEstimated ? ' (receita estimada)' : ''}
                                        </td>
                                        <td className="gx-hair-b gx-mono py-2 pr-3 text-right">{percentText(trip.occupancyPercent, 0)}</td>
                                        <td className="gx-hair-b py-2 text-right">
                                            {trip.onTime == null ? (
                                                'Sem medição'
                                            ) : trip.onTime ? (
                                                'No previsto'
                                            ) : (
                                                <span className="gx-red-text font-semibold">Atrasada{trip.maxDelayMinutes ? ` ${trip.maxDelayMinutes} min` : ''}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {report.trips.length > 30 ? <p className="gx-muted mt-2 text-[12.5px]">Mostrando 30 de {report.trips.length} viagens.</p> : null}
                    </div>
                )}
            </Panel>

            <Honesty
                excluded={report.excluded}
                truncated={report.coverage.truncated ? `analisamos ${report.coverage.tripsAnalysed} de ${report.coverage.tripsInPeriod} viagens do período (limite de ${report.coverage.limit}).` : null}
                notes={[`${report.coverage.tripsAnalysed} de ${report.coverage.tripsInPeriod} viagens concluídas no período entraram na análise.`]}
            />
        </div>
    );
};

export const OperacaoTab: React.FC<{ period: Period }> = ({ period }) => {
    const state = useTripsReport(period);
    return <Loadable state={state}>{(report) => <View report={report} />}</Loadable>;
};
