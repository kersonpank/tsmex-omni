import type { Prisma, UserRole } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { buildHubOrderVisibilityWhere } from '../lib/hubOrderAccess.js';

type PricingActor = { id: string; roles: UserRole[]; hubId?: string | null };

async function visibleHubClients(hubId: string): Promise<{ clientIds: string[]; accountIds: string[] }> {
    const demands = await prisma.demand.findMany({
        where: {
            clientId: { not: null },
            OR: [{ expectedHubId: hubId }, { order: { is: buildHubOrderVisibilityWhere(hubId) } }],
        },
        select: { clientId: true, client: { select: { accountId: true } } },
        distinct: ['clientId'],
    });
    return {
        clientIds: demands.flatMap((d) => d.clientId ? [d.clientId] : []),
        accountIds: [...new Set(demands.flatMap((d) => d.client?.accountId ? [d.client.accountId] : []))],
    };
}

export async function visibleClientIdsForHub(hubId: string): Promise<string[]> {
    return (await visibleHubClients(hubId)).clientIds;
}

/** Commercial prices are visible only to the owning account or the hub handling its cargo. */
export async function pricingVisibilityWhere(user: PricingActor, options?: { includeGeneralForCalculation?: boolean }): Promise<Prisma.PricingTableWhereInput> {
    if (user.roles.includes('ADMIN')) return {};
    let clientIds: string[] = [];
    let accountIds: string[] = [];
    if (user.roles.includes('HUB')) {
        if (!user.hubId) throw new AppError('Unidade não vinculada ao usuário.', 403);
        ({ clientIds, accountIds } = await visibleHubClients(user.hubId));
    } else if (user.roles.includes('CLIENT')) {
        const account = await prisma.user.findUnique({ where: { id: user.id }, select: { accountId: true } });
        if (!account?.accountId) throw new AppError('Conta não vinculada ao usuário.', 403);
        accountIds = [account.accountId];
    } else {
        throw new AppError('Acesso não autorizado a tabelas comerciais.', 403);
    }
    if (user.roles.includes('CLIENT') && !user.roles.includes('HUB') && !options?.includeGeneralForCalculation) {
        return {
            AND: [
                { OR: [{ accountId: { in: accountIds } }, { client: { accountId: { in: accountIds } } }] },
                { OR: [{ accountId: null }, { accountId: { in: accountIds } }] },
            ],
        };
    }
    return {
        AND: [
            { OR: [{ clientId: null }, { clientId: { in: clientIds } }, { client: { accountId: { in: accountIds } } }] },
            { OR: [{ accountId: null }, { accountId: { in: accountIds } }] },
        ],
    };
}

export async function assertClientPricingAccess(user: PricingActor, clientId: string): Promise<void> {
    if (user.roles.includes('ADMIN')) return;
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountId: true } });
    if (!client) throw new AppError('Cliente não encontrado.', 404);
    if (user.roles.includes('HUB') && user.hubId) {
        const visible = await visibleHubClients(user.hubId);
        if (visible.clientIds.includes(clientId) || (client.accountId && visible.accountIds.includes(client.accountId))) return;
    } else if (user.roles.includes('CLIENT')) {
        const account = await prisma.user.findUnique({ where: { id: user.id }, select: { accountId: true } });
        if (account?.accountId && account.accountId === client.accountId) return;
    }
    throw new AppError('Cliente não encontrado.', 404);
}
