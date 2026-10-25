import type { UserRole } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { addOrderToManifest, validateDestHubForTransfer } from '../manifestLifecycle.js';
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

export function feedbackActionFor(suggested: string[], final: string[], routeChosen = false): 'ACCEPTED' | 'MODIFIED' {
    if (routeChosen) return 'MODIFIED';
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
    destHubId?: string;
    local?: true;
    actor: { userId: string; role: UserRole; adminId?: string };
}

export interface ConsolidateFromQueueResult {
    manifestId: string;
    added: string[];
    failed: Array<{ orderId: string; message: string }>;
}

interface ConsolidateFromQueueDeps {
    getQueues: typeof getConsolidationQueues;
    createDraft: typeof createManifestDraft;
    addOrder: typeof addOrderToManifest;
    deleteEmpty: typeof deleteEmptyManifest;
    getMargin: typeof getManifestMargin;
}

const defaultDeps: ConsolidateFromQueueDeps = {
    getQueues: getConsolidationQueues,
    createDraft: createManifestDraft,
    addOrder: addOrderToManifest,
    deleteEmpty: deleteEmptyManifest,
    getMargin: getManifestMargin,
};

/** Seleção manual da estação Cargas; a disponibilidade sempre vem da fila recalculada. */
export const STOCK_SELECTION_GROUP_KEY = 'stock-selection';

export async function consolidateFromQueue(
    input: ConsolidateFromQueueInput,
    deps: ConsolidateFromQueueDeps = defaultDeps,
): Promise<ConsolidateFromQueueResult> {
    const picked = [...new Set(input.orderIds)];
    if (picked.length === 0) throw new AppError('Escolha pelo menos um pedido da fila.', 400);

    const groups = await deps.getQueues(input.hubId);
    const stockSelection = input.groupKey === STOCK_SELECTION_GROUP_KEY;
    const group = groups.find((g) => g.key === input.groupKey);
    if (!stockSelection && !group) throw new AppError('Esta fila mudou desde que foi aberta. Atualize e tente de novo.', 409);
    const suggestedGroups = stockSelection
        ? groups.filter((g) => g.orders.some((o) => picked.includes(o.orderId)))
        : [group!];
    const suggested = suggestedGroups.flatMap((g) => g.orders.map((o) => o.orderId));
    const outside = ordersOutsideQueue(suggested, picked);
    if (outside.length > 0) {
        throw new AppError(`${outside.length} pedido(s) saíram desta fila. Atualize e tente de novo.`, 409);
    }

    const routeChosen = stockSelection || group?.kind === 'UNROUTED';
    if (routeChosen && ((!input.destHubId && !input.local) || (input.destHubId && input.local))) {
        throw new AppError('Escolha um hub destino ou entrega local para montar a viagem.', 400);
    }
    if (!routeChosen && (input.destHubId || input.local)) {
        throw new AppError('O destino desta fila já está definido. Atualize e tente de novo.', 400);
    }
    const chosenHub = routeChosen && input.destHubId
        ? await validateDestHubForTransfer(input.destHubId, input.hubId)
        : null;

    const hub = await prisma.hub.findUnique({
        where: { id: input.hubId },
        select: { city: true, state: true, cityIbgeCode: true },
    });
    if (!hub) throw new AppError('Hub não encontrado.', 404);

    const isTransfer = routeChosen ? Boolean(chosenHub) : group!.kind === 'TRANSFER';
    const destHubId = isTransfer ? chosenHub?.id ?? group?.destHubId ?? undefined : undefined;
    const hubLabel = `${hub.city}, ${hub.state}`;
    const manifest = await deps.createDraft(
        {
            vehicleTypeId: input.vehicleTypeId,
            tripType: isTransfer ? 'TRANSFER' : 'DELIVERY',
            origin: hubLabel,
            destination: isTransfer ? chosenHub?.name ?? group?.destHubName ?? group?.destHubCode ?? 'Hub destino' : hubLabel,
            ...(isTransfer
                ? { destHubId }
                : {}),
        },
        input.hubId,
        { allowIncompleteHubCity: true },
    );

    const added: string[] = [];
    const failed: ConsolidateFromQueueResult['failed'] = [];
    for (const orderId of picked) {
        try {
            await deps.addOrder(manifest.id, orderId, input.actor, undefined, { recordFeedback: false });
            added.push(orderId);
        } catch (error) {
            failed.push({
                orderId,
                message: error instanceof AppError ? error.message : 'Não foi possível adicionar o pedido.',
            });
        }
    }

    if (added.length === 0) {
        await deps.deleteEmpty(manifest.id);
        throw new AppError(failed[0]?.message ?? 'Nenhum pedido pôde entrar na viagem.', 422);
    }

    const final = await prisma.manifest.findUniqueOrThrow({
        where: { id: manifest.id },
        include: { vehicleType: true },
    });
    const margin = await deps.getMargin(manifest.id);
    await prisma.consolidationFeedback.create({
        data: {
            adminId: input.actor.adminId ?? null,
            actorUserId: input.actor.userId,
            actorRole: input.actor.role,
            action: feedbackActionFor(suggested, added, routeChosen),
            orderIds: added,
            suggestedManifests: suggestedGroups.map((g) => ({
                source: 'next_hop_queue', queueKey: g.key, kind: g.kind, destHubId: g.destHubId,
                orderIds: g.orders.map((o) => o.orderId),
            })),
            finalManifests: [
                {
                    manifestId: manifest.id, vehicleTypeId: input.vehicleTypeId, orderIds: added,
                    tripType: isTransfer ? 'TRANSFER' : 'DELIVERY', destHubId: destHubId ?? null, local: !isTransfer,
                    failedOrderIds: failed.map((f) => f.orderId),
                },
            ],
            utilizationBefore: 0,
            utilizationAfter: final.vehicleType.maxWeight > 0 ? final.totalWeight / final.vehicleType.maxWeight : null,
            marginBefore: null,
            marginAfter: margin.margin !== null && margin.revenue > 0 ? margin.margin / margin.revenue : null,
        },
    });

    return { manifestId: manifest.id, added, failed };
}
