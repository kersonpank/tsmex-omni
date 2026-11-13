import React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Panel } from '../ui/kit';
import { IconArrowUpRight } from '../ui/icons';
import { HowItWorks } from './sistema/HowItWorks';
import { EmitterHealth, NfeHealth } from './sistema/FiscalHealth';
import { OperationRules } from './sistema/OperationRules';
import { QueueHealth } from './sistema/QueueHealth';

const CLASSIC = [
    { to: '/gestao?cat=general&sub=settings', label: 'Modelos de IA', hint: 'Provedores, modelos e chaves usados pelo chat.' },
    { to: '/gestao?cat=general&sub=especies', label: 'Espécies de NF', hint: 'Lista de espécies de volume usadas nas notas.' },
    { to: '/gestao?cat=general&sub=identidade', label: 'Emitentes fiscais', hint: 'Cadastro, certificado e ambiente de cada emitente.' },
    { to: '/gestao?cat=general&sub=numeracao', label: 'Numeração de pedidos', hint: 'Próximo número de pedido a ser emitido.' },
];

const SistemaPage: React.FC = () => (
    <div className="flex flex-col gap-8">
        <PageHeader title="Sistema" question="O que o sistema toca sozinho, onde ele ajuda e o que é só seu?" />

        <HowItWorks />

        <section aria-labelledby="saude" className="gx-stagger">
            <h2 id="saude" className="gx-h2 mb-3">
                Saúde do Autopilot
            </h2>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <QueueHealth />
                <NfeHealth />
                <div className="lg:col-span-2">
                    <EmitterHealth />
                </div>
            </div>
        </section>

        <section aria-labelledby="regras">
            <h2 id="regras" className="sr-only">
                Regras da operação
            </h2>
            <OperationRules />
        </section>

        <section>
            <Panel title="Configurações na gestão clássica" hint="Ainda moram na gestão clássica. Abrem lá, sem perder nada.">
                <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {CLASSIC.map((item) => (
                        <li key={item.to}>
                            <Link to={item.to} className="gx-row flex items-center justify-between gap-3">
                                <span>
                                    <span className="block font-semibold">{item.label}</span>
                                    <span className="gx-muted block text-[13px]">{item.hint}</span>
                                </span>
                                <IconArrowUpRight className="gx-muted flex-none" />
                            </Link>
                        </li>
                    ))}
                </ul>
            </Panel>
        </section>
    </div>
);

export default SistemaPage;
