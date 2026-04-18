import React from 'react';

export interface BreadcrumbItem {
  label: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, description, breadcrumbs, actions }) => (
  <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Trilha" className="mb-2 text-xs font-medium text-tower-700 dark:text-tower-300">
          <ol className="flex flex-wrap items-center gap-1.5">
            {breadcrumbs.map((b, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-tower-400 dark:text-tower-500" aria-hidden>/</span>}
                <span className={i === breadcrumbs.length - 1 ? 'font-semibold text-tower-900 dark:text-tower-100' : 'text-tower-700 dark:text-tower-300'}>{b.label}</span>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <h2 className="font-display text-xl font-bold tracking-tight text-tower-900 dark:text-tower-50 sm:text-2xl">{title}</h2>
      {description && <p className="mt-1 max-w-2xl text-sm text-tower-700 dark:text-tower-300">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export default PageHeader;
