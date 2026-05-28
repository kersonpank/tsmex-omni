import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';

/** Campos mínimos para decidir visibilidade de pedido ao operador HUB. */
export type HubOrderAccessFields = {
    currentHubId: string | null;
    demand?: { expectedHubId?: string | null } | null;
    manifest?: { hubId?: string | null; destHubId?: string | null } | null;
};

/**
 * Pedido visível ao CD se estiver no hub, previsto para o hub, ou ligado a manifesto
 * originado/destinado neste hub (mesma regra de demands.ts, ampliada com destHub).
 */
export function hubCanAccessOrder(hubId: string, order: HubOrderAccessFields): boolean {
    if (order.currentHubId === hubId) return true;
    if (order.demand?.expectedHubId === hubId) return true;
    if (order.manifest?.hubId === hubId) return true;
    if (order.manifest?.destHubId === hubId) return true;
    return false;
}

export function buildHubOrderVisibilityWhere(hubId: string): Prisma.OrderWhereInput {
    return {
        OR: [
            { currentHubId: hubId },
            { demand: { expectedHubId: hubId } },
            { manifest: { hubId } },
            { manifest: { destHubId: hubId } },
        ],
    };
}

export function assertHubCanAccessOrder(req: AuthRequest, order: HubOrderAccessFields): void {
    if (!req.user!.hubId) {
        throw new AppError('Hub user has no hub assigned', 403);
    }
    if (!hubCanAccessOrder(req.user!.hubId, order)) {
        throw new AppError('Not authorized', 403);
    }
}

/** Aplica checagem HUB apenas quando o usuário tem papel HUB. */
export function checkHubAccessIfHubRole(req: AuthRequest, order: HubOrderAccessFields): void {
    if (req.user!.roles.includes('HUB')) {
        assertHubCanAccessOrder(req, order);
    }
}

export const hubOrderAccessSelect = {
    currentHubId: true,
    demand: { select: { expectedHubId: true } },
    manifest: { select: { hubId: true, destHubId: true, linkId: true } },
} satisfies Prisma.OrderSelect;
