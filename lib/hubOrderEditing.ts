const ORDER_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HubPermissionUser = {
  roles?: string[];
  permissions?: string[];
  profile?: {
    hub?: {
      permissions?: string[];
    };
  };
} | null | undefined;

export function getHubPermissions(user: HubPermissionUser): string[] {
  return user?.profile?.hub?.permissions ?? user?.permissions ?? [];
}

export function canEditHubOrder(user: HubPermissionUser): boolean {
  const roles = user?.roles ?? [];
  if (roles.includes('ADMIN')) return true;
  if (!roles.includes('HUB')) return false;
  const permissions = getHubPermissions(user);
  return permissions.length === 0 || permissions.includes('entrada');
}

export function hubOrderEditPath(orderId: string): string {
  const search = new URLSearchParams({
    tab: 'pedidos',
    mode: 'edit',
    orderId,
  });
  return `/hub?${search.toString()}`;
}

export function parseHubOrderEditId(search: URLSearchParams): string | null {
  if (search.get('tab') !== 'pedidos' || search.get('mode') !== 'edit') return null;
  const orderId = search.get('orderId');
  return orderId && ORDER_ID_UUID.test(orderId) ? orderId : null;
}

export function isSafeAppPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}
