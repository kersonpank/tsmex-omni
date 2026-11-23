import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cents, percentText, periodForPreset, type Period } from '../../lib/desempenho';
import { useFinanceReport, useOrdersReport, useTripsReport } from '../../lib/desempenhoData';
import { money } from '../../lib/format';
import { Glass, Stat } from '../../ui/kit';

/** Faixa "Controle": quatro números dos últimos 30 dias, cada um leva ao Desempenho. */
export const ControlStrip: React.FC = () => {
    const navigate = useNavigate();
    const period = useMemo<Period>(() => periodForPreset('30'), []);
    const trips = useTripsReport(period);
    const orders = useOrdersReport(period);
    const finance = useFinanceReport(period);

    const go = (aba: string) => () => navigate(`/gestaos/desempenho?aba=${aba}&de=${period.from}&ate=${period.to}`);
    const totals = trips.data?.totals;
    const overdue = finance.data?.totals?.overdueOpenCents;
    const margin = totals?.marginPercent;
    const failed = trips.error && orders.error && finance.error;

    return (
        <section aria-labelledby="controle-hoje" className="gx-rise">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
                <h2 id="controle-hoje" className="gx-h2">Controle</h2>
                <p className="gx-muted text-[13px]">Últimos 30 dias · só o que foi medido</p>
            </div>
            <Glass className="grid grid-cols-2 lg:grid-cols-4">
                <Stat
                    label="Margem"
                    value={totals ? percentText(margin) : '—'}
                    hint={totals ? (totals.marginCents < 0 ? 'Negativa no período' : `${money(cents(totals.marginCents))} em ${totals.tripsWithMargin} viagens`) : trips.error ? 'Indisponível' : 'Carregando'}
                    tone={totals && totals.marginCents < 0 ? 'red' : 'neutral'}
                    onClick={go('operacao')}
                />
                <Stat label="Ocupação" value={totals ? percentText(totals.avgOccupancyPercent, 0) : '—'} hint={totals ? 'Média das viagens concluídas' : trips.error ? 'Indisponível' : 'Carregando'} onClick={go('operacao')} />
                <Stat
                    label="No prazo"
                    value={orders.data?.onTime ? percentText(orders.data.onTime.percent, 0) : '—'}
                    hint={orders.data?.onTime ? 'Pelo prazo da cobertura' : orders.error ? 'Indisponível' : 'Carregando'}
                    onClick={go('entrega')}
                />
                <Stat
                    label="Inadimplência"
                    value={overdue != null ? money(cents(overdue)) : '—'}
                    hint={overdue != null ? (overdue > 0 ? 'Vencido em aberto' : 'Nada vencido em aberto') : finance.error ? 'Indisponível' : 'Carregando'}
                    hintTone={overdue != null && overdue > 0 ? 'red' : undefined}
                    tone={overdue != null && overdue > 0 ? 'red' : 'neutral'}
                    onClick={go('caixa')}
                />
            </Glass>
            {failed ? <p className="gx-muted mt-2 text-[12.5px]">Não foi possível carregar o controle agora. Abra o Desempenho para tentar de novo.</p> : null}
        </section>
    );
};
