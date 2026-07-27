import React from 'react';
import clsx from 'clsx';
import { useOptionalGestaoModuleActions, type GestaoActionKey } from './GestaoModuleActionsContext';

const DEFAULT_LABELS: Record<GestaoActionKey, string> = {
  list: 'Listagem: foco na lista principal ou alternar visualização',
  filter: 'Filtros',
  edit: 'Editar registro selecionado',
  new: 'Novo registro',
};

const IconList: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
    <path strokeLinecap="round" d="M11 6h10M11 12h10M11 18h10" />
    <path strokeLinecap="round" d="M4 6h1M4 12h1M4 18h1" />
    <path strokeLinecap="round" d="M6.5 6h1M6.5 12h1M6.5 18h1" />
  </svg>
);

const IconFilter: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
    <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" strokeLinejoin="round" />
  </svg>
);

const IconEdit: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
    <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-3L17 3.5a2 2 0 0 0-3 0L3.5 14V20Z" strokeLinejoin="round" />
    <path d="M13 6l5 5" strokeLinecap="round" />
  </svg>
);

const IconPlus: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" strokeLinecap="round" />
  </svg>
);

const GestaoActionBar: React.FC = () => {
  const ctx = useOptionalGestaoModuleActions();
  if (!ctx) return null;
  const { config } = ctx;

  const btnClass = (active: boolean, disabled: boolean, prominent = false) =>
    clsx(
      'admin-focus relative inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border text-tower-700 transition-[color,background-color,border-color,opacity,transform] duration-200 motion-reduce:transition-none dark:text-tower-200',
      prominent && !disabled
        ? 'gap-2 border-brand-600 bg-brand-600 px-4 font-bold text-white hover:border-brand-700 hover:bg-brand-700 dark:border-brand-500 dark:bg-brand-600 dark:text-white dark:hover:bg-brand-500'
        : active
          ? 'border-brand-400 bg-brand-100 text-brand-900 dark:border-brand-500 dark:bg-brand-900/60 dark:text-tower-50'
          : 'border-tower-200 bg-white/90 hover:border-brand-300 hover:bg-brand-50/80 dark:border-tower-600 dark:bg-tower-800/90 dark:hover:border-brand-600 dark:hover:bg-brand-950/50',
      disabled && 'cursor-not-allowed opacity-40 hover:border-tower-200 hover:bg-white/90 dark:hover:border-tower-600 dark:hover:bg-tower-800/90'
    );

  const renderBtn = (key: GestaoActionKey, Icon: React.FC<{ className?: string }>, onClick?: () => void) => {
    const hidden = config?.hidden?.[key];
    if (hidden) return null;
    const disabled = Boolean(config?.disabled?.[key]) || !onClick;
    const label = config?.labels?.[key] ?? DEFAULT_LABELS[key];
    const active =
      key === 'list'
        ? Boolean(config?.listActive)
        : key === 'filter'
          ? Boolean(config?.filterOpen)
          : false;
    const count = key === 'filter' ? config?.filterCount : undefined;
    const prominent = key === 'new' && Boolean(config?.prominentNew);

    return (
      <button
        type="button"
        className={btnClass(active, disabled, prominent)}
        disabled={disabled}
        aria-label={label}
        aria-pressed={key === 'list' || key === 'filter' ? active : undefined}
        title={label}
        onClick={() => {
          if (!disabled && onClick) onClick();
        }}
      >
        <Icon className="h-5 w-5" />
        {prominent ? <span className="text-sm">{label}</span> : null}
        {typeof count === 'number' && count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div
      className="mb-4 flex flex-col gap-3 rounded-2xl border border-tower-200/90 bg-tower-50/80 px-3 py-2.5 shadow-sm dark:border-tower-600 dark:bg-tower-900/50 sm:flex-row sm:items-center sm:justify-between sm:px-4"
      role="toolbar"
      aria-label="Ações do módulo"
    >
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {renderBtn('list', IconList, config?.onList)}
        {renderBtn('filter', IconFilter, config?.onFilterToggle)}
        {renderBtn('edit', IconEdit, config?.onEdit)}
        {renderBtn('new', IconPlus, config?.onNew)}
      </div>
      {config?.pills && config.pills.length > 0 ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {config.pills.map((p) => (
            <span
              key={p.id}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-brand-300/80 bg-brand-600/90 px-2.5 py-1 text-xs font-medium text-white dark:border-brand-500 dark:bg-brand-700"
            >
              <span className="truncate">{p.label}</span>
              {p.onRemove ? (
                <button
                  type="button"
                  className="admin-focus shrink-0 rounded-full p-0.5 hover:bg-white/20"
                  aria-label={`Remover filtro ${p.label}`}
                  onClick={p.onRemove}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default GestaoActionBar;
