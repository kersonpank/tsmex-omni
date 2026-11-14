import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '../ui/kit';
import { ConfigTab } from './sistema/ConfigTab';
import { FiscalTab } from './sistema/FiscalTab';
import { EmitterHealth, NfeHealth } from './sistema/FiscalHealth';
import { HowItWorks } from './sistema/HowItWorks';
import { QueueHealth } from './sistema/QueueHealth';

const TABS = [
    { id: 'torre', label: 'Como a torre trabalha' },
    { id: 'fiscal', label: 'Fiscal' },
    { id: 'config', label: 'Configurações' },
];

const SistemaPage: React.FC = () => {
    const [params, setParams] = useSearchParams();
    const requested = params.get('aba') ?? 'torre';
    const aba = TABS.some((t) => t.id === requested) ? requested : 'torre';

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Sistema" question="O que o sistema toca sozinho, onde ele ajuda e o que é só seu?" />
            <Tabs label="Áreas do sistema" tabs={TABS} value={aba} onChange={(id) => setParams(id === 'torre' ? {} : { aba: id }, { replace: true })} />

            {aba === 'torre' ? (
                <div className="flex flex-col gap-8">
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
                </div>
            ) : null}
            {aba === 'fiscal' ? <FiscalTab /> : null}
            {aba === 'config' ? <ConfigTab /> : null}
        </div>
    );
};

export default SistemaPage;
