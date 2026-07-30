export function hasOperationalPermission(
    roles: readonly string[],
    permissions: readonly string[] | undefined,
    permission: string,
): boolean {
    if (roles.includes('ADMIN')) return true;
    if (!roles.includes('HUB')) return false;
    const values = permissions ?? [];
    return values.length === 0 || values.includes(permission);
}
