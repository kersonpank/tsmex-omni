import React, { useId } from 'react';
import type { BreadcrumbItem } from '../../ui/PageHeader';
import PageHeader from '../../ui/PageHeader';
import { useLayoutStore } from '../../../store/layoutStore';
import type { AdminNavSection } from './adminNavModel';
import GestaoActionBar from './GestaoActionBar';
import SystemAlertBanner from '../SystemAlertBanner';

export type { AdminNavSection } from './adminNavModel';

interface AdminShellProps {
  isHub: boolean;
  hubContextLine?: string | null;
  pageTitle: string;
  pageSubtitle: string;
  breadcrumbs: BreadcrumbItem[];
  navSections: AdminNavSection[];
  /** Barra Listagem / Filtro / Editar / Novo (Torre de controle) */
  showGestaoActionBar?: boolean;
  /** Troca de aba: força remount do painel para evitar resíduo visual entre módulos. */
  gestaoPanelKey?: string;
  children: React.ReactNode;
}

const NavIcon: React.FC<{ id: string; label: string }> = ({ id, label }) => {
  const key = `${id}-${label}`.toLowerCase();
  const cls = 'h-4 w-4 shrink-0';

  if (key.includes('cot') || key === 'co-cotações') {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M2.5 4A1.5 1.5 0 0 1 4 2.5h12A1.5 1.5 0 0 1 17.5 4v2.2a3.5 3.5 0 0 0-1.5-.33H4a3.5 3.5 0 0 0-1.5.33V4ZM4 7.5h12A2.5 2.5 0 0 1 18.5 10v6A1.5 1.5 0 0 1 17 17.5H3A1.5 1.5 0 0 1 1.5 16v-6A2.5 2.5 0 0 1 4 7.5Zm2 3a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5H6Z" /></svg>;
  }
  if (key.includes('cliente')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM3 16a5.5 5.5 0 0 1 11 0v1H3v-1Zm11.5-3.25a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Zm2.5 4.25h-1.5v-1a6.93 6.93 0 0 0-.42-2.37A4.25 4.25 0 0 1 19 17v0h-2Z" /></svg>;
  }
  if (key.includes('tarif')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h11A1.5 1.5 0 0 1 17 3.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13ZM6 6a.75.75 0 0 0 0 1.5h8A.75.75 0 0 0 14 6H6Zm0 3.5a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 0-1.5H6Zm0 3.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5H6Z" /></svg>;
  }
  if (key.includes('entrada')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h4A2.5 2.5 0 0 1 12 5.5V7h2.5A2.5 2.5 0 0 1 17 9.5v7A1.5 1.5 0 0 1 15.5 18h-11A1.5 1.5 0 0 1 3 16.5v-11Zm2.5-1a1 1 0 0 0-1 1V7h6V5.5a1 1 0 0 0-1-1h-4Zm4.03 8.22a.75.75 0 0 0-1.06 1.06l1.28 1.28a.75.75 0 0 0 1.06 0l2.78-2.78a.75.75 0 0 0-1.06-1.06l-2.25 2.25-.75-.75Z" /></svg>;
  }
  if (key.includes('demand')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M4 3.5A1.5 1.5 0 0 1 5.5 2h9A1.5 1.5 0 0 1 16 3.5v13A1.5 1.5 0 0 1 14.5 18h-9A1.5 1.5 0 0 1 4 16.5v-13ZM6.5 6a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Zm0 3a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Zm0 3a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4Z" /></svg>;
  }
  if (key.includes('viagen')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M4 5.75A2.75 2.75 0 0 1 6.75 3h6.5A2.75 2.75 0 0 1 16 5.75V12H4V5.75ZM4 13.5h12V15a2 2 0 0 1-2 2h-1a2 2 0 1 0-4 0H8a2 2 0 1 0-4 0H3.5A1.5 1.5 0 0 1 2 15.5V15a1.5 1.5 0 0 1 1.5-1.5H4Z" /></svg>;
  }
  if (key.includes('pedido')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6h1.5A1.5 1.5 0 0 1 18 7.5v9A1.5 1.5 0 0 1 16.5 18h-12A1.5 1.5 0 0 1 3 16.5v-12Zm3 4a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5H6Zm0 3a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H6Z" /></svg>;
  }
  if (key.includes('motorista')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM3.5 16a6.5 6.5 0 1 1 13 0v1h-13v-1Zm10.85-8.4 1.2-1.2 2.95 2.95-1.2 1.2-2.95-2.95Z" /></svg>;
  }
  if (key.includes('rota')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm10 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM6.92 5.38a.75.75 0 0 1 1.06 0l3.64 3.64a2.25 2.25 0 1 0 1.06-1.06L9.04 4.32a.75.75 0 1 1 1.06-1.06l3.64 3.64A3.75 3.75 0 1 1 11.1 9.54L7.46 5.9a.75.75 0 0 1 0-1.06Z" /></svg>;
  }
  if (key.includes('hub')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M10 2 2.5 6v8L10 18l7.5-4V6L10 2Zm0 1.68 5.75 3.06L10 9.8 4.25 6.74 10 3.68Zm-6 4.3L9.25 10.9v5.35L4 13.43V7.98Zm6.75 8.27V10.9L16 7.98v5.45l-5.25 2.82Z" /></svg>;
  }
  if (key.includes('pessoa')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM3 16a7 7 0 1 1 14 0v1H3v-1Z" /></svg>;
  }
  if (key.includes('fr') || key.includes('veículo')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M2 11.5A2.5 2.5 0 0 1 4.5 9H13l1.8-2.7A1.5 1.5 0 0 1 16.05 5h1.45A1.5 1.5 0 0 1 19 6.5v7a1.5 1.5 0 0 1-1.5 1.5H17a2 2 0 1 1-4 0H8a2 2 0 1 1-4 0H3.5A1.5 1.5 0 0 1 2 13.5v-2Zm3 0a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2H5Z" /></svg>;
  }
  if (key.includes('fatura') || key.includes('fin')) {
    return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h11A1.5 1.5 0 0 1 17 3.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Zm2.75 2.25a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 3.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5h-5.5Zm0 3.5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Z" /></svg>;
  }
  return <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 11a1.25 1.25 0 1 1 0 2.5A1.25 1.25 0 0 1 10 13Zm1-2.75a1 1 0 1 1-2 0V6a1 1 0 0 1 2 0v4.25Z" /></svg>;
};

