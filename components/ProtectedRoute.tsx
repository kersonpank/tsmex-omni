import React, { useLayoutEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import type { UserRole } from '../lib/workspaceRoles';
import { getMatchingRolesForRoute } from '../lib/workspaceRoles';

interface ProtectedRouteProps {
    children: React.ReactNode;
    allowedRoles?: UserRole[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
    const location = useLocation();
    const { isAuthenticated, user, currentRole, setCurrentRole } = useAuthStore();

    const userRoles = (user?.roles ?? []) as UserRole[];
    const effectiveRole =
        currentRole && userRoles.includes(currentRole) ? currentRole : userRoles[0] ?? null;

    const matchingRoles = getMatchingRolesForRoute(userRoles, allowedRoles);
    const roleAllowedForRoute =
        !allowedRoles?.length || (effectiveRole != null && allowedRoles.includes(effectiveRole));
    const needsWorkspaceChoice =
        Boolean(allowedRoles?.length && !roleAllowedForRoute && matchingRoles.length > 0);
    const autoSwitchRole =
        needsWorkspaceChoice && userRoles.length === 1 && matchingRoles.length === 1
            ? matchingRoles[0]
            : null;

    useLayoutEffect(() => {
        if (autoSwitchRole && currentRole !== autoSwitchRole) {
            setCurrentRole(autoSwitchRole);
        }
    }, [autoSwitchRole, currentRole, setCurrentRole]);

    if (!isAuthenticated) {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }

    if (allowedRoles?.length && matchingRoles.length === 0) {
        const search = new URLSearchParams({ forbidden: '1' });
        return <Navigate to={`/escolher-painel?${search.toString()}`} replace />;
    }

    if (needsWorkspaceChoice && userRoles.length > 1) {
        const search = new URLSearchParams({ returnTo: location.pathname });
        return <Navigate to={`/escolher-painel?${search.toString()}`} replace />;
    }

    if (autoSwitchRole && currentRole !== autoSwitchRole) {
        return null;
    }

    return <>{children}</>;
};

export default ProtectedRoute;
