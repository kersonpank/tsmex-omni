export type UserRole = 'ADMIN' | 'CLIENT' | 'LINK' | 'HUB';

export type WorkspaceOption = {
  role: UserRole;
  path: string;
  title: string;
  description: string;
  shortLabel: string;
};

const ROLE_ORDER: UserRole[] = ['ADMIN', 'HUB', 'LINK', 'CLIENT'];

export const WORKSPACE_BY_ROLE: Record<UserRole, WorkspaceOption> = {
  ADMIN: {
    role: 'ADMIN',
    path: '/gestao',
    title: 'Torre de Controle',
    description: 'Gestão da rede, manifestos e operação administrativa',
    shortLabel: 'Admin',
  },
  HUB: {
    role: 'HUB',
    path: '/hub',
    title: 'Operação Hub',
    description: 'Entrada, triagem e emissão no centro de distribuição',
    shortLabel: 'Hub',
  },
  LINK: {
    role: 'LINK',
    path: '/link',
    title: 'Painel do Link',
    description: 'Manifestos aceitos e execução de rotas',
    shortLabel: 'Link',
  },
  CLIENT: {
    role: 'CLIENT',
    path: '/client',
    title: 'Painel do cliente',
    description: 'Cotações, coletas e acompanhamento de cargas',
    shortLabel: 'Cliente',
  },
};

export function getWorkspacePath(role: UserRole): string {
  return WORKSPACE_BY_ROLE[role].path;
}

export function getWorkspacesForRoles(roles: readonly UserRole[]): WorkspaceOption[] {
  const set = new Set(roles);
  return ROLE_ORDER.filter((r) => set.has(r)).map((r) => WORKSPACE_BY_ROLE[r]);
}

/** Papéis do usuário que podem acessar a rota. */
export function getMatchingRolesForRoute(
  userRoles: readonly UserRole[],
  allowedRoles: readonly UserRole[] | undefined
): UserRole[] {
  if (!allowedRoles?.length) return [...userRoles];
  const allowed = new Set(allowedRoles);
  return userRoles.filter((r) => allowed.has(r));
}

const PATH_ROLE_HINTS: { prefix: string; role: UserRole }[] = [
  { prefix: '/gestao', role: 'ADMIN' },
  { prefix: '/app', role: 'ADMIN' },
  { prefix: '/hub', role: 'HUB' },
  { prefix: '/link', role: 'LINK' },
  { prefix: '/client', role: 'CLIENT' },
  { prefix: '/form/cotacao', role: 'CLIENT' },
  { prefix: '/form/coleta', role: 'CLIENT' },
];

/** Destino seguro após escolha de painel: só paths internos absolutos. */
export function sanitizeReturnTo(
  returnTo: string | null | undefined,
  fallbackPath: string
): string {
  if (!returnTo || typeof returnTo !== 'string') return fallbackPath;
  const trimmed = returnTo.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallbackPath;
  return trimmed.split('?')[0].split('#')[0] || fallbackPath;
}

/** returnTo válido apenas se o papel escolhido pode acessar essa rota (heurística por prefixo). */
export function resolveReturnToForRole(
  returnTo: string | null | undefined,
  role: UserRole
): string {
  const fallback = getWorkspacePath(role);
  const path = sanitizeReturnTo(returnTo, fallback);
  const hint = PATH_ROLE_HINTS.find((h) => path === h.prefix || path.startsWith(`${h.prefix}/`));
  if (!hint) return path;
  if (hint.role === role) return path;
  return fallback;
}

export function roleLabels(): Record<UserRole, string> {
  return {
    ADMIN: WORKSPACE_BY_ROLE.ADMIN.shortLabel,
    CLIENT: WORKSPACE_BY_ROLE.CLIENT.shortLabel,
    LINK: WORKSPACE_BY_ROLE.LINK.shortLabel,
    HUB: WORKSPACE_BY_ROLE.HUB.shortLabel,
  };
}
