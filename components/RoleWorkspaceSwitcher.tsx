import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, type UserRole } from '../store/authStore';
import { getWorkspacePath, getWorkspacesForRoles } from '../lib/workspaceRoles';

type RoleWorkspaceSwitcherProps = {
  variant: 'desktop' | 'mobile';
  onAfterSwitch?: () => void;
};

const RoleWorkspaceSwitcher: React.FC<RoleWorkspaceSwitcherProps> = ({
  variant,
  onAfterSwitch,
}) => {
  const navigate = useNavigate();
  const { user, currentRole, enterWorkspace } = useAuthStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const userRoles = (user?.roles ?? []) as UserRole[];
  const workspaces = getWorkspacesForRoles(userRoles);
  const activeRole =
    currentRole && userRoles.includes(currentRole) ? currentRole : userRoles[0] ?? null;
  const activeLabel = workspaces.find((w) => w.role === activeRole)?.shortLabel ?? activeRole;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (userRoles.length <= 1) return null;

  const switchTo = (role: UserRole) => {
    enterWorkspace(role);
    setOpen(false);
    onAfterSwitch?.();
    navigate(getWorkspacePath(role));
  };

  if (variant === 'mobile') {
    return (
      <div className="border-t border-tower-200 px-3 py-2 dark:border-tower-700">
        <div className="mb-2 text-xs text-tower-500 dark:text-tower-400">Trocar painel</div>
        <div className="flex flex-wrap gap-1">
          {workspaces.map((ws) => (
            <button
              key={ws.role}
              type="button"
              onClick={() => switchTo(ws.role)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                ws.role === activeRole
                  ? 'bg-brand-500/18 font-medium text-brand-900 dark:bg-brand-500/25 dark:text-brand-100'
                  : 'bg-tower-100 text-tower-600 dark:bg-tower-800 dark:text-tower-400'
              }`}
            >
              {ws.shortLabel}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            onAfterSwitch?.();
            navigate('/escolher-painel');
          }}
          className="admin-focus mt-2 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          Ver todos os painéis…
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="admin-focus rounded-lg bg-brand-500/12 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-500/20 dark:text-brand-200 dark:hover:bg-brand-500/25"
      >
        Trocar painel
        <span className="ml-1 text-brand-600/80 dark:text-brand-300/80">· {activeLabel}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-[200px] rounded-lg border border-tower-200 bg-white py-1 shadow-lg dark:border-tower-700 dark:bg-tower-900"
        >
          {workspaces.map((ws) => (
            <button
              key={ws.role}
              type="button"
              role="menuitem"
              onClick={() => switchTo(ws.role)}
              className={`admin-focus block w-full px-4 py-2 text-left text-sm hover:bg-tower-50 dark:hover:bg-tower-800 ${
                ws.role === activeRole
                  ? 'font-medium text-brand-700 dark:text-brand-300'
                  : 'text-tower-700 dark:text-tower-300'
              }`}
            >
              {ws.title}
            </button>
          ))}
          <div className="my-1 border-t border-tower-100 dark:border-tower-800" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAfterSwitch?.();
              navigate('/escolher-painel');
            }}
            className="admin-focus block w-full px-4 py-2 text-left text-sm text-tower-600 hover:bg-tower-50 dark:text-tower-400 dark:hover:bg-tower-800"
          >
            Ver todos os painéis…
          </button>
        </div>
      )}
    </div>
  );
};

export default RoleWorkspaceSwitcher;
