import React from 'react';
import type { Hub } from '../../../../../types/index';
import { Pill, Tabs } from '../../../ui/kit';
import { Drawer } from '../../../ui/overlay';
import { HubCoverage } from './HubCoverage';
import { HubForm } from './HubForm';
import { HubOperators } from './HubOperators';

export type HubPanel = 'dados' | 'operadores' | 'cobertura';
export const HUB_PANELS: readonly HubPanel[] = ['dados', 'operadores', 'cobertura'];

/** Gaveta do hub: novo (só dados) ou existente (dados, operadores e cobertura). O estado vive na URL. */
export const HubDrawer: React.FC<{ hub: Hub | null; panel: HubPanel; onPanel: (panel: HubPanel) => void; onSaved: (hub: Hub) => void; onClose: () => void }> = ({ hub, panel, onPanel, onSaved, onClose }) => (
    <Drawer
        open
        onClose={onClose}
        width={820}
        title={hub ? hub.name : 'Novo hub'}
        subtitle={hub ? `${hub.code} · ${hub.city}/${hub.state}` : 'Crie o depósito; depois cadastre operadores e a cobertura.'}
        badge={hub && !hub.active ? <Pill>inativo</Pill> : undefined}
    >
        <div className="flex flex-col gap-5">
            {hub ? (
                <Tabs
                    label="Seções do hub"
                    value={panel}
                    onChange={(id) => onPanel(id as HubPanel)}
                    tabs={[
                        { id: 'dados', label: 'Dados' },
                        { id: 'operadores', label: 'Operadores' },
                        { id: 'cobertura', label: 'Cobertura' },
                    ]}
                />
            ) : null}
            {!hub || panel === 'dados' ? <HubForm key={hub?.id ?? 'novo'} hub={hub} onSaved={onSaved} onCancel={onClose} /> : null}
            {hub && panel === 'operadores' ? <HubOperators hub={hub} /> : null}
            {hub && panel === 'cobertura' ? <HubCoverage hub={hub} /> : null}
        </div>
    </Drawer>
);
