import React from 'react';
import type { OrdersReport } from '../../../../lib/api';
import { hoursText, percentText, type Period } from '../../lib/desempenho';
import { useOrdersReport } from '../../lib/desempenhoData';
import { num } from '../../lib/format';
import { ChartCard, Highlight, RankedBars } from '../../ui/charts';
import { EmptyState, Loadable, Panel } from '../../ui/kit';
import { Honesty } from './Honesty';

const View: React.FC<{ report: OrdersReport }> = ({ report }) => {
    const hubs = [...report.stoppedByHub].sort((a, b) => b.avgHours - a.avgHours);
    return (
        <div className="flex flex-col gap-6">
            <Panel title="Pedidos entregues" hint={`${num(report.coverage.ordersDelivered)} pedidos entregues no período; ${num(report.coverage.ordersAnalysed)} analisados.`}>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <Highlight label="Tempo médio" value={hoursText(report.leadTime.avgHours)} compare={`Da entrada à entrega · ${num(report.leadTime.measured)} pedidos medidos`} />
                    <Highlight label="Mediana" value={hoursText(report.leadTime.medianHours)} compare={`90% entregam em até ${hoursText(report.leadTime.p90Hours)}`} />
                    <Highlight label="No prazo" value={percentText(report.onTime.percent, 0)} compare={`${num(report.onTime.onTime)} de ${num(report.onTime.measured)} pedidos medidos`} />
                    <Highlight label="Entrega completa" value={percentText(report.complete.percent, 0)} compare={`${num(report.complete.complete)} de ${num(report.complete.measured)} com tudo entregue`} />
                </div>
                <p className="gx-soft mt-4 text-[13px]" role="note">
                    <strong>Como ler o "no prazo":</strong> a referência é o prazo da cobertura do destino, não uma promessa feita ao cliente. O sistema ainda não grava o prazo prometido por pedido.
                    {report.onTime.note ? ` ${report.onTime.note}` : ''}
                </p>
            </Panel>

            <Panel title="Tempo parado por hub" hint="Média de espera entre uma etapa e outra, em cada hub. Maior primeiro.">
                {hubs.length === 0 ? (
                    <EmptyState title="Sem paradas medidas no período" />
                ) : (
                    <ChartCard
                        title="Espera média por hub"
                        table={{
                            head: ['Hub', 'Espera média', 'Total parado', 'Amostras'],
                            rows: hubs.map((h) => [h.hubName ?? 'Hub sem nome', hoursText(h.avgHours), hoursText(h.totalHours), num(h.samples)]),
                        }}
                    >
                        <RankedBars
                            ariaLabel="Espera média por hub"
                            items={hubs.slice(0, 12).map((h) => ({
                                key: h.hubId,
                                label: h.hubName ?? 'Hub sem nome',
                                value: h.avgHours,
                                display: hoursText(h.avgHours),
                                detail: `${num(h.samples)} passagens · ${hoursText(h.totalHours)} no total`,
                            }))}
                        />
                    </ChartCard>
                )}
            </Panel>

            <Honesty
                excluded={report.excluded}
                truncated={report.coverage.truncated ? `analisamos ${report.coverage.ordersAnalysed} de ${report.coverage.ordersDelivered} pedidos entregues (limite de ${report.coverage.limit}).` : null}
            />
        </div>
    );
};

export const EntregaTab: React.FC<{ period: Period }> = ({ period }) => {
    const state = useOrdersReport(period);
    return <Loadable state={state}>{(report) => <View report={report} />}</Loadable>;
};
