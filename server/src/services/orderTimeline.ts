import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Dados enxutos da linha do tempo do pedido (TSM O.S.): histórico com o nome de quem fez, trechos
 * (OrderLeg) com a viagem resumida e tentativas de entrega. A tradução para linguagem de operação
 * fica no cliente (components/os/lib/timeline.ts) — aqui só dado, sem texto de tela.
 */

export type TimelineHistoryRow = {
    id: string; eventType: string; description: string; location: string | null; photoUrl: string | null; createdAt: Date; actorName: string | null;
};

export function actorLabel(user: { email: string; person?: { legalName: string } | null } | null | undefined): string | null {
    if (!user) return null;
    return user.person?.legalName?.trim() || user.email.split('@')[0] || null;
}

export async function loadOrderTimeline(orderId: string) {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true, status: true, enteredAtHubAt: true, currentHub: { select: { id: true, name: true } },
            demand: { select: { orderNumber: true, origin: true, destination: true } },
            history: { orderBy: { createdAt: 'desc' }, select: { id: true, eventType: true, description: true, location: true, photoUrl: true, createdAt: true, actorUserId: true } },
            legs: {
                orderBy: { sequence: 'asc' },
                select: {
                    id: true, legType: true, sequence: true, startedAt: true, completedAt: true,
                    originHubId: true, destHubId: true,
                    manifest: {
                        select: {
                            id: true, status: true, origin: true, destination: true, plannedDepartureAt: true, plannedArrivalAt: true,
                            arrivedAt: true, hub: { select: { name: true } }, destHub: { select: { name: true } },
                        },
                    },
                },
            },
            deliveryAttempts: { orderBy: { occurredAt: 'desc' }, select: { id: true, result: true, receiverName: true, occurredAt: true, nextAction: true, exceptionReason: true } },
        },
    });
    if (!order) throw new AppError('Pedido não encontrado.', 404);

    const actorIds = [...new Set(order.history.map((row) => row.actorUserId).filter((id): id is string => Boolean(id)))];
    const users = actorIds.length
        ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, person: { select: { legalName: true } } } })
        : [];
    const names = new Map(users.map((user) => [user.id, actorLabel(user)]));
    const history: TimelineHistoryRow[] = order.history.map(({ actorUserId, ...row }) => ({ ...row, actorName: actorUserId ? names.get(actorUserId) ?? null : null }));

    return {
        order: { id: order.id, status: order.status, enteredAtHubAt: order.enteredAtHubAt, currentHub: order.currentHub, orderNumber: order.demand?.orderNumber ?? null, origin: order.demand?.origin ?? null, destination: order.demand?.destination ?? null },
        history,
        legs: order.legs,
        attempts: order.deliveryAttempts,
    };
}
