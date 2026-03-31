import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
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
import Unauthorized from './components/Unauthorized';
import OperacaoApp from './components/operacao/OperacaoApp';
import OperacaoOnboarding from './components/operacao/OperacaoOnboarding';
import HubCadastro from './components/HubCadastro';
import ThemeToggle from './components/ui/ThemeToggle';

const OperacaoRedirect: React.FC = () => {
  const { user, currentRole } = useAuthStore();
  const role = currentRole && user?.roles?.includes(currentRole) ? currentRole : user?.roles?.[0];
  if (role === 'LINK') return <Navigate to="/link" replace />;
  return <Navigate to="/gestao" replace />;
};

const Navigation: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAuthenticated, currentRole, setCurrentRole } = useAuthStore();
  const role = currentRole && user?.roles?.includes(currentRole) ? currentRole : user?.roles?.[0];
  const hasMultipleRoles = (user?.roles?.length ?? 0) > 1;
  const roleLabels: Record<string, string> = { ADMIN: 'Admin', CLIENT: 'Cliente', LINK: 'Link', HUB: 'Hub' };

  const handleRoleSwitch = (r: string) => {
    setCurrentRole(r as 'ADMIN' | 'CLIENT' | 'LINK' | 'HUB');
    setMobileOpen(false);
    if (r === 'CLIENT') navigate('/client');
    else if (r === 'LINK') navigate('/link');
    else if (r === 'ADMIN' || r === 'HUB') navigate('/gestao');
  };
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLogin = location.pathname === '/login';

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (isLogin || location.pathname === '/link/cadastro' || location.pathname === '/hub/cadastro') return null;

  const navLinks = (
    <>
      {(role === 'ADMIN' || role === 'HUB') && (
        <Link to="/gestao" className="text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors" onClick={() => setMobileOpen(false)}>
          {role === 'HUB' ? 'Operação' : 'Torre de Controle'}
        </Link>
      )}
      {role === 'CLIENT' && (
        <Link to="/client" className="text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors" onClick={() => setMobileOpen(false)}>
          Dashboard
        </Link>
      )}
      {role === 'LINK' && (
        <Link to="/link" className="text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors" onClick={() => setMobileOpen(false)}>
          Minha Carga
        </Link>
      )}
      <Link to="/chat/demo" className="text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors" onClick={() => setMobileOpen(false)}>
        Minhas Demandas
      </Link>
      {role === 'CLIENT' && (
        <>
          <Link to="/form/cotacao" className="text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors" onClick={() => setMobileOpen(false)}>
            Cotação
          </Link>
          <Link to="/form/coleta" className="text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors" onClick={() => setMobileOpen(false)}>
            Coleta
          </Link>
        </>
      )}
    </>
  );

  return (
    <nav className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xl">TSM</span>
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              EX OMNI
            </span>
          </div>

          <div className="hidden md:flex items-center space-x-8">
            {isAuthenticated && (
              <>
                {navLinks}
                <div className="flex items-center gap-4 border-l border-slate-200 dark:border-slate-600 pl-4">
                  <ThemeToggle />
                  {hasMultipleRoles && (
                    <div className="relative group">
                      <button className="px-3 py-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/40 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/60">
                        Ver como {roleLabels[role ?? ''] ?? role}
                      </button>
                      <div className="absolute right-0 mt-1 py-1 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 min-w-[140px]">
                        {user?.roles?.map((r) => (
                          <button
                            key={r}
                            onClick={() => handleRoleSwitch(r)}
                            className={`block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${r === role ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-slate-700 dark:text-slate-300'}`}
                          >
                            {roleLabels[r] ?? r}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-sm">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{user?.email}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{roleLabels[role ?? ''] ?? role ?? '—'}</div>
                  </div>
                  <button
                    onClick={logout}
                    className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  >
                    Sair
                  </button>
                </div>
              </>
            )}
          </div>

          {isAuthenticated && (
            <div className="flex md:hidden items-center gap-2">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => setMobileOpen((o) => !o)}
                className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
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
          <div className="md:hidden border-t border-slate-200 dark:border-slate-700 py-4 space-y-1">
            <div className="flex flex-col gap-1">
              {(role === 'ADMIN' || role === 'HUB') && (
                <Link to="/gestao" className="px-3 py-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium" onClick={() => setMobileOpen(false)}>
                  {role === 'HUB' ? 'Operação' : 'Torre de Controle'}
                </Link>
              )}
              {role === 'CLIENT' && (
                <Link to="/client" className="px-3 py-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium" onClick={() => setMobileOpen(false)}>
                  Dashboard
                </Link>
              )}
              {role === 'LINK' && (
                <Link to="/link" className="px-3 py-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium" onClick={() => setMobileOpen(false)}>
                  Minha Carga
                </Link>
              )}
              <Link to="/chat/demo" className="px-3 py-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium" onClick={() => setMobileOpen(false)}>
                Minhas Demandas
              </Link>
              {role === 'CLIENT' && (
                <>
                  <Link to="/form/cotacao" className="px-3 py-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium" onClick={() => setMobileOpen(false)}>
                    Cotação
                  </Link>
                  <Link to="/form/coleta" className="px-3 py-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium" onClick={() => setMobileOpen(false)}>
                    Coleta
                  </Link>
                </>
              )}
            </div>
            {hasMultipleRoles && (
              <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Trocar painel</div>
                <div className="flex flex-wrap gap-1">
                  {user?.roles?.map((r) => (
                    <button
                      key={r}
                      onClick={() => handleRoleSwitch(r)}
                      className={`px-3 py-1.5 text-sm rounded-lg ${r === role ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-medium' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'}`}
                    >
                      {roleLabels[r] ?? r}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 px-3">
              <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">{user?.email}</div>
              <button
                onClick={() => { setMobileOpen(false); logout(); }}
                className="w-full text-left px-3 py-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 font-medium"
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

const App: React.FC = () => {
  const { isAuthenticated, user, currentRole } = useAuthStore();
  const role = currentRole && user?.roles?.includes(currentRole) ? currentRole : user?.roles?.[0];

  return (
    <HashRouter>
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
        <Navigation />
        <main className="flex-grow">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/onboarding" element={<CompanyOnboarding />} />
            <Route path="/app" element={<Navigate to="/gestao" replace />} />
            <Route path="/gestao" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'HUB']}>
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
            <Route path="/unauthorized" element={<Unauthorized />} />
            <Route path="/chat/:slug" element={<ChatWeb />} />
            <Route path="/tracking/:id" element={<TrackingView />} />
            <Route path="/link/cadastro" element={<OperacaoOnboarding />} />
            <Route path="/hub/cadastro" element={<HubCadastro />} />
            <Route path="/link" element={
              <ProtectedRoute allowedRoles={['LINK']}>
                <OperacaoApp />
              </ProtectedRoute>
            } />
            <Route path="/operacao" element={<OperacaoRedirect />} />
            <Route path="/operacao/cadastro" element={<Navigate to="/link/cadastro" replace />} />
            <Route path="/" element={
              isAuthenticated ? (
                role === 'CLIENT'
                  ? <Navigate to="/client" replace />
                  : role === 'LINK'
                    ? <Navigate to="/link" replace />
                    : (role === 'ADMIN' || role === 'HUB')
                      ? <Navigate to="/gestao" replace />
                      : <Navigate to="/gestao" replace />
              ) : <Navigate to="/login" replace />
            } />
          </Routes>
        </main>

        <footer className="bg-slate-900 dark:bg-slate-950 text-slate-500 dark:text-slate-400 py-8 px-4 mt-auto">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-medium uppercase tracking-widest">
            <div>TSM EX • Sistema Conectado ao Backend</div>
            <div className="flex gap-6">
              <a href="#" className="hover:text-white transition-colors">Documentação</a>
              <a href="#" className="hover:text-white transition-colors">SLA de IA</a>
              <a href="#" className="hover:text-white transition-colors">Suporte</a>
            </div>
          </div>
        </footer>
      </div>
    </HashRouter>
  );
};

export default App;
