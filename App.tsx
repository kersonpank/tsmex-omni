import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import GlobalSystemMenu, { shouldShowGlobalSystemMenu } from './components/admin/layout/GlobalSystemMenu';
import AdminDashboard from './components/AdminDashboard';
import ClientDashboard from './components/ClientDashboard';
import CompanyOnboarding from './components/CompanyOnboarding';
import ChatWeb from './components/ChatWeb';
import TrackingView from './components/TrackingView';
import Login from './components/Login';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuthStore } from './store/authStore';
import FormCotacao from './components/forms/FormCotacao';
import FormColeta from './components/forms/FormColeta';
import WorkspacePicker from './components/WorkspacePicker';
import RoleWorkspaceSwitcher from './components/RoleWorkspaceSwitcher';
import OperacaoApp from './components/operacao/OperacaoApp';
import OperacaoOnboarding from './components/operacao/OperacaoOnboarding';
import HubCadastro from './components/HubCadastro';
import ThemeToggle from './components/ui/ThemeToggle';
import OrderDetailPage from './components/admin/OrderDetailPage';
import { useLayoutStore } from './store/layoutStore';
import { getDefaultHomePath, syncRoleForPath } from './lib/postLoginDefaultPath';

const OperacaoRedirect: React.FC = () => {
  const { user, currentRole } = useAuthStore();
  const role = currentRole && user?.roles?.includes(currentRole) ? currentRole : user?.roles?.[0];
  if (role === 'LINK') return <Navigate to="/link" replace />;
  if (role === 'HUB') return <Navigate to="/hub" replace />;
  return <Navigate to="/gestao" replace />;
};

