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
