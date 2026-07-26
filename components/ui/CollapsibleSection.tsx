// components/ui/CollapsibleSection.tsx
import React from 'react';

export type CollapsibleSectionKey = string;

interface CollapsibleSectionProps {
  title: string;
  sectionKey: CollapsibleSectionKey;
  expanded: boolean;
  onToggle: (section: CollapsibleSectionKey) => void;
  children: React.ReactNode;
  helper?: string;
  showToggle?: boolean;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  sectionKey,
  expanded,
  onToggle,
  children,
  helper,
  showToggle = true,
}) => (
  <section className="rounded-2xl border border-tower-200 bg-white p-5 dark:border-tower-700 dark:bg-tower-900/50">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-tower-600 dark:text-tower-300">{title}</h2>
      {showToggle ? (
        <button
          type="button"
          onClick={() => onToggle(sectionKey)}
          className="admin-focus rounded-lg border border-tower-300 px-2.5 py-1 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Recolher' : 'Expandir'} seção ${title}`}
        >
          {expanded ? 'Recolher' : 'Expandir'}
        </button>
      ) : null}
    </div>
    {helper ? <p className="mt-2 text-xs text-tower-500 dark:text-tower-400">{helper}</p> : null}
    {showToggle ? (
      <div
        className={`grid transition-all duration-300 ease-out ${expanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`}
        aria-hidden={!expanded}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    ) : (
      <div className="mt-3">{children}</div>
    )}
  </section>
);

export default CollapsibleSection;
