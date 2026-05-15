import {
    DemandStatus,
    ManifestStatus,
    ManifestTripType,
    OrderEventType,
    OrderStatus,
    Prisma,
} from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

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

function demandEffectiveWeight(demand: { weight: number; cubedWeight: number | null }) {
    return Math.max(demand.weight, demand.cubedWeight ?? 0);
}

export async function assertDemandNotInOtherActiveManifest(
    demandId: string,
    exceptManifestId: string
) {
    const conflict = await prisma.demand.findFirst({
        where: {
            id: demandId,
            manifestId: { not: null },
            manifest: {
                id: { not: exceptManifestId },
                status: { in: ACTIVE_MANIFEST_STATUSES },
            },
        },
    });
    if (conflict) {
        throw new AppError('Demanda já está em outro manifesto ativo', 400);
    }

    const orderConflict = await prisma.order.findFirst({
        where: {
            demandId,
            manifestId: { not: null },
            manifest: {
                id: { not: exceptManifestId },
                status: { in: ACTIVE_MANIFEST_STATUSES },
            },
        },
    });
    if (orderConflict) {
        throw new AppError('Pedido já está em outro manifesto ativo', 400);
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

export async function addDemandToManifest(manifestId: string, demandId: string) {
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

    const demand = await prisma.demand.findUnique({
        where: { id: demandId },
        include: { order: true },
    });

    if (!demand) {
        throw new AppError('Demand not found', 404);
    }

    if (demand.manifestId && demand.manifestId !== manifestId) {
        throw new AppError('Demand is already assigned to a manifest', 400);
    }

    await assertDemandNotInOtherActiveManifest(demandId, manifestId);

    const effectiveWeight = demandEffectiveWeight(demand);
    const newTotalWeight = manifest.totalWeight + effectiveWeight;
    const newTotalVolume = manifest.totalVolume + demand.volume;
    const newTotalValue = manifest.totalValue + demand.nfValue;

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
        await tx.demand.update({
            where: { id: demandId },
            data: { manifestId, status: 'ASSIGNED' },
        });

        if (demand.order) {
            await tx.order.update({
                where: { id: demand.order.id },
                data: { manifestId },
            });
            await tx.orderHistory.create({
                data: {
                    orderId: demand.order.id,
                    eventType: 'NOTE',
                    description: historyDescription,
                },
            });
        }

        await tx.manifest.update({
            where: { id: manifestId },
            data: {
                totalWeight: newTotalWeight,
                totalVolume: newTotalVolume,
                totalValue: newTotalValue,
            },
        });

        await tx.demandEvent.create({
            data: {
                demandId,
                status: 'ASSIGNED',
                description: `Alocada ao manifesto ${manifestId}`,
            },
        });
    });

    const updated = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: { vehicleType: true, demands: true, destHub: true },
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

export async function removeDemandFromManifest(manifestId: string, demandId: string) {
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

    const demand = await prisma.demand.findUnique({
        where: { id: demandId },
        include: { order: true },
    });

    if (!demand || demand.manifestId !== manifestId) {
        throw new AppError('Demand not found in this manifest', 404);
    }

    const effectiveWeight = demandEffectiveWeight(demand);

    await prisma.$transaction(async (tx) => {
        await tx.demand.update({
            where: { id: demandId },
            data: { manifestId: null, status: 'APPROVED' },
        });

        if (demand.order) {
            await tx.order.update({
                where: { id: demand.order.id },
                data: { manifestId: null },
            });
            await tx.orderHistory.create({
                data: {
                    orderId: demand.order.id,
                    eventType: 'NOTE',
                    description: `Demanda removida do manifesto ${manifestId}`,
                },
            });
        }

        await tx.manifest.update({
            where: { id: manifestId },
            data: {
                totalWeight: Math.max(0, manifest.totalWeight - effectiveWeight),
                totalVolume: Math.max(0, manifest.totalVolume - demand.volume),
                totalValue: Math.max(0, manifest.totalValue - demand.nfValue),
            },
        });

        await tx.demandEvent.create({
            data: {
                demandId,
                status: 'APPROVED',
                description: `Removida do manifesto ${manifestId}`,
            },
        });
    });
}

type ManifestWithDemands = Prisma.ManifestGetPayload<{
    include: {
        demands: true;
        destHub: { select: { id: true; code: true } };
    };
}>;

async function loadManifestForLifecycle(manifestId: string): Promise<ManifestWithDemands> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            demands: true,
            destHub: { select: { id: true, code: true } },
        },
    });
    if (!manifest) {
        throw new AppError('Manifest not found', 404);
    }
    return manifest;
}

