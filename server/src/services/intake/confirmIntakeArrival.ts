import type { Demand, DemandSource, Order } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { isIntakeSource } from './intakeDemandPolicy.js';

export interface ConfirmIntakeArrivalInput {
    demandId: string;
    actingRoles: string[];
    actingHubId: string | null | undefined;
    remetentePersonId?: string | null;
    destinatarioPersonId: string;
    freightTerm?: 'CIF' | 'FOB' | 'REDESPACHO';
}

export interface ConfirmIntakeArrivalResult {
    demand: Demand;
    order: Order;
}

export async function confirmIntakeArrival(input: ConfirmIntakeArrivalInput): Promise<ConfirmIntakeArrivalResult> {
    const demand = await prisma.demand.findUnique({
        where: { id: input.demandId },
        include: {
            order: true,
            client: { select: { id: true, personId: true, companyName: true } },
        },
    });

    if (!demand) {
        throw new AppError('Demand not found', 404);
    }
    if (demand.status !== 'AWAITING_ARRIVAL') {
        throw new AppError('Demanda não está aguardando chegada', 400);
    }
    if (demand.order) {
        throw new AppError('Pedido já existe para esta demanda', 400);
    }
    if (!isIntakeSource(demand.sourceType as DemandSource)) {
        throw new AppError('Not an intake demand', 400);
    }

    const isHub = input.actingRoles.includes('HUB');
    if (isHub) {
        if (!input.actingHubId) {
            throw new AppError('Hub user has no hub assigned', 403);
        }
        if (demand.expectedHubId !== input.actingHubId) {
            throw new AppError('Not authorized', 403);
        }
    }

    const remetentePersonId = input.remetentePersonId?.trim() || demand.client.personId;
    if (!remetentePersonId) {
        throw new AppError(
            'Associe uma pessoa ao cliente ou informe remetentePersonId para confirmar a chegada.',
            400,
        );
    }

    const currentHubId = isHub ? input.actingHubId! : demand.expectedHubId;
    if (!currentHubId) {
        throw new AppError('Defina o hub de recebimento (expectedHubId) antes de confirmar.', 400);
    }

    const freightTerm = input.freightTerm ?? 'CIF';

    const matchingOpportunity = await prisma.opportunity.findFirst({
        where: { matchedDemandId: demand.id },
    });

    return prisma.$transaction(async (tx) => {
        const updatedDemand = await tx.demand.update({
            where: { id: demand.id },
            data: { status: 'CONVERTED' },
        });

        await tx.demandEvent.create({
            data: {
                demandId: demand.id,
                status: 'CONVERTED',
                description: 'Chegada confirmada no hub — pedido criado',
                location: demand.origin,
            },
        });

        const newOrder = await tx.order.create({
            data: {
                demandId: demand.id,
                opportunityId: matchingOpportunity?.id ?? null,
                manifestId: undefined,
                nfNumber: demand.nfNumber,
                status: 'AT_HUB',
                enteredAtHubAt: new Date(),
                currentHubId,
                freightTerm,
                remetentePersonId,
                destinatarioPersonId: input.destinatarioPersonId,
                origemPrestacao: demand.origin,
                fimPrestacao: demand.destination,
            },
        });

        const demandEvents = await tx.demandEvent.findMany({
            where: { demandId: demand.id },
            orderBy: { createdAt: 'asc' },
        });

        const statusMap: Record<string, string> = {
            PENDING: 'CREATED',
            QUOTED: 'CREATED',
            APPROVED: 'CREATED',
            ASSIGNED: 'CREATED',
            AWAITING_ARRIVAL: 'CREATED',
            COLLECTED: 'COLLECTED',
            IN_TRANSIT: 'IN_TRANSIT',
            AT_HUB: 'AT_HUB',
            OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
            DELIVERED: 'DELIVERED',
            CANCELLED: 'CANCELLED',
        };

        for (const event of demandEvents) {
            await tx.orderHistory.create({
                data: {
                    orderId: newOrder.id,
                    eventType: (statusMap[event.status] || 'NOTE') as any,
                    description: event.description,
                    location: event.location,
                    photoUrl: event.photoUrl,
                    demandEventId: event.id,
                },
            });
        }

        await tx.orderHistory.create({
            data: {
                orderId: newOrder.id,
                eventType: 'AT_HUB',
                description: 'Chegada confirmada no hub (intake)',
                location: demand.origin,
            },
        });

        return { demand: updatedDemand, order: newOrder };
    });
}
