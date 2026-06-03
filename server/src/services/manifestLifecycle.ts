import {
    DemandStatus,
    ManifestStatus,
    ManifestTripType,
    OrderEventType,
    OrderStatus,
    FeedbackAction,
    Prisma,
    UserRole,
} from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { getManifestMargin, allocateLegCosts } from './pricingService.js';

export const ACTIVE_MANIFEST_STATUSES: ManifestStatus[] = [
    'DRAFT',
    'PENDING_ACCEPT',
    'ACCEPTED',
    'IN_PROGRESS',
];

export const OPERATIONAL_TRIP_TYPES = ['TRANSFER', 'DELIVERY'] as const;
export type OperationalTripType = (typeof OPERATIONAL_TRIP_TYPES)[number];

export function assertOperationalTripType(tripType: ManifestTripType): OperationalTripType {
    if (tripType === 'TRANSFER' || tripType === 'DELIVERY') {
        return tripType;
    }
    throw new AppError('Tipo de viagem não suportado nesta versão', 400);
}

export type CreateManifestInput = {
    vehicleTypeId: string;
    origin: string;
    destination: string;
    tripType: OperationalTripType;
    hubId?: string;
    destHubId?: string;
    stops?: Prisma.InputJsonValue;
};

export async function validateDestHubForTransfer(destHubId: string, originHubId?: string | null) {
    const destHub = await prisma.hub.findUnique({ where: { id: destHubId } });
    if (!destHub || !destHub.active) {
        throw new AppError('Hub destino não encontrado ou inativo', 400);
    }
    if (originHubId && destHubId === originHubId) {
        throw new AppError('Hub destino não pode ser igual ao hub de origem', 400);
    }
    return destHub;
}

export async function validateCreateManifestInput(input: CreateManifestInput) {
    const vehicleType = await prisma.vehicleType.findUnique({
        where: { id: input.vehicleTypeId },
    });
    if (!vehicleType) {
        throw new AppError('Vehicle type not found', 404);
    }

    let destHub: { id: string; code: string } | null = null;
    if (input.tripType === 'TRANSFER') {
        if (!input.destHubId) {
            throw new AppError('destHubId é obrigatório para viagens do tipo TRANSFER', 400);
        }
        destHub = await validateDestHubForTransfer(input.destHubId, input.hubId ?? null);
    }

    return { vehicleType, destHub };
}

function orderEffectiveWeight(order: { demand: { weight: number; cubedWeight: number | null } }) {
    return Math.max(order.demand.weight, order.demand.cubedWeight ?? 0);
}

export async function assertOrderNotInOtherActiveManifest(
    orderId: string,
    exceptManifestId: string
) {
    const activeLeg = await prisma.orderLeg.findFirst({
        where: {
            orderId,
            manifestId: { not: exceptManifestId },
            manifest: {
                status: 'IN_PROGRESS',
            },
        },
    });
    if (activeLeg) {
        throw new AppError('Pedido já possui uma perna ativa em trânsito (manifesto em andamento)', 400);
    }
}

function allocationOrderHistoryDescription(
    manifestId: string,
    tripType: ManifestTripType,
    destHubCode?: string | null
) {
    if (tripType === 'DELIVERY') {
        return `Pedido alocado ao manifesto ${manifestId} para entrega final.`;
    }
    const hubLabel = destHubCode ?? 'destino';
    return `Pedido alocado ao manifesto ${manifestId} para transferência ao hub ${hubLabel}.`;
}

