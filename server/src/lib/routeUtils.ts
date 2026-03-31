// Utility types for Express route handlers
// Fixes req.params typing issues

export function getParamId(params: Record<string, string | string[] | undefined>): string {
    const id = params.id;
    if (typeof id !== 'string') {
        throw new Error('Invalid ID parameter');
    }
    return id;
}

export function getParamString(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
    const value = params[key];
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}

export function getQueryString(query: Record<string, unknown>, key: string): string | undefined {
    const value = query[key];
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
    }
    return undefined;
}

export function getQueryNumber(query: Record<string, unknown>, key: string): number | undefined {
    const str = getQueryString(query, key);
    if (str === undefined) return undefined;
    const num = parseInt(str, 10);
    return isNaN(num) ? undefined : num;
}
