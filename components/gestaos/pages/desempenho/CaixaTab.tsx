import React from 'react';
import { Link } from 'react-router-dom';
import type { FinanceReport } from '../../../../lib/api';
import { cents, daysText, monthLabel, type Period } from '../../lib/desempenho';
import { useFinanceReport } from '../../lib/desempenhoData';
import { useUnbilledFreight } from '../../lib/data';
import { dateShort, money, plural } from '../../lib/format';
import { ChartCard, Highlight, MonthBars, RankedBars } from '../../ui/charts';
import { EmptyState, Loadable, Panel } from '../../ui/kit';
import { Honesty } from './Honesty';

const SERIES: Array<{ id: 'invoicedCents' | 'receivedCents' | 'paidToCarriersCents'; title: string }> = [
    { id: 'invoicedCents', title: 'Faturado por mês' },
    { id: 'receivedCents', title: 'Recebido por mês' },
    { id: 'paidToCarriersCents', title: 'Pago a transportadores por mês' },
];

const Unbilled: React.FC = () => {
    const state = useUnbilledFreight();
    const data = state.data;
    return (
        <Highlight
            label="Frete emitido sem fatura"
            value={data ? money(data.totalAmount) : state.error ? 'Indisponível' : '—'}
            compare={data ? `${plural(data.count, 'documento', 'documentos')}${data.count > 0 && data.oldestAt ? ` · o mais antigo de ${dateShort(data.oldestAt)}` : ''}` : undefined}
            status={data && data.count > 0 && data.oldestDays > 15 ? { text: `Mais antigo há ${data.oldestDays} dias`, tone: 'yellow' } : undefined}
        />
    );
};

const View: React.FC<{ report: FinanceReport }> = ({ report }) => {
    const t = report.totals;
    const months = report.byMonth;
    const clients = [...report.byClient].sort((a, b) => b.invoicedCents - a.invoicedCents);
    return (
        <div className="flex flex-col gap-6">
            <Panel title="Caixa do período" hint="Faturado e recebido dentro das datas escolhidas. Vencido e títulos em aberto são a posição na data de apuração.">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <Highlight label="Faturado" value={money(cents(t.invoicedCents))} compare={`${plural(t.invoicesIssued, 'fatura emitida', 'faturas emitidas')}`} />
                    <Highlight label="Recebido" value={money(cents(t.receivedCents))} compare={`Prazo médio de recebimento: ${daysText(t.avgReceiptDays)}`} />
                    <Highlight
                        label="Vencido em aberto"
                        value={money(cents(t.overdueOpenCents))}
                        compare={`${plural(t.overdueOpenInvoices, 'fatura vencida', 'faturas vencidas')}`}
                        status={t.overdueOpenCents > 0 ? { text: 'Inadimplência', tone: 'red' } : undefined}
                    />
                    <Highlight label="Pago a transportadores" value={money(cents(t.paidToCarriersCents))} compare="Pagamentos feitos no período" />
                    <Highlight
                        label="Títulos em aberto"
                        value={money(cents(t.openPayablesCents))}
                        compare={plural(t.openPayablesCount, 'título a pagar', 'títulos a pagar')}
                        status={t.openPayablesOverdueCents > 0 ? { text: `${money(cents(t.openPayablesOverdueCents))} vencidos`, tone: 'red' } : undefined}
                    />
                    <Unbilled />
                </div>
                <p className="gx-muted mt-3 text-[12.5px]">
                    Posição em {dateShort(report.asOf)}. <Link to="/gestaos/financeiro?aba=faturar" className="gx-royal-text font-semibold">Ver o que falta faturar</Link>
                </p>
            </Panel>

            <Panel title="Mês a mês" hint="Um gráfico por série, cada um na sua escala.">
                {months.length === 0 ? (
                    <EmptyState title="Sem movimento no período" />
                ) : (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        {SERIES.map(({ id, title }) => (
                            <ChartCard key={id} title={title} table={{ head: ['Mês', 'Valor'], rows: months.map((m) => [monthLabel(m.month), money(m[id] / 100)]) }}>
                                <MonthBars ariaLabel={title} items={months.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m[id], display: money(m[id] / 100) }))} />
                            </ChartCard>
                        ))}
                    </div>
                )}
            </Panel>

            <Panel title="Clientes" hint="Quanto cada cliente faturou no período, com o que está vencido.">
                {clients.length === 0 ? (
                    <EmptyState title="Sem faturas no período" />
                ) : (
                    <ChartCard
                        title="Faturado por cliente"
                        table={{
                            head: ['Cliente', 'Faturado', 'Recebido', 'Vencido'],
                            rows: clients.map((c) => [c.accountName ?? 'Cliente sem nome', money(c.invoicedCents / 100), money(c.receivedCents / 100), money(c.overdueCents / 100)]),
                        }}
                    >
                        <RankedBars
                            ariaLabel="Faturado por cliente"
                            items={clients.slice(0, 10).map((c) => ({
                                key: c.accountId,
                                label: c.accountName ?? 'Cliente sem nome',
                                value: c.invoicedCents,
                                display: money(c.invoicedCents / 100),
                                detail: `Recebido ${money(c.receivedCents / 100)}${c.overdueCents > 0 ? ` · vencido ${money(c.overdueCents / 100)}` : ''}`,
                                badge: c.overdueCents > 0 ? 'com vencido' : undefined,
                                tone: c.overdueCents > 0 ? 'red' : 'royal',
                            }))}
                        />
                    </ChartCard>
                )}
            </Panel>

            <Honesty
                excluded={report.excluded}
                truncated={report.truncatedSources?.length ? `as fontes ${report.truncatedSources.join(', ')} passaram do limite e podem estar incompletas.` : null}
            />
        </div>
    );
};

export const CaixaTab: React.FC<{ period: Period }> = ({ period }) => {
    const state = useFinanceReport(period);
    return <Loadable state={state}>{(report) => <View report={report} />}</Loadable>;
};