export async function addOrderToManifest(
    manifestId: string,
    orderId: string,
    actor: { userId: string; role: UserRole; adminId?: string }
) {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: { vehicleType: true, destHub: { select: { code: true } } },
    });

    if (!manifest) {
        throw new AppError('Manifest not found', 404);
    }
    if (manifest.status !== 'DRAFT') {
        throw new AppError('Cannot modify manifest in current status', 400);
    }

    const tripType = assertOperationalTripType(manifest.tripType);

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { demand: true },
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    // Check if already assigned to this manifest
    const existingLeg = await prisma.orderLeg.findUnique({
        where: {
            orderId_manifestId: { orderId, manifestId }
        }
    });
    if (existingLeg) {
        throw new AppError('Order is already assigned to this manifest', 400);
    }

    await assertOrderNotInOtherActiveManifest(orderId, manifestId);

    const effectiveWeight = orderEffectiveWeight(order);
    const newTotalWeight = manifest.totalWeight + effectiveWeight;
    const newTotalVolume = manifest.totalVolume + order.demand.volume;
    const newTotalValue = manifest.totalValue + order.demand.nfValue;

    if (newTotalWeight > manifest.vehicleType.maxWeight) {
        throw new AppError(
            `Exceeds weight capacity: ${newTotalWeight}kg / ${manifest.vehicleType.maxWeight}kg`,
            400
        );
    }
    if (newTotalVolume > manifest.vehicleType.maxVolume) {
        throw new AppError(
            `Exceeds volume capacity: ${newTotalVolume}m³ / ${manifest.vehicleType.maxVolume}m³`,
            400
        );
    }
    if (newTotalValue > manifest.vehicleType.maxValue) {
        throw new AppError(
            `Exceeds value limit: R$ ${newTotalValue} / R$ ${manifest.vehicleType.maxValue}`,
            400
        );
    }

    const historyDescription = allocationOrderHistoryDescription(
        manifestId,
        tripType,
        manifest.destHub?.code
    );

    await prisma.$transaction(async (tx) => {
        // Calculate marginBefore
        const marginBeforeStats = await getManifestMargin(manifestId, tx);
        const marginBefore = (marginBeforeStats.margin !== null && marginBeforeStats.revenue > 0)
            ? marginBeforeStats.margin / marginBeforeStats.revenue
            : null;

        // Find highest sequence number for this order
        const maxLeg = await tx.orderLeg.findFirst({
            where: { orderId },
            orderBy: { sequence: 'desc' }
        });
        const sequence = maxLeg ? maxLeg.sequence + 1 : 1;

        // Create OrderLeg
        await tx.orderLeg.create({
            data: {
                orderId,
                manifestId,
                sequence,
                legType: manifest.tripType === 'DELIVERY' ? 'ENTREGA' : 'TRANSFERENCIA',
                executedBy: manifest.linkId ? 'LINK' : 'HUB',
                originHubId: manifest.hubId,
                destHubId: manifest.destHubId,
            }
        });

        // Set manifestId on Order for legacy/read compatibility
        await tx.order.update({
            where: { id: orderId },
            data: { manifestId },
        });

        await tx.orderHistory.create({
            data: {
                orderId: orderId,
                eventType: 'NOTE',
                description: historyDescription,
            },
        });

        await tx.manifest.update({
            where: { id: manifestId },
            data: {
                totalWeight: newTotalWeight,
                totalVolume: newTotalVolume,
                totalValue: newTotalValue,
            },
        });

        // Recalculate and allocate costs
        await allocateLegCosts(manifestId, tx);

        // Calculate marginAfter
        const marginAfterStats = await getManifestMargin(manifestId, tx);
        const marginAfter = (marginAfterStats.margin !== null && marginAfterStats.revenue > 0)
            ? marginAfterStats.margin / marginAfterStats.revenue
            : null;

        // Write ConsolidationFeedback
        await tx.consolidationFeedback.create({
            data: {
                adminId: actor.adminId || null,
                actorUserId: actor.userId,
                actorRole: actor.role,
                action: 'ACCEPTED',
                orderIds: [orderId],
                suggestedManifests: Prisma.JsonNull,
                finalManifests: Prisma.JsonNull,
                utilizationBefore: manifest.totalWeight / manifest.vehicleType.maxWeight,
                utilizationAfter: newTotalWeight / manifest.vehicleType.maxWeight,
                marginBefore,
                marginAfter,
            }
        });
    });

    const updated = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            vehicleType: true,
            legs: { include: { order: { include: { demand: true } } } },
            destHub: true
        },
    });

    return {
        manifest: updated!,
        utilization: {
            weight: ((newTotalWeight / manifest.vehicleType.maxWeight) * 100).toFixed(1) + '%',
            volume: ((newTotalVolume / manifest.vehicleType.maxVolume) * 100).toFixed(1) + '%',
            value: ((newTotalValue / manifest.vehicleType.maxValue) * 100).toFixed(1) + '%',
        },
    };
}

