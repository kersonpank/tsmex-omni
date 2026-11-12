import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Etapa 1 do recebimento (NORTE #26): "a carreta chegou". Registra quem e quando o veículo chegou ao
 * hub de destino ANTES da conferência. Não muda o status dos pedidos (seguem em trânsito até a
 * conferência) — só deixa rastro no histórico de cada pedido que desce ali.
 */

export type ArrivalActor = { userId: string; roles: string[]; hubId: string | null };

type LegLike = { orderId: string; legType: string; destHubId: string | null; stopId: string | null; completedAt: Date | null };

/** Pedidos que descem no hub de chegada: transferências abertas da parada (ou do destino da viagem). */
export function orderIdsDescendingAt(legs: LegLike[], target: { hubId: string; stopId: string | null; manifestDestHubId: string | null }): string[] {
    const ids = legs
        .filter((leg) => leg.legType !== 'ENTREGA' && !leg.completedAt)
        .filter((leg) => (target.stopId ? leg.stopId === target.stopId : (leg.destHubId ?? target.manifestDestHubId) === target.hubId))
        .map((leg) => leg.orderId);
    return [...new Set(ids)];
}

export function arrivalHistoryText(hubName: string): string {
    return `Veículo chegou em ${hubName}. Aguardando conferência.`;
}

export type ArrivalResult = { arrivedAt: Date; alreadyArrived: boolean; ordersNotified: number; hubName: string; stopId: string | null };

export async function registerManifestArrival(manifestId: string, stopId: string | null, actor: ArrivalActor): Promise<ArrivalResult> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            destHub: { select: { id: true, name: true } },
            tripStops: { orderBy: { sequence: 'asc' }, include: { destHub: { select: { id: true, name: true } } } },
            legs: { select: { orderId: true, legType: true, destHubId: true, stopId: true, completedAt: true } },
        },
    });
    if (!manifest) throw new AppError('Viagem não encontrada.', 404);
    if (manifest.status !== 'IN_PROGRESS') throw new AppError('A chegada só se registra com a viagem em rota.', 409);

    const isAdmin = actor.roles.includes('ADMIN');
    const hubStops = manifest.tripStops.filter((stop) => stop.destHubId && !stop.completedAt);
    let stop = stopId ? manifest.tripStops.find((candidate) => candidate.id === stopId) ?? null : null;
    if (stopId && !stop) throw new AppError('Parada não encontrada nesta viagem.', 404);
    if (!stop && manifest.tripStops.some((candidate) => candidate.destHubId)) {
        // Viagem com paradas em hubs: o hub que chega usa a parada dele; ADMIN precisa dizer qual.
        stop = actor.hubId ? hubStops.find((candidate) => candidate.destHubId === actor.hubId) ?? null : null;
        if (!stop) throw new AppError('Informe a parada em que a carreta chegou.', 400);
    }

    const hub = stop ? stop.destHub : manifest.destHub;
    if (!hub) throw new AppError('Esta parada é entrega ao cliente: não há hub de chegada.', 400);
    if (stop?.completedAt) throw new AppError('Esta parada já foi concluída.', 409);
    if (!isAdmin && (!actor.hubId || actor.hubId !== hub.id)) throw new AppError('Not authorized — a chegada é registrada pelo hub de destino.', 403);

    const existing = stop ?? manifest;
    if (existing.arrivedAt) {
        return { arrivedAt: existing.arrivedAt, alreadyArrived: true, ordersNotified: 0, hubName: hub.name, stopId: stop?.id ?? null };
    }

    const now = new Date();
    const orderIds = orderIdsDescendingAt(manifest.legs, { hubId: hub.id, stopId: stop?.id ?? null, manifestDestHubId: manifest.destHubId });
    await prisma.$transaction(async (tx) => {
        const data = { arrivedAt: now, arrivedByUserId: actor.userId };
        if (stop) await tx.manifestStop.update({ where: { id: stop.id }, data });
        else await tx.manifest.update({ where: { id: manifest.id }, data });
        if (orderIds.length) {
            await tx.orderHistory.createMany({
                data: orderIds.map((orderId) => ({
                    orderId, eventType: 'NOTE' as const, description: arrivalHistoryText(hub.name), location: hub.name, actorUserId: actor.userId,
                })),
            });
        }
    });
    return { arrivedAt: now, alreadyArrived: false, ordersNotified: orderIds.length, hubName: hub.name, stopId: stop?.id ?? null };
}
