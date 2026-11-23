import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TABS, parseTab, periodFromParams, type Period } from '../lib/desempenho';
import { PageHeader, Panel, Tabs } from '../ui/kit';
import { AprendizadoTab } from './desempenho/AprendizadoTab';
import { CaixaTab } from './desempenho/CaixaTab';
import { EntregaTab } from './desempenho/EntregaTab';
import { ExcecoesTab } from './desempenho/ExcecoesTab';
import { OperacaoTab } from './desempenho/OperacaoTab';
import { PeriodBar } from './desempenho/PeriodBar';

/**
 * Desempenho — a torre mede a operação.
 * Pergunta: "está saindo como planejado, e o sistema está acertando?" Somente leitura:
 * cada número mostra de onde veio e o que ficou de fora.
 */
const DesempenhoPage: React.FC = () => {
    const [params, setParams] = useSearchParams();
    const tab = parseTab(params.get('aba'));
    const de = params.get('de');
    const ate = params.get('ate');
    const period = useMemo<Period>(() => periodFromParams(de, ate), [de, ate]);

    const update = (patch: Record<string, string>) => {
        const next = new URLSearchParams(params);
        for (const [key, value] of Object.entries(patch)) next.set(key, value);
        setParams(next, { replace: true });
    };

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Desempenho" question="A operação está saindo como planejado, e o que o sistema sugere está certo?" />
            <Panel>
                <div className="flex flex-col gap-4">
                    <PeriodBar period={period} onChange={(next) => update({ de: next.from, ate: next.to })} />
                    <Tabs label="Indicadores" tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} value={tab} onChange={(id) => update({ aba: id })} />
                </div>
            </Panel>
            <div className="gx-rise" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
                {tab === 'operacao' ? <OperacaoTab period={period} /> : null}
                {tab === 'entrega' ? <EntregaTab period={period} /> : null}
                {tab === 'caixa' ? <CaixaTab period={period} /> : null}
                {tab === 'excecoes' ? <ExcecoesTab period={period} /> : null}
                {tab === 'aprendizado' ? <AprendizadoTab period={period} /> : null}
            </div>
        </div>
    );
};

export default DesempenhoPage;
