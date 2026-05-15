import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import {
    addDemandToManifest,
    assertOperationalTripType,
    completeManifest,
    startManifest,
} from './manifestLifecycle.js';

type TxOp = { model: string; action: string; args: Record<string, unknown> };

const prismaSnapshot = {
    manifestFindUnique: prisma.manifest.findUnique.bind(prisma.manifest),
    orderFindMany: prisma.order.findMany.bind(prisma.order),
    demandFindUnique: prisma.demand.findUnique.bind(prisma.demand),
    demandFindFirst: prisma.demand.findFirst.bind(prisma.demand),
    orderFindFirst: prisma.order.findFirst.bind(prisma.order),
    transaction: prisma.$transaction.bind(prisma),
    linkUpdate: prisma.link.update.bind(prisma.link),
};

function restorePrismaMocks() {
    prisma.manifest.findUnique = prismaSnapshot.manifestFindUnique;
    prisma.order.findMany = prismaSnapshot.orderFindMany;
    prisma.demand.findUnique = prismaSnapshot.demandFindUnique;
    prisma.demand.findFirst = prismaSnapshot.demandFindFirst;
    prisma.order.findFirst = prismaSnapshot.orderFindFirst;
    prisma.$transaction = prismaSnapshot.transaction;
    prisma.link.update = prismaSnapshot.linkUpdate;
}

