import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useOperationsSummary } from '../lib/data';
import { num } from '../lib/format';
import { LinkButton } from '../ui/form';
import { Glass, Loadable, PageHeader, Panel, Skeleton, Stat, Tabs } from '../ui/kit';
import { IconArrowUpRight } from '../ui/icons';
import { FunnelPanel } from './comercial/FunnelPanel';
import { OportunidadesTab } from './comercial/OportunidadesTab';
import { QuotePanel } from './comercial/QuotePanel';
import { TarifasTab } from './comercial/TarifasTab';

const TABS = [
    { id: 'cotacoes', label: 'Cotações' },
    { id: 'oportunidades', label: 'Oportunidades' },
    { id: 'tarifas', label: 'Tarifas' },
];

const ComercialPage: React.FC = () => {
    const summary = useOperationsSummary();
    const [params, setParams] = useSearchParams();
    const requested = params.get('aba') ?? 'cotacoes';
    const aba = TABS.some((t) => t.id === requested) ? requested : 'cotacoes';

    return (
        <div>
            <PageHeader
                title="Comercial"
                question="Quem está esperando preço ou resposta nossa?"
                actions={
                    <LinkButton to="/gestaos/pedidos/novo" variant="soft" size="sm">
                        Novo pedido
                    </LinkButton>
                }
            />

            <Glass className="gx-rise mb-6 p-2">
                <Loadable state={summary} skeleton={<Skeleton rows={1} height={72} className="p-2" />}>
                    {(data) => (
                        <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
                            <Stat label="Aguardando cotação" value={num(data.cenario.aguardandoCotacao)} tone={data.cenario.aguardandoCotacao > 0 ? 'yellow' : 'neutral'} hint="Clientes esperando preço" />
                            <Stat label="Coletas na fila" value={num(data.coletas.fila)} hint="Aprovadas ou em manifesto" />
                            <Stat label="Coletas em rota" value={num(data.coletas.emRota)} hint="Coletadas ou em trânsito" />
                            <Stat label="Clientes novos em 7 dias" value={num(data.clientes.novos7d)} hint={`${num(data.clientes.novos30d)} em 30 dias · ${num(data.clientes.total)} no total`} />
                        </div>
                    )}
                </Loadable>
            </Glass>

            <div className="mb-5">
                <Tabs label="Áreas do comercial" tabs={TABS} value={aba} onChange={(id) => setParams(id === 'cotacoes' ? {} : { aba: id }, { replace: true })} />
            </div>

            {aba === 'cotacoes' ? (
                <div className="gx-stagger grid grid-cols-1 gap-6 lg:grid-cols-12">
                    <div className="min-w-0 lg:col-span-8">
                        <QuotePanel />
                    </div>
                    <div className="flex min-w-0 flex-col gap-6 lg:col-span-4">
                        <FunnelPanel />
                        <Panel title="Atalhos" hint="Cadastro de clientes ainda mora na gestão clássica.">
                            <ul className="flex flex-col gap-1">
                                <li>
                                    <Link to="/gestao?cat=commercial&sub=clientes" className="gx-row flex items-center justify-between gap-3">
                                        <span>
                                            <span className="block font-semibold">Clientes</span>
                                            <span className="gx-muted block text-[13px]">Cadastro e contas de quem embarca.</span>
                                        </span>
                                        <IconArrowUpRight className="gx-muted flex-none" />
                                    </Link>
                                </li>
                            </ul>
                        </Panel>
                    </div>
                </div>
            ) : null}
            {aba === 'oportunidades' ? <OportunidadesTab /> : null}
            {aba === 'tarifas' ? <TarifasTab /> : null}
        </div>
    );
};

export default ComercialPage;
