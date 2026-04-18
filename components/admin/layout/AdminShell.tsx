import React, { useId } from 'react';
import type { BreadcrumbItem } from '../../ui/PageHeader';
import PageHeader from '../../ui/PageHeader';

export interface AdminNavSection {
  title: string;
  items: {
    id: string;
    label: string;
    active: boolean;
    onSelect: () => void;
  }[];
}

interface AdminShellProps {
  isHub: boolean;
  hubContextLine?: string | null;
  pageTitle: string;
  pageSubtitle: string;
  breadcrumbs: BreadcrumbItem[];
  navSections: AdminNavSection[];
  children: React.ReactNode;
}

const AdminShell: React.FC<AdminShellProps> = ({
  isHub,
  hubContextLine,
  pageTitle,
  pageSubtitle,
  breadcrumbs,
  navSections,
  children,
}) => {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const navId = useId();

  return (
    <div className="admin-shell-bg admin-grain min-h-[calc(100vh-4rem)]">
      <div className="mx-auto flex max-w-[1600px] gap-0 lg:gap-8">
        {/* Sidebar desktop */}
        <aside
          className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col border-r border-brand-200/70 bg-white/80 py-6 backdrop-blur-md dark:border-brand-800/50 dark:bg-brand-950/55 lg:flex"
          aria-label="Navegação do painel"
        >
          <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3" id={navId}>
            {navSections.map((section) => (
              <div key={section.title}>
                <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-tower-400 dark:text-tower-500">
                  {section.title}
                </p>
                <ul className="flex flex-col gap-0.5" role="tablist" aria-label={section.title}>
                  {section.items.map((item) => (
                    <li key={item.id} role="none">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={item.active}
                        onClick={() => {
                          item.onSelect();
                          setDrawerOpen(false);
                        }}
                        className={`admin-focus flex w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                          item.active
                            ? 'border border-brand-200 bg-brand-100 text-brand-900 dark:border-brand-600/50 dark:bg-brand-800/90 dark:text-tower-50'
                            : 'text-tower-600 hover:bg-brand-50/90 dark:text-tower-400 dark:hover:bg-brand-900/50'
                        }`}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Conteúdo */}
        <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {hubContextLine && (
            <div className="mb-4 rounded-lg border border-brand-500/25 bg-brand-100/95 px-3 py-2 text-xs font-medium text-brand-900 dark:border-brand-400/30 dark:bg-brand-900/70 dark:text-tower-50">
              {hubContextLine}
            </div>
          )}

          <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
            <button
              type="button"
              className="admin-focus inline-flex items-center gap-2 rounded-lg border border-tower-200 bg-white/90 px-3 py-2 text-sm font-semibold text-tower-800 shadow-sm dark:border-tower-600 dark:bg-tower-800/90 dark:text-tower-100"
              aria-expanded={drawerOpen}
              aria-controls={`${navId}-drawer`}
              onClick={() => setDrawerOpen((o) => !o)}
            >
              <span aria-hidden>☰</span>
              Menu
            </button>
          </div>

          {drawerOpen && (
            <div
              className="fixed inset-0 z-40 bg-tower-950/60 backdrop-blur-sm lg:hidden"
              aria-hidden={!drawerOpen}
              onClick={() => setDrawerOpen(false)}
            />
          )}

          <div
            id={`${navId}-drawer`}
            className={`fixed inset-y-0 left-0 z-50 w-[min(100%,280px)] transform border-r border-tower-200 bg-white shadow-xl transition-transform dark:border-tower-700 dark:bg-tower-900 lg:hidden ${
              drawerOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
            }`}
            aria-hidden={!drawerOpen}
          >
            <div className="flex h-14 items-center justify-between border-b border-tower-200 px-4 dark:border-tower-700">
              <span className="font-display text-sm font-bold text-tower-900 dark:text-tower-100">Painel</span>
              <button type="button" className="admin-focus rounded-lg p-2 text-tower-600 dark:text-tower-400" onClick={() => setDrawerOpen(false)} aria-label="Fechar menu">
                ✕
              </button>
            </div>
            <nav className="max-h-[calc(100vh-3.5rem)] overflow-y-auto p-3" aria-label="Navegação do painel (mobile)">
              {navSections.map((section) => (
                <div key={`m-${section.title}`} className="mb-6">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-tower-400">{section.title}</p>
                  <ul className="flex flex-col gap-1" role="tablist" aria-label={`${section.title} (mobile)`}>
                    {section.items.map((item) => (
                      <li key={item.id} role="none">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={item.active}
                          onClick={() => {
                            item.onSelect();
                            setDrawerOpen(false);
                          }}
                          className={`admin-focus w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                            item.active
                              ? 'border border-brand-200 bg-brand-100 text-brand-900 dark:border-brand-600/50 dark:bg-brand-800/90 dark:text-tower-50'
                              : 'text-tower-700 dark:text-tower-300'
                          }`}
                        >
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>

          <PageHeader title={pageTitle} description={pageSubtitle} breadcrumbs={breadcrumbs} />

          <div className="admin-panel-animate" role="tabpanel">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminShell;
