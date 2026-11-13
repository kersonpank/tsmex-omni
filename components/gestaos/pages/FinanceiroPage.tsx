import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Panel, Stat, Tabs } from '../ui/kit';
import { money, plural } from '../lib/format';
import { fromCents } from '../lib/financeiro';
import { useUnbilledFreight } from '../lib/data';
import { AcordosTab } from './financeiro/AcordosTab';
import { FaturarTab } from './financeiro/FaturarTab';
import { PagarTab } from './financeiro/PagarTab';
import { ReceberTab } from './financeiro/ReceberTab';
import { usePayableTotals, useReceivable } from './financeiro/useFinanceiro';

const TABS = [
    { id: 'faturar', label: 'A faturar' },
    { id: 'receber', label: 'A receber' },
    { id: 'pagar', label: 'A pagar' },
    { id: 'acordos', label: 'Acordos de custo' },
] as const;

type TabId = (typeof TABS)[number]['id'];
const isTab = (value: string | null): value is TabId => TABS.some((tab) => tab.id === value);

const FinanceiroPage: React.FC = () => {
    const [params, setParams] = useSearchParams();
    const aba: TabId = isTab(params.get('aba')) ? (params.get('aba') as TabId) : 'faturar';

    const unbilled = useUnbilledFreight();
    const { totals: receivable } = useReceivable();
    const { totals: payable } = usePayableTotals();

    /** Trocar de aba limpa o item aberto (fatura ou título) da aba anterior. */
    const go = (id: string) => setParams({ aba: id }, { replace: true });

    const unbilledCount = unbilled.data?.count ?? null;
    const pending = '…';

    return (
        <div>
            <PageHeader title="Financeiro" question="O que já pode virar dinheiro, o que falta receber e o que vence para pagar?" />

            <Panel className="gx-rise mb-6" padded={false}>
                <div className="grid grid-cols-1 gap-1 p-2 md:grid-cols-3">
                    <Stat
                        label="Frete emitido sem fatura"
                        value={unbilled.data ? money(unbilled.data.totalAmount) : pending}
                        hint={unbilled.data ? `${plural(unbilled.data.count, 'pedido', 'pedidos')}${unbilled.data.count ? ` · o mais antigo espera há ${plural(unbilled.data.oldestDays, 'dia', 'dias')}` : ''}` : (unbilled.error ?? 'Carregando')}
                        tone={unbilledCount ? 'yellow' : 'neutral'}
                        onClick={() => go('faturar')}
                    />
                    <Stat
                        label="A receber"
                        value={receivable ? money(fromCents(receivable.totalCents)) : pending}
                        hint={
                            receivable
                                ? `${plural(receivable.count, 'fatura aberta', 'faturas abertas')}${receivable.overdueCount ? ` · ${money(fromCents(receivable.overdueCents))} vencidos` : ''}${receivable.approximate ? ' · valor aproximado' : ''}`
                                : 'Carregando'
                        }
                        tone={receivable?.overdueCount ? 'red' : 'neutral'}
                        onClick={() => go('receber')}
                    />
                    <Stat
                        label="A pagar"
                        value={payable ? money(fromCents(payable.totalCents)) : pending}
                        hint={payable ? `${plural(payable.count, 'título aberto', 'títulos abertos')}${payable.overdueCount ? ` · ${money(fromCents(payable.overdueCents))} vencidos` : ''}` : 'Carregando'}
                        tone={payable?.overdueCount ? 'red' : 'neutral'}
                        onClick={() => go('pagar')}
                    />
                </div>
            </Panel>

            <div className="mb-5">
                <Tabs
                    label="Seções do financeiro"
                    value={aba}
                    onChange={go}
                    tabs={TABS.map((tab) => ({
                        id: tab.id,
                        label: tab.label,
                        count: tab.id === 'faturar' ? unbilledCount : tab.id === 'receber' ? (receivable?.count ?? null) : tab.id === 'pagar' ? (payable?.count ?? null) : null,
                    }))}
                />
            </div>

            <div className="gx-rise" key={aba}>
                {aba === 'faturar' ? <FaturarTab /> : null}
                {aba === 'receber' ? <ReceberTab /> : null}
                {aba === 'pagar' ? <PagarTab /> : null}
                {aba === 'acordos' ? <AcordosTab /> : null}
            </div>
        </div>
    );
};

export default FinanceiroPage;
