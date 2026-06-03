import { Prisma, UserRole } from '@prisma/client';
import prisma from './prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';

/** Campos mínimos para decidir visibilidade de pedido ao operador HUB. */
export type HubOrderAccessFields = {
    currentHubId: string | null;
    demand?: { expectedHubId?: string | null } | null;
    legs?: Array<{
        manifest: {
            hubId: string | null;
            destHubId: string | null;
        } | null;
    }> | null;
};

/**
 * Pedido visível ao CD se estiver no hub, previsto para o hub, ou ligado a manifesto
 * originado/destinado neste hub via pernas de transporte.
 */
export function hubCanAccessOrder(hubId: string, order: HubOrderAccessFields): boolean {
    if (order.currentHubId === hubId) return true;
    if (order.demand?.expectedHubId === hubId) return true;
    if (order.legs?.some(leg => leg.manifest && (leg.manifest.hubId === hubId || leg.manifest.destHubId === hubId))) return true;
    return false;
}

export function buildHubOrderVisibilityWhere(hubId: string): Prisma.OrderWhereInput {
    return {
        OR: [
            { currentHubId: hubId },
            { demand: { expectedHubId: hubId } },
            {
                legs: {
                    some: {
                        manifest: {
                            OR: [
                                { hubId },
                                { destHubId: hubId }
                            ]
                        }
                    }
                }
            }
        ],
    };
}

/** Escopo LINK só quando o usuário não opera como HUB (evita 403 em conta HUB+LINK). */
export function shouldApplyLinkOrderScope(roles: UserRole[]): boolean {
    return roles.includes('LINK') && !roles.includes('HUB');
}

export function assertHubCanAccessOrder(req: AuthRequest, order: HubOrderAccessFields): void {
    if (!req.user!.hubId) {
        throw new AppError('Hub user has no hub assigned', 403);
    }
    if (!hubCanAccessOrder(req.user!.hubId, order)) {
        throw new AppError('Not authorized', 403);
    }
}

/** Mesma regra da listagem GET /orders — garante paridade listagem ↔ detalhe. */
export async function ensureHubOrderAccessById(req: AuthRequest, orderId: string): Promise<void> {
    if (!req.user!.hubId) {
        throw new AppError('Hub user has no hub assigned', 403);
    }
    const found = await prisma.order.findFirst({
        where: {
            id: orderId,
            AND: [buildHubOrderVisibilityWhere(req.user!.hubId)],
        },
        select: { id: true },
    });
    if (!found) {
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
    demand: {
        select: {
            expectedHubId: true,
        },
    },
    legs: {
        select: {
            manifest: {
                select: {
                    hubId: true,
                    destHubId: true,
                }
            }
        }
    }
} satisfies Prisma.OrderSelect;
