import React from 'react';
import { OrderNumberPanel, SpeciesPanel } from './ConfigPanels';
import { LlmPanel } from './LlmPanel';
import { OperationRules } from './OperationRules';

export const ConfigTab: React.FC = () => (
    <div className="gx-stagger grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OrderNumberPanel />
        <OperationRules />
        <SpeciesPanel />
        <LlmPanel />
    </div>
);