describe('manifestLifecycle', () => {
    beforeEach(() => restorePrismaMocks());
    afterEach(() => restorePrismaMocks());

    const manifestId = 'manifest-transfer-1';
    const destHubId = 'hub-imp-ma';
    const originHubId = 'hub-sp-gru';
    const demand1 = 'demand-1';
    const demand2 = 'demand-2';
    const order1 = 'order-1';
    const order2 = 'order-2';
    const linkId = 'link-1';

    const baseManifest = {
        id: manifestId,
        status: 'IN_PROGRESS' as const,
        tripType: 'TRANSFER' as const,
        origin: 'Guarulhos, SP',
        destination: 'Imperatriz, MA',
        destHubId,
        hubId: originHubId,
        linkId,
        demands: [
            { id: demand1, weight: 100, volume: 1, nfValue: 500, cubedWeight: null },
            { id: demand2, weight: 80, volume: 0.8, nfValue: 400, cubedWeight: null },
        ],
        destHub: { id: destHubId, code: 'IMP-MA' },
    };

    const orders = [
        { id: order1, demandId: demand1, manifestId, status: 'IN_TRANSIT', enteredAtHubAt: null, currentHubId: null },
        { id: order2, demandId: demand2, manifestId, status: 'IN_TRANSIT', enteredAtHubAt: null, currentHubId: null },
    ];

    const txLog: TxOp[] = [];

    function mockTx() {
        return {
            manifest: {
                update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
                    txLog.push({ model: 'manifest', action: 'update', args });
                    return { id: args.where.id, ...args.data };
                },
            },
            demand: {
                update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
                    txLog.push({ model: 'demand', action: 'update', args });
                    return { id: args.where.id, ...args.data };
                },
            },
            order: {
                update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
                    txLog.push({ model: 'order', action: 'update', args });
                    return { id: args.where.id, ...args.data };
                },
            },
            demandEvent: {
                create: async (args: { data: Record<string, unknown> }) => {
                    txLog.push({ model: 'demandEvent', action: 'create', args });
                    return { id: 'ev', ...args.data };
                },
            },
            orderHistory: {
                create: async (args: { data: Record<string, unknown> }) => {
                    txLog.push({ model: 'orderHistory', action: 'create', args });
                    return { id: 'oh', ...args.data };
                },
            },
        };
    }

    it('assertOperationalTripType rejects REGIONAL_DISTRIBUTION', () => {
        assert.throws(
            () => assertOperationalTripType('REGIONAL_DISTRIBUTION'),
            (err: unknown) => err instanceof AppError && err.statusCode === 400
        );
    });

    it('completeManifest TRANSFER sets AT_HUB on demands and orders', async () => {
        txLog.length = 0;
        let linkUpdateCalls = 0;

        prisma.manifest.findUnique = (async () => baseManifest) as unknown as typeof prisma.manifest.findUnique;
        prisma.order.findMany = (async () => orders) as unknown as typeof prisma.order.findMany;
        prisma.$transaction = (async (fn: unknown) => {
            if (typeof fn === 'function') return fn(mockTx());
            throw new Error('batch transaction not mocked');
        }) as unknown as typeof prisma.$transaction;
        prisma.link.update = (async () => {
            linkUpdateCalls += 1;
            return { id: linkId, deliveryCount: 0 };
        }) as unknown as typeof prisma.link.update;

        await completeManifest(manifestId);

        const demandUpdates = txLog.filter((o) => o.model === 'demand' && o.action === 'update');
        const orderUpdates = txLog.filter((o) => o.model === 'order' && o.action === 'update');
        assert.equal(demandUpdates.length, 2);
        assert.equal(orderUpdates.length, 2);
        assert.ok(
            demandUpdates.every(
                (o) => (o.args.data as Record<string, unknown> | undefined)?.status === 'AT_HUB'
            )
        );
        assert.ok(
            orderUpdates.every(
                (o) => (o.args.data as Record<string, unknown> | undefined)?.status === 'AT_HUB'
            )
        );
        assert.ok(
            orderUpdates.every(
                (o) => (o.args.data as Record<string, unknown> | undefined)?.currentHubId === destHubId
            )
        );
        assert.equal(linkUpdateCalls, 0);

        const demandEvents = txLog.filter((o) => o.model === 'demandEvent');
        const orderHistories = txLog.filter((o) => o.model === 'orderHistory');
        assert.ok(demandEvents.length >= 2);
        assert.ok(orderHistories.length >= 2);
    });

    it('syncs order.manifestId and uses NOTE in order history', async () => {
        const draftManifestId = 'man-draft';
        const demandId = 'dem-1';
        const orderId = 'ord-1';
        const txAddLog: Array<{ model: string; data: Record<string, unknown> }> = [];

        prisma.manifest.findUnique = (async (args: { where: { id: string } }) => {
            if (args.where.id !== draftManifestId) return null;
            return {
                id: draftManifestId,
                status: 'DRAFT',
                tripType: 'TRANSFER',
                totalWeight: 50,
                totalVolume: 0.5,
                totalValue: 200,
                vehicleType: { maxWeight: 5000, maxVolume: 50, maxValue: 500_000 },
                destHub: { code: 'IMP-MA' },
                demands: [{ id: demandId }],
            };
        }) as unknown as typeof prisma.manifest.findUnique;

        prisma.demand.findUnique = (async () => ({
            id: demandId,
            manifestId: null,
            weight: 50,
            volume: 0.5,
            nfValue: 200,
            cubedWeight: null,
            order: { id: orderId },
        })) as unknown as typeof prisma.demand.findUnique;

        prisma.demand.findFirst = (async () => null) as unknown as typeof prisma.demand.findFirst;
        prisma.order.findFirst = (async () => null) as unknown as typeof prisma.order.findFirst;

        prisma.$transaction = (async (fn: unknown) => {
            if (typeof fn !== 'function') throw new Error('batch not mocked');
            const tx = {
                demand: {
                    update: async ({ data }: { data: Record<string, unknown> }) => {
                        txAddLog.push({ model: 'demand', data });
                        return data;
                    },
                },
                order: {
                    update: async ({ data }: { data: Record<string, unknown> }) => {
                        txAddLog.push({ model: 'order', data });
                        return data;
                    },
                },
                manifest: {
                    update: async ({ data }: { data: Record<string, unknown> }) => data,
                },
                demandEvent: {
                    create: async ({ data }: { data: Record<string, unknown> }) => {
                        txAddLog.push({ model: 'demandEvent', data });
                        return data;
                    },
                },
                orderHistory: {
                    create: async ({ data }: { data: Record<string, unknown> }) => {
                        txAddLog.push({ model: 'orderHistory', data });
                        return data;
                    },
                },
            };
            return fn(tx);
        }) as unknown as typeof prisma.$transaction;

        await addDemandToManifest(draftManifestId, demandId);

        const orderUpdate = txAddLog.find((o) => o.model === 'order');
        assert.ok(orderUpdate);
        assert.equal(orderUpdate!.data.manifestId, draftManifestId);

        const history = txAddLog.find((o) => o.model === 'orderHistory');
        assert.ok(history);
        assert.equal(history!.data.eventType, 'NOTE');
        assert.match(String(history!.data.description), /manifesto man-draft/);
        assert.match(String(history!.data.description), /IMP-MA/);
    });

    it('uses OUT_FOR_DELIVERY for DELIVERY trip on start', async () => {
        const deliveryManifestId = 'man-delivery';
        const txStartLog: TxOp[] = [];

        prisma.manifest.findUnique = (async () => ({
            id: deliveryManifestId,
            status: 'ACCEPTED',
            tripType: 'DELIVERY',
            origin: 'A',
            destination: 'B',
            destHubId: null,
            demands: [{ id: 'd1' }],
            destHub: null,
        })) as unknown as typeof prisma.manifest.findUnique;

        prisma.order.findMany = (async () => [
            { id: 'o1', demandId: 'd1', manifestId: deliveryManifestId, status: 'PENDING' },
        ]) as unknown as typeof prisma.order.findMany;

        prisma.$transaction = (async (fn: unknown) => {
            if (typeof fn !== 'function') throw new Error('batch not mocked');
            const tx = {
                manifest: {
                    update: async (args: { data: Record<string, unknown> }) => {
                        txStartLog.push({ model: 'manifest', action: 'update', args });
                        return args.data;
                    },
                },
                demand: {
                    update: async (args: { data: Record<string, unknown> }) => {
                        txStartLog.push({ model: 'demand', action: 'update', args });
                        return args.data;
                    },
                },
                order: {
                    update: async (args: { data: Record<string, unknown> }) => {
                        txStartLog.push({ model: 'order', action: 'update', args });
                        return args.data;
                    },
                },
                demandEvent: {
                    create: async (args: { data: Record<string, unknown> }) => {
                        txStartLog.push({ model: 'demandEvent', action: 'create', args });
                        return args.data;
                    },
                },
                orderHistory: {
                    create: async (args: { data: Record<string, unknown> }) => {
                        txStartLog.push({ model: 'orderHistory', action: 'create', args });
                        return args.data;
                    },
                },
            };
            return fn(tx);
        }) as unknown as typeof prisma.$transaction;

        await startManifest(deliveryManifestId);

        const demandUpdate = txStartLog.find((o) => o.model === 'demand');
        const orderUpdate = txStartLog.find((o) => o.model === 'order');
        assert.equal(
            (demandUpdate?.args.data as Record<string, unknown> | undefined)?.status,
            'OUT_FOR_DELIVERY'
        );
        assert.equal(
            (orderUpdate?.args.data as Record<string, unknown> | undefined)?.status,
            'OUT_FOR_DELIVERY'
        );
    });
});
