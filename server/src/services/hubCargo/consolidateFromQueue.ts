import type { UserRole } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { addOrderToManifest } from '../manifestLifecycle.js';
import { createManifestDraft } from '../manifestCreate.js';
import { deleteEmptyManifest } from '../manifestPlanningChanges.js';
import { getManifestMargin } from '../pricingService.js';
import { getConsolidationQueues } from './consolidationQueue.js';

/**
 * Consolidar a partir da fila de próximo salto (estação Consolidar, NORTE Etapa A4/B1).
 * O servidor recalcula a fila (nunca confia no que a tela mostrou), cria a viagem pelo
 * caminho único de criação, adiciona os pedidos pelo motor existente (capacidade,
 * elegibilidade, custo) e grava UM ConsolidationFeedback com sugerido × final.
 */

export function feedbackActionFor(suggested: string[], final: string[]): 'ACCEPTED' | 'MODIFIED' {
    const suggestedSet = new Set(suggested);
    const sameSize = new Set(final).size === suggestedSet.size;
    return sameSize && final.every((id) => suggestedSet.has(id)) ? 'ACCEPTED' : 'MODIFIED';
}

/** Pedidos escolhidos que não estão (mais) na fila sugerida. */
export function ordersOutsideQueue(suggested: string[], picked: string[]): string[] {
    const suggestedSet = new Set(suggested);
    return picked.filter((id) => !suggestedSet.has(id));
}

export interface ConsolidateFromQueueInput {
    hubId: string;
    groupKey: string;
    orderIds: string[];
    vehicleTypeId: string;
    actor: { userId: string; role: UserRole; adminId?: string };
}

export interface ConsolidateFromQueueResult {
    manifestId: string;
    added: string[];
    failed: Array<{ orderId: string; message: string }>;
}

export async function consolidateFromQueue(input: ConsolidateFromQueueInput): Promise<ConsolidateFromQueueResult> {
    const picked = [...new Set(input.orderIds)];
    if (picked.length === 0) throw new AppError('Escolha pelo menos um pedido da fila.', 400);

    const groups = await getConsolidationQueues(input.hubId);
    const group = groups.find((g) => g.key === input.groupKey);
    if (!group) throw new AppError('Esta fila mudou desde que foi aberta. Atualize e tente de novo.', 409);
    if (group.kind === 'UNROUTED') {
        throw new AppError('Pedidos sem rota definida: ajuste a cobertura antes de montar a viagem.', 400);
    }
    const suggested = group.orders.map((o) => o.orderId);
    const outside = ordersOutsideQueue(suggested, picked);
    if (outside.length > 0) {
        throw new AppError(`${outside.length} pedido(s) saíram desta fila. Atualize e tente de novo.`, 409);
    }

    const hub = await prisma.hub.findUnique({
        where: { id: input.hubId },
        select: { city: true, state: true, cityIbgeCode: true },
    });
    if (!hub) throw new AppError('Hub não encontrado.', 404);

    const isTransfer = group.kind === 'TRANSFER';
    const hubLabel = `${hub.city}, ${hub.state}`;
    const manifest = await createManifestDraft(
        {
            vehicleTypeId: input.vehicleTypeId,
            tripType: isTransfer ? 'TRANSFER' : 'DELIVERY',
            origin: hubLabel,
            destination: isTransfer ? group.destHubName ?? group.destHubCode ?? 'Hub destino' : hubLabel,
            ...(isTransfer
                ? { destHubId: group.destHubId ?? undefined }
                : {
                      destinationCity: hub.city,
                      destinationState: hub.state,
                      destinationCityIbgeCode: hub.cityIbgeCode ?? undefined,
                  }),
        },
        input.hubId,
    );

    const added: string[] = [];
    const failed: ConsolidateFromQueueResult['failed'] = [];
    for (const orderId of picked) {
        try {
            await addOrderToManifest(manifest.id, orderId, input.actor, undefined, { recordFeedback: false });
            added.push(orderId);
        } catch (error) {
            failed.push({
                orderId,
                message: error instanceof AppError ? error.message : 'Não foi possível adicionar o pedido.',
            });
        }
    }

    if (added.length === 0) {
        await deleteEmptyManifest(manifest.id);
        throw new AppError(failed[0]?.message ?? 'Nenhum pedido pôde entrar na viagem.', 422);
    }

    const final = await prisma.manifest.findUniqueOrThrow({
        where: { id: manifest.id },
        include: { vehicleType: true },
    });
    const margin = await getManifestMargin(manifest.id);
    await prisma.consolidationFeedback.create({
        data: {
            adminId: input.actor.adminId ?? null,
            actorUserId: input.actor.userId,
            actorRole: input.actor.role,
            action: feedbackActionFor(suggested, added),
            orderIds: added,
            suggestedManifests: [
                { source: 'next_hop_queue', queueKey: group.key, kind: group.kind, destHubId: group.destHubId, orderIds: suggested },
            ],
            finalManifests: [
                { manifestId: manifest.id, vehicleTypeId: input.vehicleTypeId, orderIds: added, failedOrderIds: failed.map((f) => f.orderId) },
            ],
            utilizationBefore: 0,
            utilizationAfter: final.vehicleType.maxWeight > 0 ? final.totalWeight / final.vehicleType.maxWeight : null,
            marginBefore: null,
            marginAfter: margin.margin !== null && margin.revenue > 0 ? margin.margin / margin.revenue : null,
        },
    });

    return { manifestId: manifest.id, added, failed };
}
