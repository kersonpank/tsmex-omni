import React, { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../../store/authStore';
import { useLayoutStore } from '../../../store/layoutStore';
import { buildAdminNavSections, getNavStateForSystemMenu, navigateToNavState } from './adminNavModel';
import type { AdminNavState } from './adminQuery';
import AdminNavRails from './AdminNavRails';

const EXCLUDED = new Set(['/login', '/gestao', '/hub', '/onboarding', '/unauthorized', '/link/cadastro', '/hub/cadastro', '/app']);

export function shouldShowGlobalSystemMenu(pathname: string): boolean {
  if (EXCLUDED.has(pathname)) return false;
  if (pathname.startsWith('/form/')) return false;
  return true;
}

const GlobalSystemMenu: React.FC = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, currentRole } = useAuthStore();
  const effectiveRole =
    currentRole && user?.roles?.includes(currentRole) ? currentRole : user?.roles?.[0];
  const isHub = user?.roles?.includes('HUB') ?? false;
  const isAdmin = user?.roles?.includes('ADMIN') ?? false;
  const hubPermissions =
    (user?.profile as { hub?: { permissions?: string[] } })?.hub?.permissions ?? (user as { permissions?: string[] })?.permissions ?? [];
  const hasPermission = useCallback(
    (p: string) => !isHub || hubPermissions.length === 0 || hubPermissions.includes(p),
    [isHub, hubPermissions]
  );

  const setSidebarDrawerOpen = useLayoutStore((s) => s.setSidebarDrawerOpen);
  const onOrderDetail = location.pathname.startsWith('/orders/');
  const navState = useMemo(
    () => getNavStateForSystemMenu(new URLSearchParams(searchParams.toString()), location.pathname, isHub, hasPermission),
    [searchParams, location.pathname, isHub, hasPermission]
  );

  const navSections = useMemo(
    () =>
      buildAdminNavSections({
        navState,
        isHub,
        hasPermission,
        onOrderDetailPage: onOrderDetail,
        onSelectNav: (patch: Partial<AdminNavState>) => {
          setSidebarDrawerOpen(false);
          navigateToNavState(patch, navState, isHub, (to) => {
            void navigate(to);
          });
        },
      }),
    [navState, isHub, hasPermission, onOrderDetail, navigate, setSidebarDrawerOpen]
  );

  const show = effectiveRole === 'ADMIN' && shouldShowGlobalSystemMenu(location.pathname);
  if (!show) return null;

  return <AdminNavRails navSections={navSections} layout="global" showDesktopPanel />;
};

export default GlobalSystemMenu;
