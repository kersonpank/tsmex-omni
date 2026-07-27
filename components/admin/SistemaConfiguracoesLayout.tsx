import React from 'react';
import type { GeneralSubTab } from './layout/adminQuery';

const TABS: { id: GeneralSubTab; label: string; aria: string }[] = [
  { id: 'settings', label: 'LLM', aria: 'Configurações de modelos de linguagem' },
  { id: 'especies', label: 'Espécies NF', aria: 'Cadastro de espécies de nota fiscal' },
  { id: 'identidade', label: 'Emitentes Fiscais', aria: 'CNPJs emissores, certificado A1 e impressão fiscal' },
  { id: 'numeracao', label: 'Numeração de Pedidos', aria: 'Contador global do número sequencial de pedidos' },
];

export interface SistemaConfiguracoesLayoutProps {
  activeTab: GeneralSubTab;
  onSelectTab: (tab: GeneralSubTab) => void;
  children: React.ReactNode;
}

const SistemaConfiguracoesLayout: React.FC<SistemaConfiguracoesLayoutProps> = ({ activeTab, onSelectTab, children }) => {
  const listId = React.useId();

  return (
    <div>
      <div
        className="mb-6 border-b border-tower-200 dark:border-tower-700"
        role="tablist"
        aria-label="Seções de configurações"
        id={listId}
      >
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const selected = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`${listId}-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`${listId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelectTab(t.id)}
                className={`admin-focus -mb-px rounded-t-lg px-4 py-2.5 text-sm font-semibold transition ${
                  selected
                    ? 'border border-b-0 border-tower-200 bg-white text-brand-800 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-50'
                    : 'border border-transparent text-tower-600 hover:text-tower-900 dark:text-tower-400 dark:hover:text-tower-100'
                }`}
              >
                <span className="sr-only">{t.aria} — </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        id={`${listId}-panel`}
        role="tabpanel"
        aria-labelledby={`${listId}-tab-${activeTab}`}
        className="min-h-[240px]"
      >
        {children}
      </div>
    </div>
  );
};

export default SistemaConfiguracoesLayout;