/** Redireciona `/` autenticado conforme prioridade de papéis (ADMIN > HUB > LINK > CLIENT). */
const AuthenticatedHomeRedirect: React.FC = () => {
  const { isAuthenticated, user, setCurrentRole } = useAuthStore();
  const dest = getDefaultHomePath(user?.roles);

  useEffect(() => {
    if (!isAuthenticated) return;
    const synced = syncRoleForPath(dest, user?.roles);
    if (synced) setCurrentRole(synced);
  }, [isAuthenticated, dest, user?.roles, setCurrentRole]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={dest} replace />;
};

const Navigation: React.FC = () => {
  const location = useLocation();
  const { user, logout, isAuthenticated, currentRole } = useAuthStore();
  const role = currentRole && user?.roles?.includes(currentRole) ? currentRole : user?.roles?.[0];
  const roleLabels: Record<string, string> = { ADMIN: 'Admin', CLIENT: 'Cliente', LINK: 'Link', HUB: 'Hub' };
  const [mobileOpen, setMobileOpen] = useState(false);
  const { toggleSidebarCollapsed, toggleSidebarDrawer } = useLayoutStore();
  const isLogin = location.pathname === '/login';
  const canUseSystemMenu =
    isAuthenticated && role === 'ADMIN' && shouldShowGlobalSystemMenu(location.pathname);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (isLogin || location.pathname === '/link/cadastro' || location.pathname === '/hub/cadastro') return null;

  const navLinks = (
    <>
      {role === 'ADMIN' && (
        <Link to="/gestao" className="admin-focus font-medium text-tower-600 transition hover:text-brand-600 dark:text-tower-300 dark:hover:text-brand-300" onClick={() => setMobileOpen(false)}>
          Torre de Controle
        </Link>
      )}
      {role === 'HUB' && (
        <Link to="/hub" className="admin-focus font-medium text-tower-600 transition hover:text-brand-600 dark:text-tower-300 dark:hover:text-brand-300" onClick={() => setMobileOpen(false)}>
          Operação Hub
        </Link>
      )}
      {role === 'CLIENT' && (
        <Link to="/client" className="admin-focus font-medium text-tower-600 transition hover:text-brand-600 dark:text-tower-300 dark:hover:text-brand-300" onClick={() => setMobileOpen(false)}>
          Dashboard
        </Link>
      )}
      {role === 'LINK' && (
        <Link to="/link" className="admin-focus font-medium text-tower-600 transition hover:text-brand-600 dark:text-tower-300 dark:hover:text-brand-300" onClick={() => setMobileOpen(false)}>
          Minha Carga
        </Link>
      )}
      <Link to="/chat/demo" className="admin-focus font-medium text-tower-600 transition hover:text-brand-600 dark:text-tower-300 dark:hover:text-brand-300" onClick={() => setMobileOpen(false)}>
        Minhas Demandas
      </Link>
      {role === 'CLIENT' && (
        <>
          <Link to="/form/cotacao" className="admin-focus font-medium text-tower-600 transition hover:text-brand-600 dark:text-tower-300 dark:hover:text-brand-300" onClick={() => setMobileOpen(false)}>
            Cotação
          </Link>
          <Link to="/form/coleta" className="admin-focus font-medium text-tower-600 transition hover:text-brand-600 dark:text-tower-300 dark:hover:text-brand-300" onClick={() => setMobileOpen(false)}>
            Coleta
          </Link>
        </>
      )}
    </>
  );

  return (
    <nav className="sticky top-0 z-50 border-b border-brand-200/80 bg-white/95 backdrop-blur-md dark:border-brand-800/40 dark:bg-brand-950/92">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 dark:bg-brand-100">
              <span className="font-display text-lg font-extrabold text-white dark:text-brand-900">TSM</span>
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-tower-900 dark:text-tower-50">EX OMNI</span>
            {canUseSystemMenu && (
              <button
                type="button"
                onClick={() => {
                  if (window.matchMedia('(min-width: 1024px)').matches) {
                    toggleSidebarCollapsed();
                  } else {
                    toggleSidebarDrawer();
                  }
                }}
                className="admin-focus ml-2 rounded-lg border border-tower-200 px-2.5 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
                aria-label="Alternar menu do sistema"
              >
                Menu sistema
              </button>
            )}
          </div>

          <div className="hidden items-center space-x-8 md:flex">
            {isAuthenticated && (
              <>
                {navLinks}
                <div className="flex items-center gap-4 border-l border-tower-200 pl-4 dark:border-tower-700">
                  <ThemeToggle />
                  <RoleWorkspaceSwitcher variant="desktop" />
                  <div className="text-sm">
                    <div className="font-medium text-tower-900 dark:text-tower-100">{user?.email}</div>
                    <div className="text-xs text-tower-500 dark:text-tower-400">{roleLabels[role ?? ''] ?? role ?? '—'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={logout}
                    className="px-4 py-2 text-sm font-medium text-tower-600 transition hover:text-red-600 dark:text-tower-300 dark:hover:text-red-400"
                  >
                    Sair
                  </button>
                </div>
              </>
            )}
          </div>

          {isAuthenticated && (
            <div className="flex items-center gap-2 md:hidden">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => setMobileOpen((o) => !o)}
                className="admin-focus rounded-lg p-2 text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800"
                aria-label="Abrir menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          )}
        </div>

        {isAuthenticated && mobileOpen && (
          <div className="space-y-1 border-t border-tower-200 py-4 dark:border-tower-700 md:hidden">
            <div className="flex flex-col gap-1">
              {role === 'ADMIN' && (
                <Link
                  to="/gestao"
                  className="admin-focus rounded-lg px-3 py-2 font-medium text-tower-800 hover:bg-tower-100 dark:text-tower-200 dark:hover:bg-tower-800"
                  onClick={() => setMobileOpen(false)}
                >
                  Torre de Controle
                </Link>
              )}
              {role === 'HUB' && (
                <Link
                  to="/hub"
                  className="admin-focus rounded-lg px-3 py-2 font-medium text-tower-800 hover:bg-tower-100 dark:text-tower-200 dark:hover:bg-tower-800"
                  onClick={() => setMobileOpen(false)}
                >
                  Operação Hub
                </Link>
              )}
              {role === 'CLIENT' && (
                <Link
                  to="/client"
                  className="admin-focus rounded-lg px-3 py-2 font-medium text-tower-800 hover:bg-tower-100 dark:text-tower-200 dark:hover:bg-tower-800"
                  onClick={() => setMobileOpen(false)}
                >
                  Dashboard
                </Link>
              )}
              {role === 'LINK' && (
                <Link
                  to="/link"
                  className="admin-focus rounded-lg px-3 py-2 font-medium text-tower-800 hover:bg-tower-100 dark:text-tower-200 dark:hover:bg-tower-800"
                  onClick={() => setMobileOpen(false)}
                >
                  Minha Carga
                </Link>
              )}
              <Link
                to="/chat/demo"
                className="admin-focus rounded-lg px-3 py-2 font-medium text-tower-800 hover:bg-tower-100 dark:text-tower-200 dark:hover:bg-tower-800"
                onClick={() => setMobileOpen(false)}
              >
                Minhas Demandas
              </Link>
              {role === 'CLIENT' && (
                <>
                  <Link
                    to="/form/cotacao"
                    className="admin-focus rounded-lg px-3 py-2 font-medium text-tower-800 hover:bg-tower-100 dark:text-tower-200 dark:hover:bg-tower-800"
                    onClick={() => setMobileOpen(false)}
                  >
                    Cotação
                  </Link>
                  <Link
                    to="/form/coleta"
                    className="admin-focus rounded-lg px-3 py-2 font-medium text-tower-800 hover:bg-tower-100 dark:text-tower-200 dark:hover:bg-tower-800"
                    onClick={() => setMobileOpen(false)}
                  >
                    Coleta
                  </Link>
                </>
              )}
            </div>
            <RoleWorkspaceSwitcher variant="mobile" onAfterSwitch={() => setMobileOpen(false)} />
            <div className="mt-4 border-t border-tower-200 px-3 pt-4 dark:border-tower-700">
              <div className="mb-2 text-sm text-tower-500 dark:text-tower-400">{user?.email}</div>
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  logout();
                }}
                className="w-full rounded-lg px-3 py-2 text-left font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Sair
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

const AppMain: React.FC = () => {
  const location = useLocation();
  const { sidebarCollapsed } = useLayoutStore();
  const { user, currentRole } = useAuthStore();
  const role = currentRole && user?.roles?.includes(currentRole) ? currentRole : user?.roles?.[0];
  const canSystem = role === 'ADMIN';
  const useGlobalPl = canSystem && shouldShowGlobalSystemMenu(location.pathname);
  const mainPl = useGlobalPl ? (sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-72') : '';

  return (
    <>
      <GlobalSystemMenu />
      <main className={`flex-grow ${mainPl}`}>
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/onboarding" element={<CompanyOnboarding />} />
            <Route path="/app" element={<Navigate to="/gestao" replace />} />
            <Route path="/gestao" element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminDashboard />
              </ProtectedRoute>
            } />
            <Route path="/client" element={
              <ProtectedRoute allowedRoles={['CLIENT']}>
                <ClientDashboard />
              </ProtectedRoute>
            } />
            <Route path="/form/cotacao" element={
              <ProtectedRoute allowedRoles={['CLIENT']}>
                <FormCotacao />
              </ProtectedRoute>
            } />
            <Route path="/form/coleta" element={
              <ProtectedRoute allowedRoles={['CLIENT']}>
                <FormColeta />
              </ProtectedRoute>
            } />
            <Route path="/form/coleta/:opportunityId" element={
              <ProtectedRoute allowedRoles={['CLIENT']}>
                <FormColeta />
              </ProtectedRoute>
            } />
            <Route path="/escolher-painel" element={<WorkspacePicker />} />
            <Route path="/unauthorized" element={<Navigate to="/escolher-painel" replace />} />
            <Route path="/chat/:slug" element={<ChatWeb />} />
            <Route path="/tracking/:id" element={<TrackingView />} />
            <Route path="/orders/:id" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'HUB', 'LINK', 'CLIENT']}>
                <OrderDetailPage />
              </ProtectedRoute>
            } />
            <Route path="/link/cadastro" element={<OperacaoOnboarding />} />
            <Route path="/hub/cadastro" element={<HubCadastro />} />
            <Route path="/link" element={
              <ProtectedRoute allowedRoles={['LINK']}>
                <OperacaoApp />
              </ProtectedRoute>
            } />
            <Route path="/hub" element={
              <ProtectedRoute allowedRoles={['HUB']}>
                <OperacaoApp />
              </ProtectedRoute>
            } />
            <Route path="/operacao" element={<OperacaoRedirect />} />
            <Route path="/operacao/cadastro" element={<Navigate to="/link/cadastro" replace />} />
            <Route path="/" element={<AuthenticatedHomeRedirect />} />
        </Routes>
      </main>
    </>
  );
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <div className="flex min-h-screen flex-col bg-tower-50 text-tower-900 dark:bg-brand-950 dark:text-tower-100">
        <Navigation />
        <AppMain />

        <footer className="mt-auto border-t border-brand-800 bg-brand-900 px-4 py-8 text-tower-400 dark:border-brand-800 dark:bg-brand-950 dark:text-tower-500">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-xs font-medium uppercase tracking-widest md:flex-row">
            <div>TSM EX · Sistema conectado ao backend</div>
            <div className="flex gap-6">
              <a href="#" className="transition-colors hover:text-brand-300">
                Documentação
              </a>
              <a href="#" className="transition-colors hover:text-brand-300">
                SLA de IA
              </a>
              <a href="#" className="transition-colors hover:text-brand-300">
                Suporte
              </a>
            </div>
          </div>
        </footer>
      </div>
    </HashRouter>
  );
};

export default App;
