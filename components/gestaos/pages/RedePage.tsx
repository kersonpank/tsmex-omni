import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useResource } from '../lib/resource';
import { linksApi } from '../../../lib/api';
import type { Link } from '../../../types/index';
import { PageHeader, Tabs } from '../ui/kit';
import { approvalCounts } from '../lib/redeCarriers';
import { CadastrosTab } from './rede/CadastrosTab';
import { CarriersTab } from './rede/CarriersTab';
import { HubsTab } from './rede/HubsTab';

const TAB_IDS = ['hubs', 'transportadores', 'cadastros'] as const;
type TabId = (typeof TAB_IDS)[number];

const RedePage: React.FC = () => {
    const [params, setParams] = useSearchParams();
    const raw = params.get('aba');
    const tab: TabId = (TAB_IDS as readonly string[]).includes(raw ?? '') ? (raw as TabId) : 'hubs';

    // Mesma chave da aba Transportadores: uma busca só, e a contagem de pendentes aparece na aba.
    const links = useResource<Link[]>('links:all', async () => (await linksApi.list()).data ?? [], { staleMs: 30_000 });
    const pending = links.data ? approvalCounts(links.data).PENDING : null;

    const select = (id: string) => {
        const next = new URLSearchParams(params);
        if (id === 'hubs') next.delete('aba');
        else next.set('aba', id);
        setParams(next, { replace: true });
    };

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Rede" question="A rede está de pé para rodar hoje?" />
            <Tabs
                label="Seções da rede"
                value={tab}
                onChange={select}
                tabs={[
                    { id: 'hubs', label: 'Hubs' },
                    { id: 'transportadores', label: 'Transportadores', count: pending || null },
                    { id: 'cadastros', label: 'Cadastros' },
                ]}
            />
            {tab === 'hubs' ? <HubsTab /> : tab === 'transportadores' ? <CarriersTab /> : <CadastrosTab />}
        </div>
    );
};

export default RedePage;