async function loadOrdersForManifest(manifestId: string) {
    return prisma.order.findMany({
        where: { manifestId },
    });
}

function startStatuses(tripType: OperationalTripType): {
    demandStatus: DemandStatus;
    orderStatus: OrderStatus;
    demandDescription: string;
    orderEventType: OrderEventType;
} {
    if (tripType === 'DELIVERY') {
        return {
            demandStatus: 'OUT_FOR_DELIVERY',
            orderStatus: 'OUT_FOR_DELIVERY',
            demandDescription: 'Carga saiu para entrega final',
            orderEventType: 'OUT_FOR_DELIVERY',
        };
    }
    return {
        demandStatus: 'IN_TRANSIT',
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
    const orders = await loadOrdersForManifest(manifestId);

    await prisma.$transaction(async (tx) => {
        await tx.manifest.update({
            where: { id: manifestId },
            data: { status: 'IN_PROGRESS', startedAt: new Date() },
        });

        for (const d of manifest.demands) {
            await tx.demand.update({
                where: { id: d.id },
                data: { status: statuses.demandStatus },
            });
            await tx.demandEvent.create({
                data: {
                    demandId: d.id,
                    status: statuses.demandStatus,
                    description: statuses.demandDescription,
                    location: manifest.origin,
                },
            });
        }

        for (const order of orders) {
            await tx.order.update({
                where: { id: order.id },
                data: { status: statuses.orderStatus },
            });
            await tx.orderHistory.create({
                data: {
                    orderId: order.id,
                    eventType: statuses.orderEventType,
                    description: statuses.demandDescription,
                    location: manifest.origin,
                },
            });
        }
    });
}

export async function completeManifest(manifestId: string) {
    const manifest = await loadManifestForLifecycle(manifestId);

    if (manifest.status !== 'IN_PROGRESS') {
        throw new AppError('Manifest not found or not in progress', 400);
    }

    const tripType = assertOperationalTripType(manifest.tripType);
    const orders = await loadOrdersForManifest(manifestId);
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

            for (const d of manifest.demands) {
                await tx.demand.update({
                    where: { id: d.id },
                    data: { status: 'AT_HUB' },
                });
                await tx.demandEvent.create({
                    data: {
                        demandId: d.id,
                        status: 'AT_HUB',
                        description: `Recebido no hub destino (${destCode})`,
                        location: manifest.destination,
                    },
                });
            }

            for (const order of orders) {
                await tx.order.update({
                    where: { id: order.id },
                    data: {
                        status: 'AT_HUB',
                        currentHubId: manifest.destHubId,
                        enteredAtHubAt: order.enteredAtHubAt ?? now,
                    },
                });
                await tx.orderHistory.create({
                    data: {
                        orderId: order.id,
                        eventType: 'AT_HUB',
                        description: `Recebido no hub destino (${destCode})`,
                        location: manifest.destination,
                    },
                });
            }
        });

        return;
    }

    // DELIVERY — legado: entrega final + deliveryCount
    await prisma.$transaction(async (tx) => {
        await tx.manifest.update({
            where: { id: manifestId },
            data: { status: 'COMPLETED', completedAt: now },
        });

        for (const d of manifest.demands) {
            await tx.demand.update({
                where: { id: d.id },
                data: { status: 'DELIVERED' },
            });
            await tx.demandEvent.create({
                data: {
                    demandId: d.id,
                    status: 'DELIVERED',
                    description: 'Carga entregue ao destinatário',
                    location: manifest.destination,
                },
            });
        }

        for (const order of orders) {
            await tx.order.update({
                where: { id: order.id },
                data: {
                    status: 'DELIVERED',
                    currentHubId: null,
                },
            });
            await tx.orderHistory.create({
                data: {
                    orderId: order.id,
                    eventType: 'DELIVERED',
                    description: 'Carga entregue ao destinatário',
                    location: manifest.destination,
                },
            });
        }
    });

    // deliveryCount: legado = cargas no manifesto DELIVERY concluído; não é transferência hub-hub
    if (manifest.linkId && manifest.demands.length > 0) {
        await prisma.link.update({
            where: { id: manifest.linkId },
            data: { deliveryCount: { increment: manifest.demands.length } },
        });
    }
}