export async function removeOrderFromManifest(
    manifestId: string,
    orderId: string,
    actor: { userId: string; role: UserRole; adminId?: string }
) {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: { vehicleType: true },
    });

    if (!manifest) {
        throw new AppError('Manifest not found', 404);
    }
    if (manifest.status !== 'DRAFT') {
        throw new AppError('Cannot modify manifest in current status', 400);
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { demand: true },
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    const leg = await prisma.orderLeg.findUnique({
        where: {
            orderId_manifestId: { orderId, manifestId }
        }
    });

    if (!leg) {
        throw new AppError('Order not assigned to this manifest', 404);
    }

    if (leg.startedAt || leg.completedAt) {
        throw new AppError('Cannot remove a leg that is already started or completed', 400);
    }

    const effectiveWeight = orderEffectiveWeight(order);

    await prisma.$transaction(async (tx) => {
        // Calculate marginBefore
        const marginBeforeStats = await getManifestMargin(manifestId, tx);
        const marginBefore = (marginBeforeStats.margin !== null && marginBeforeStats.revenue > 0)
            ? marginBeforeStats.margin / marginBeforeStats.revenue
            : null;

        await tx.orderLeg.delete({
            where: {
                orderId_manifestId: { orderId, manifestId }
            }
        });

        // Unset legacy manifestId if it matches this manifest
        if (order.manifestId === manifestId) {
            await tx.order.update({
                where: { id: orderId },
                data: { manifestId: null },
            });
        }

        await tx.orderHistory.create({
            data: {
                orderId: orderId,
                eventType: 'NOTE',
                description: `Pedido removido do manifesto ${manifestId}`,
            },
        });

        const newTotalWeight = Math.max(0, manifest.totalWeight - effectiveWeight);
        const newTotalVolume = Math.max(0, manifest.totalVolume - order.demand.volume);
        const newTotalValue = Math.max(0, manifest.totalValue - order.demand.nfValue);

        await tx.manifest.update({
            where: { id: manifestId },
            data: {
                totalWeight: newTotalWeight,
                totalVolume: newTotalVolume,
                totalValue: newTotalValue,
            },
        });

        // Recalculate and allocate costs
        await allocateLegCosts(manifestId, tx);

        // Calculate marginAfter
        const marginAfterStats = await getManifestMargin(manifestId, tx);
        const marginAfter = (marginAfterStats.margin !== null && marginAfterStats.revenue > 0)
            ? marginAfterStats.margin / marginAfterStats.revenue
            : null;

        // Write ConsolidationFeedback
        await tx.consolidationFeedback.create({
            data: {
                adminId: actor.adminId || null,
                actorUserId: actor.userId,
                actorRole: actor.role,
                action: 'MODIFIED',
                orderIds: [orderId],
                suggestedManifests: Prisma.JsonNull,
                finalManifests: Prisma.JsonNull,
                utilizationBefore: manifest.totalWeight / manifest.vehicleType.maxWeight,
                utilizationAfter: newTotalWeight / manifest.vehicleType.maxWeight,
                marginBefore,
                marginAfter,
            }
        });
    });
}

type ManifestWithLegs = Prisma.ManifestGetPayload<{
    include: {
        legs: {
            include: {
                order: {
                    include: {
                        demand: true;
                    };
                };
            };
        };
        destHub: { select: { id: true; code: true } };
    };
}>;

async function loadManifestForLifecycle(manifestId: string): Promise<ManifestWithLegs> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            legs: {
                include: {
                    order: {
                        include: {
                            demand: true,
                        },
                    },
                },
            },
            destHub: { select: { id: true, code: true } },
        },
    });
    if (!manifest) {
        throw new AppError('Manifest not found', 404);
    }
    return manifest;
}

function startStatuses(tripType: OperationalTripType): {
    orderStatus: OrderStatus;
    demandDescription: string;
    orderEventType: OrderEventType;
} {
    if (tripType === 'DELIVERY') {
        return {
            orderStatus: 'OUT_FOR_DELIVERY',
            demandDescription: 'Carga saiu para entrega final',
            orderEventType: 'OUT_FOR_DELIVERY',
        };
    }
    return {
        orderStatus: 'IN_TRANSIT',
        demandDescription: 'Carga em trânsito entre hubs',
        orderEventType: 'IN_TRANSIT',
    };
}

