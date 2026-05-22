import type { UserRole } from './workspaceRoles';

/**
 * Destino inicial após login ou `/` autenticado.
 * Prioridade: ADMIN → Torre; HUB → operação mobile; LINK; CLIENT.
 */
export function getDefaultHomePath(roles: readonly string[] | null | undefined): string {
    const r = roles ?? [];
    if (r.includes('ADMIN')) return '/gestao';
    if (r.includes('HUB')) return '/hub';
    if (r.includes('LINK')) return '/link';
    if (r.includes('CLIENT')) return '/client';
    return '/gestao';
}

const PATH_TO_ROLE: { prefix: string; role: UserRole }[] = [
    { prefix: '/gestao', role: 'ADMIN' },
    { prefix: '/app', role: 'ADMIN' },
    { prefix: '/hub', role: 'HUB' },
    { prefix: '/link', role: 'LINK' },
    { prefix: '/client', role: 'CLIENT' },
    { prefix: '/form/cotacao', role: 'CLIENT' },
    { prefix: '/form/coleta', role: 'CLIENT' },
];

/**
 * Papel ativo alinhado ao path de destino (ex.: login vai para /hub → HUB).
 */
export function syncRoleForPath(
    path: string,
    roles: readonly string[] | null | undefined
): UserRole | null {
    const r = (roles ?? []) as UserRole[];
    const base = path.split('?')[0].split('#')[0];
    for (const { prefix, role } of PATH_TO_ROLE) {
        if (base === prefix || base.startsWith(`${prefix}/`)) {
            if (r.includes(role)) return role;
            return null;
        }
    }
    return null;
}
