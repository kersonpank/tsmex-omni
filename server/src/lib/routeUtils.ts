// Utility types for Express route handlers
// Fixes req.params typing issues

import prisma from './prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';

/**
 * Returns a Prisma `clientId` filter scoped to the authenticated CLIENT user's account.
 * Eliminates the duplicated user→account→clients pre-query pattern in orders, demands,
 * and invoices. accountId is already available from req.user (populated in auth.ts).
 */
export async function resolveClientScopeFilter(
    req: AuthRequest
): Promise<{ clientId: { in: string[] } } | Record<string, never>> {
    if (!req.user!.roles.includes('CLIENT')) return {};
    if (!req.user!.accountId) throw new AppError('Account not found', 404);
    const clients = await prisma.client.findMany({
        where: { accountId: req.user!.accountId },
        select: { id: true },
    });
    return { clientId: { in: clients.map((c) => c.id) } };
}

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