export async function startManifest(manifestId: string) {
    const manifest = await loadManifestForLifecycle(manifestId);

    if (manifest.status !== 'ACCEPTED') {
        throw new AppError('Manifest not found or not in accepted status', 400);
    }

    const tripType = assertOperationalTripType(manifest.tripType);
    const statuses = startStatuses(tripType);

    // Verify invariant: none of the orders should have another leg IN_PROGRESS
    for (const leg of manifest.legs) {
        const orderId = leg.orderId;
        const activeLeg = await prisma.orderLeg.findFirst({
            where: {
                orderId,
                manifestId: { not: manifestId },
                manifest: {
                    status: 'IN_PROGRESS'
                }
            }
        });
        if (activeLeg) {
            throw new AppError(`Pedido ${leg.order.nfNumber ?? orderId} já está em trânsito em outro manifesto.`, 400);
        }
    }

    await prisma.$transaction(async (tx) => {
        await tx.manifest.update({
            where: { id: manifestId },
            data: { status: 'IN_PROGRESS', startedAt: new Date() },
        });

        await tx.orderLeg.updateMany({
            where: { manifestId },
            data: { startedAt: new Date() }
        });

        for (const leg of manifest.legs) {
            await tx.order.update({
                where: { id: leg.orderId },
                data: { status: statuses.orderStatus },
            });
            await tx.orderHistory.create({
                data: {
                    orderId: leg.orderId,
                    eventType: statuses.orderEventType,
                    description: statuses.demandDescription,
                    location: manifest.origin,
                },
            });
        }
    });
}

export async function completeManifest(
    manifestId: string,
    actor?: { userId: string; role: UserRole; adminId?: string }
) {
    const manifest = await loadManifestForLifecycle(manifestId);

    if (manifest.status !== 'IN_PROGRESS') {
        throw new AppError('Manifest not found or not in progress', 400);
    }

    const tripType = assertOperationalTripType(manifest.tripType);
    const now = new Date();

    if (tripType === 'TRANSFER') {
        if (!manifest.destHubId) {
            throw new AppError('destHubId é obrigatório para concluir viagem TRANSFER', 400);
        }

        const destCode = manifest.destHub?.code ?? manifest.destHubId;

        await prisma.$transaction(async (tx) => {
            await tx.manifest.update({
                where: { id: manifestId },
                data: { status: 'COMPLETED', completedAt: now },
            });

            await tx.orderLeg.updateMany({
                where: { manifestId },
                data: { completedAt: now }
            });

            for (const leg of manifest.legs) {
                await tx.order.update({
                    where: { id: leg.orderId },
                    data: {
                        status: 'AT_HUB',
                        currentHubId: manifest.destHubId,
                        enteredAtHubAt: leg.order.enteredAtHubAt ?? now,
                    },
                });
                await tx.orderHistory.create({
                    data: {
                        orderId: leg.orderId,
                        eventType: 'AT_HUB',
                        description: `Recebido no hub destino (${destCode})`,
                        location: manifest.destination,
                    },
                });
            }

            // Final cost allocation update
            await allocateLegCosts(manifestId, tx);
        });

        return;
    }

    // tripType === 'DELIVERY'
    await prisma.$transaction(async (tx) => {
        await tx.manifest.update({
            where: { id: manifestId },
            data: { status: 'COMPLETED', completedAt: now },
        });

        await tx.orderLeg.updateMany({
            where: { manifestId },
            data: { completedAt: now }
        });

        for (const leg of manifest.legs) {
            await tx.order.update({
                where: { id: leg.orderId },
                data: {
                    status: 'DELIVERED',
                    currentHubId: null,
                },
            });
            await tx.orderHistory.create({
                data: {
                    orderId: leg.orderId,
                    eventType: 'DELIVERED',
                    description: 'Carga entregue ao destinatário',
                    location: manifest.destination,
                },
            });
        }

        // Final cost allocation update
        await allocateLegCosts(manifestId, tx);
    });

    if (manifest.linkId && manifest.legs.length > 0) {
        await prisma.link.update({
            where: { id: manifest.linkId },
            data: { deliveryCount: { increment: manifest.legs.length } },
        });
    }
}