const AdminShell: React.FC<AdminShellProps> = ({
  isHub,
  hubContextLine,
  pageTitle,
  pageSubtitle,
  breadcrumbs,
  navSections,
  showGestaoActionBar = false,
  gestaoPanelKey,
  children,
}) => {
  const {
    sidebarCollapsed,
    sidebarDrawerOpen,
    setSidebarCollapsed,
    setSidebarDrawerOpen,
  } = useLayoutStore();
  const navId = useId();

  return (
    <div className="admin-shell-bg admin-grain min-h-[calc(100vh-4rem)]">
      <SystemAlertBanner />
      <div className="mx-auto flex max-w-[1600px] gap-0 lg:flex-row-reverse lg:gap-8">
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
              aria-expanded={sidebarDrawerOpen}
              aria-controls={`${navId}-drawer`}
              onClick={() => setSidebarDrawerOpen(!sidebarDrawerOpen)}
            >
              <span aria-hidden>☰</span>
              Menu
            </button>
          </div>

          {sidebarDrawerOpen && (
            <div
              className="fixed inset-0 z-40 bg-tower-950/60 backdrop-blur-sm lg:hidden"
              aria-hidden={!sidebarDrawerOpen}
              onClick={() => setSidebarDrawerOpen(false)}
            />
          )}

          <div
            id={`${navId}-drawer`}
            className={`fixed inset-y-0 left-0 z-50 w-[min(100%,280px)] transform border-r border-tower-200 bg-white shadow-xl transition-transform dark:border-tower-700 dark:bg-tower-900 lg:hidden ${
              sidebarDrawerOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
            }`}
            aria-hidden={!sidebarDrawerOpen}
          >
            <div className="flex h-14 items-center justify-between border-b border-tower-200 px-4 dark:border-tower-700">
              <span className="font-display text-sm font-bold text-tower-900 dark:text-tower-100">Painel</span>
              <button type="button" className="admin-focus rounded-lg p-2 text-tower-600 dark:text-tower-400" onClick={() => setSidebarDrawerOpen(false)} aria-label="Fechar menu">
                ✕
              </button>
            </div>
            <nav className="max-h-[calc(100vh-3.5rem)] overflow-y-auto p-3" aria-label="Navegação do painel (mobile)">
              {navSections.map((section) => (
                <div key={`m-${section.title}`} className="mb-6">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-tower-600 dark:text-tower-400">{section.title}</p>
                  <ul className="flex flex-col gap-1" role="tablist" aria-label={`${section.title} (mobile)`}>
                    {section.items.map((item) => (
                      <li key={item.id} role="none">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={item.active}
                          onClick={() => {
                            item.onSelect();
                            setSidebarDrawerOpen(false);
                          }}
                          className={`admin-focus inline-flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                            item.active
                              ? 'border border-brand-200 bg-brand-100 text-brand-900 dark:border-brand-600/50 dark:bg-brand-800/90 dark:text-tower-50'
                              : 'text-tower-800 dark:text-tower-200'
                          }`}
                        >
                          <NavIcon id={item.id} label={item.label} />
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

          {showGestaoActionBar ? <GestaoActionBar /> : null}

          <div className="admin-panel-animate" role="tabpanel" key={gestaoPanelKey ?? 'gestao-panel'}>
            {children}
          </div>
        </div>

        {/* Sidebar desktop (esquerda, retraída por padrão) */}
        <aside
          className={`sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 flex-col border-r border-brand-200/80 bg-white/95 py-6 backdrop-blur-md transition-all dark:border-brand-800/50 dark:bg-brand-950/90 lg:flex ${
            sidebarCollapsed ? 'w-16' : 'w-72'
          }`}
          aria-label="Navegação do painel"
        >
          <div className="mb-3 px-2">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="admin-focus flex w-full items-center justify-center rounded-lg border border-tower-200 px-2 py-2 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
              aria-label={sidebarCollapsed ? 'Expandir menu lateral' : 'Retrair menu lateral'}
            >
              {sidebarCollapsed ? '⇨' : '⇦'}
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-2" id={navId}>
            {navSections.map((section) => (
              <div key={section.title}>
                {!sidebarCollapsed ? (
                  <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-tower-600 dark:text-tower-400">
                    {section.title}
                  </p>
                ) : null}
                <ul className="flex flex-col gap-0.5" role="tablist" aria-label={section.title}>
                  {section.items.map((item) => (
                    <li key={item.id} role="none">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={item.active}
                        onClick={() => {
                          item.onSelect();
                          setSidebarDrawerOpen(false);
                        }}
                        title={item.label}
                        className={`admin-focus flex w-full items-center rounded-lg ${sidebarCollapsed ? 'justify-center px-2 py-2' : 'gap-2 px-3 py-2 text-left'} text-sm font-medium transition ${
                          item.active
                            ? 'border border-brand-200 bg-brand-100 text-brand-900 dark:border-brand-600/50 dark:bg-brand-800/90 dark:text-tower-50'
                            : 'text-tower-800 hover:bg-brand-50/90 dark:text-tower-200 dark:hover:bg-brand-900/50'
                        }`}
                      >
                        <NavIcon id={item.id} label={item.label} />
                        {sidebarCollapsed ? null : item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>
      </div>
    </div>
  );
};

export default AdminShell;
