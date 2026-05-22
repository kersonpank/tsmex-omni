import React, { useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import {
  getWorkspacesForRoles,
  resolveReturnToForRole,
  type UserRole,
} from '../lib/workspaceRoles';
import { getDefaultHomePath } from '../lib/postLoginDefaultPath';

function WorkspaceIcon({ role }: { role: UserRole }) {
  const className = 'h-7 w-7 text-brand-600 dark:text-brand-300';
  if (role === 'CLIENT') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4l-8 4M4 7l8 4M4 7v10l8 4m0-14v10m0 0l8-4m-8 4L4 17" />
      </svg>
    );
  }
  if (role === 'HUB') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
      </svg>
    );
  }
  if (role === 'ADMIN') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16M8 19v-6m4 6V9m4 10v-3" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" d="M8 17h8M5 11h14l-1-5H6l-1 5zM6 17a2 2 0 104 0M14 17a2 2 0 104 0" />
    </svg>
  );
}

const WorkspacePicker: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, currentRole, enterWorkspace, logout, isAuthenticated } = useAuthStore();

  const forbidden = searchParams.get('forbidden') === '1';
  const returnTo = searchParams.get('returnTo');
  const userRoles = (user?.roles ?? []) as UserRole[];
  const workspaces = getWorkspacesForRoles(userRoles);
  const activeRole =
    currentRole && userRoles.includes(currentRole) ? currentRole : userRoles[0] ?? null;

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }
    if (userRoles.length === 1 && !forbidden) {
      const role = userRoles[0];
      enterWorkspace(role);
      const dest = resolveReturnToForRole(returnTo, role);
      navigate(dest, { replace: true });
    }
  }, [isAuthenticated, userRoles, forbidden, returnTo, navigate, enterWorkspace]);

  const handleSelect = (role: UserRole) => {
    enterWorkspace(role);
    const dest = resolveReturnToForRole(returnTo, role);
    navigate(dest, { replace: true });
  };

  if (!isAuthenticated) {
    return null;
  }

  if (userRoles.length === 1 && !forbidden) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4">
        <p className="text-sm text-tower-500 dark:text-tower-400">Redirecionando…</p>
      </div>
    );
  }

  if (forbidden || workspaces.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <h1 className="mb-2 font-display text-2xl font-bold text-tower-900 dark:text-tower-50">
            Sem permissão para esta área
          </h1>
          <p className="mb-8 text-tower-600 dark:text-tower-300">
            Sua conta não tem acesso a este recurso. Fale com o suporte se acredita que isso é um erro.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to={getDefaultHomePath(userRoles)}
              className="rounded-xl bg-brand-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-500"
            >
              Ir ao início
            </Link>
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-xl bg-tower-200 px-5 py-2.5 font-medium text-tower-800 transition-colors hover:bg-tower-300 dark:bg-tower-700 dark:text-tower-100"
            >
              Sair
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <header className="mb-8 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-300">
            TSM EX OMNI
          </p>
          <h1 className="font-display text-2xl font-bold text-tower-900 dark:text-tower-50 sm:text-3xl">
            Qual painel você quer usar agora?
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-tower-600 dark:text-tower-300">
            Sua conta tem acesso a mais de um ambiente. Escolha onde quer trabalhar.
          </p>
        </header>

        <ul
          className="grid gap-4 sm:grid-cols-2 workspace-picker-enter"
          role="list"
        >
          {workspaces.map((ws) => {
            const isActive = ws.role === activeRole;
            return (
              <li key={ws.role}>
                <button
                  type="button"
                  onClick={() => handleSelect(ws.role)}
                  aria-current={isActive ? 'true' : undefined}
                  className="group admin-focus flex w-full cursor-pointer flex-col rounded-2xl border border-tower-200 bg-white p-5 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-brand-400 hover:shadow-md dark:border-tower-700 dark:bg-tower-900/80 dark:hover:border-brand-500/60"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 dark:bg-brand-500/15">
                      <WorkspaceIcon role={ws.role} />
                    </span>
                    <svg
                      className="mt-1 h-5 w-5 shrink-0 text-tower-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-600 dark:group-hover:text-brand-300"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      aria-hidden
                    >
                      <path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <span className="font-display text-lg font-bold text-tower-900 dark:text-tower-50">
                    {ws.title}
                  </span>
                  <span className="mt-1 text-sm leading-relaxed text-tower-600 dark:text-tower-400">
                    {ws.description}
                  </span>
                  {isActive && (
                    <span className="mt-3 inline-flex w-fit rounded-full bg-brand-500/12 px-2.5 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-500/20 dark:text-brand-200">
                      Painel em uso
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-8 text-center text-sm text-tower-500 dark:text-tower-400">
          Você pode trocar de painel a qualquer momento pelo menu{' '}
          <span className="font-medium text-tower-700 dark:text-tower-200">Trocar painel</span>.
        </p>
      </div>

      <style>{`
        @keyframes workspacePickerEnter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .workspace-picker-enter > li {
          animation: workspacePickerEnter 0.22s ease-out both;
        }
        .workspace-picker-enter > li:nth-child(2) { animation-delay: 0.04s; }
        .workspace-picker-enter > li:nth-child(3) { animation-delay: 0.08s; }
        .workspace-picker-enter > li:nth-child(4) { animation-delay: 0.12s; }
        @media (prefers-reduced-motion: reduce) {
          .workspace-picker-enter > li {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
};

export default WorkspacePicker;
