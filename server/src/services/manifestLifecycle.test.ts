import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authorizedCteLegFixture, authorizedMdfeFixture, departureReadyManifest } from '../test/departureReadyFixture.js';
import {
    addOrderToManifest,
    assertOperationalTripType,
    completeManifest,
    startManifest,
} from './manifestLifecycle.js';

type TxOp = { model: string; action: string; args: Record<string, unknown> };

const prismaSnapshot = {
    manifestFindUnique: prisma.manifest.findUnique.bind(prisma.manifest),
    orderFindUnique: prisma.order.findUnique.bind(prisma.order),
    orderFindMany: prisma.order.findMany.bind(prisma.order),
    demandFindUnique: prisma.demand.findUnique.bind(prisma.demand),
    demandFindFirst: prisma.demand.findFirst.bind(prisma.demand),
    orderFindFirst: prisma.order.findFirst.bind(prisma.order),
    orderLegFindUnique: (prisma as any).orderLeg?.findUnique?.bind((prisma as any).orderLeg),
    orderLegFindFirst: (prisma as any).orderLeg?.findFirst?.bind((prisma as any).orderLeg),
    orderLegFindMany: prisma.orderLeg.findMany.bind(prisma.orderLeg),
    fiscalDocFindMany: prisma.manifestFiscalDocument.findMany.bind(prisma.manifestFiscalDocument),
    transaction: prisma.$transaction.bind(prisma),
    linkUpdate: prisma.link.update.bind(prisma.link),
};

function restorePrismaMocks() {
    prisma.manifest.findUnique = prismaSnapshot.manifestFindUnique;
    prisma.order.findUnique = prismaSnapshot.orderFindUnique;
    prisma.order.findMany = prismaSnapshot.orderFindMany;
    prisma.demand.findUnique = prismaSnapshot.demandFindUnique;
    prisma.demand.findFirst = prismaSnapshot.demandFindFirst;
    prisma.order.findFirst = prismaSnapshot.orderFindFirst;
    if (prismaSnapshot.orderLegFindUnique) {
        (prisma as any).orderLeg.findUnique = prismaSnapshot.orderLegFindUnique;
    }
    if (prismaSnapshot.orderLegFindFirst) {
        (prisma as any).orderLeg.findFirst = prismaSnapshot.orderLegFindFirst;
    }
    (prisma as any).orderLeg.findMany = prismaSnapshot.orderLegFindMany;
    prisma.manifestFiscalDocument.findMany = prismaSnapshot.fiscalDocFindMany;
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
        totalWeight: 180,
        totalVolume: 1.8,
        totalValue: 900,
        legs: [] as any[],
        destHub: { id: destHubId, code: 'IMP-MA' },
        vehicleType: { maxWeight: 5000, maxVolume: 50, maxValue: 500_000, code: 'TRUCK' },
    };

    const orders = [
        {
            id: order1,
            demandId: demand1,
            manifestId,
            status: 'IN_TRANSIT',
            enteredAtHubAt: null,
            currentHubId: null,
            demand: { weight: 100, volume: 1, nfValue: 500, cubedWeight: null }
        },
        {
            id: order2,
            demandId: demand2,
            manifestId,
            status: 'IN_TRANSIT',
            enteredAtHubAt: null,
            currentHubId: null,
            demand: { weight: 80, volume: 0.8, nfValue: 400, cubedWeight: null }
        },
    ];

    const txLog: TxOp[] = [];

    function mockTx() {
        return {
            fiscalClosureTask: { upsert: async () => ({ id: 'closure-task' }) },
            manifest: {
                findUnique: async (args: any) => {
                    return {
                        ...baseManifest,
                        id: args.where.id,
                        legs: orders.map(o => ({
                            orderId: o.id,
                            order: o,
                            originHubId: null,
                            destHubId: null
                        }))
                    };
                },
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
                findUnique: async (args: any) => {
                    const found = orders.find(o => o.id === args.where.id);
                    if (found) return found;
                    return {
                        id: args.where.id,
                        demand: { weight: 50, volume: 0.5, nfValue: 200, cubedWeight: null, quotedPrice: 100 }
                    };
                },
                update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
                    txLog.push({ model: 'order', action: 'update', args });
                    return { id: args.where.id, ...args.data };
                },
            },
            orderLeg: {
                findFirst: async () => null,
                create: async (args: any) => {
                    txLog.push({ model: 'orderLeg', action: 'create', args });
                    return { id: 'leg-new', ...args.data };
                },
                updateMany: async (args: any) => {
                    txLog.push({ model: 'orderLeg', action: 'updateMany', args });
                    return { count: 2 };
                },
                update: async (args: any) => {
                    txLog.push({ model: 'orderLeg', action: 'update', args });
                    return { id: args.where.orderId_manifestId.orderId, ...args.data };
                },
            },
            orderFreightCalculation: {
                findFirst: async () => null,
            },
            linkPricingAgreement: {
                findFirst: async () => null,
            },
            hubCommissionAgreement: {
                findFirst: async () => null,
            },
            orderHistory: {
                create: async (args: { data: Record<string, unknown> }) => {
                    txLog.push({ model: 'orderHistory', action: 'create', args });
                    return { id: 'oh', ...args.data };
                },
            },
            admin: {
                findFirst: async () => ({ id: 'admin-1' }),
            },
            consolidationFeedback: {
                create: async (args: any) => {
                    txLog.push({ model: 'consolidationFeedback', action: 'create', args });
                    return { id: 'cf' };
                }
            }
        };
    }

    it('assertOperationalTripType rejects REGIONAL_DISTRIBUTION', () => {
        assert.throws(
            () => assertOperationalTripType('REGIONAL_DISTRIBUTION'),
            (err: unknown) => err instanceof AppError && err.statusCode === 400
        );
    });

    it('assertOperationalTripType accepts transfer followed by delivery', () => {
        assert.equal(assertOperationalTripType('TRANSFER_DELIVERY'), 'TRANSFER_DELIVERY');
    });

    it('completeManifest TRANSFER sets AT_HUB on orders', async () => {
        txLog.length = 0;
        let linkUpdateCalls = 0;

        const manifestWithLegs = {
            ...baseManifest,
            legs: orders.map(o => ({
                orderId: o.id,
                order: o,
            }))
        };

        prisma.manifest.findUnique = (async () => manifestWithLegs) as unknown as typeof prisma.manifest.findUnique;
        prisma.$transaction = (async (fn: unknown) => {
            if (typeof fn === 'function') return fn(mockTx());
            throw new Error('batch transaction not mocked');
        }) as unknown as typeof prisma.$transaction;
        prisma.link.update = (async () => {
            linkUpdateCalls += 1;
            return { id: linkId, deliveryCount: 0 };
        }) as unknown as typeof prisma.link.update;

        await completeManifest(manifestId, { userId: 'admin-user-id', role: 'ADMIN', adminId: 'admin-1' });

        const orderUpdates = txLog.filter((o) => o.model === 'order' && o.action === 'update');
        assert.equal(orderUpdates.length, 2);
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

        const orderHistories = txLog.filter((o) => o.model === 'orderHistory');
        assert.ok(orderHistories.length >= 2);
    });

    it('syncs order.manifestId and creates leg', async () => {
        const draftManifestId = 'man-draft';
        const orderId = 'ord-1';
        const txAddLog: Array<{ model: string; data: Record<string, unknown> }> = [];

        prisma.manifest.findUnique = (async (args: { where: { id: string } }) => {
            if (args.where.id !== draftManifestId) return null;
            return {
                id: draftManifestId,
                status: 'DRAFT',
                tripType: 'TRANSFER',
                hubId: originHubId,
                totalWeight: 50,
                totalVolume: 0.5,
                totalValue: 200,
                vehicleType: { maxWeight: 5000, maxVolume: 50, maxValue: 500_000 },
                destHub: { code: 'IMP-MA' },
                legs: [],
            };
        }) as unknown as typeof prisma.manifest.findUnique;

        prisma.order.findUnique = (async () => ({
            id: orderId,
            manifestId: null,
            status: 'AT_HUB',
            currentHubId: originHubId,
            demand: {
                weight: 50,
                volume: 0.5,
                nfValue: 200,
                cubedWeight: null,
                expectedHubId: originHubId,
            }
        })) as unknown as typeof prisma.order.findUnique;

        prisma.demand.findFirst = (async () => null) as unknown as typeof prisma.demand.findFirst;
        prisma.order.findFirst = (async () => null) as unknown as typeof prisma.order.findFirst;

        (prisma as any).orderLeg = {
            findUnique: async () => null,
            findFirst: async () => null,
        };

        prisma.$transaction = (async (fn: unknown) => {
            if (typeof fn !== 'function') throw new Error('batch not mocked');
            const tx = {
                order: {
                    findUnique: async () => ({
                        id: orderId,
                        demand: { weight: 50, volume: 0.5, nfValue: 200, cubedWeight: null, quotedPrice: 100 }
                    }),
                    update: async ({ data }: { data: Record<string, unknown> }) => {
                        txAddLog.push({ model: 'order', data });
                        return data;
                    },
                },
                orderLeg: {
                    findFirst: async () => null,
                    create: async ({ data }: any) => {
                        txAddLog.push({ model: 'orderLeg', data });
                        return { id: 'leg-1', ...data };
                    },
                    update: async ({ data }: any) => {
                        return { id: 'leg-1', ...data };
                    }
                },
                manifest: {
                    findUnique: async () => ({
                        id: draftManifestId,
                        status: 'DRAFT',
                        tripType: 'TRANSFER',
                        totalWeight: 50,
                        totalVolume: 0.5,
                        totalValue: 200,
                        vehicleType: { maxWeight: 5000, maxVolume: 50, code: 'TRUCK' },
                        destHub: { code: 'IMP-MA' },
                        legs: [],
                    }),
                    update: async ({ data }: { data: Record<string, unknown> }) => data,
                },
                orderFreightCalculation: {
                    findFirst: async () => null,
                },
                linkPricingAgreement: {
                    findFirst: async () => null,
                },
                hubCommissionAgreement: {
                    findFirst: async () => null,
                },
                orderHistory: {
                    create: async ({ data }: { data: Record<string, unknown> }) => {
                        txAddLog.push({ model: 'orderHistory', data });
                        return data;
                    },
                },
                admin: {
                    findFirst: async () => ({ id: 'admin-1' }),
                },
                consolidationFeedback: {
                    create: async () => ({}),
                }
            };
            return fn(tx);
        }) as unknown as typeof prisma.$transaction;

        await addOrderToManifest(draftManifestId, orderId, { userId: 'admin-user-id', role: 'ADMIN', adminId: 'admin-1' });

        const orderUpdate = txAddLog.find((o) => o.model === 'order');
        assert.ok(orderUpdate);
        assert.equal(orderUpdate!.data.manifestId, draftManifestId);

        const legCreate = txAddLog.find((o) => o.model === 'orderLeg');
        assert.ok(legCreate);
        assert.equal(legCreate!.data.manifestId, draftManifestId);

        const history = txAddLog.find((o) => o.model === 'orderHistory');
        assert.ok(history);
        assert.equal(history!.data.eventType, 'NOTE');
        assert.match(String(history!.data.description), /manifesto man-draft/);
        assert.match(String(history!.data.description), /IMP-MA/);
    });

    it('uses OUT_FOR_DELIVERY for DELIVERY trip on start', async () => {
        const deliveryManifestId = 'man-delivery';
        const txStartLog: TxOp[] = [];

        const manifestWithLegs = {
            id: deliveryManifestId,
            status: 'ACCEPTED',
            tripType: 'DELIVERY',
            origin: 'A',
            destination: 'B',
            destHubId: null,
            destHub: null,
            legs: [
                {
                    orderId: 'o1',
                    order: { id: 'o1', nfNumber: '123', status: 'PENDING' }
                }
            ]
        };

        prisma.manifest.findUnique = (async () => departureReadyManifest(manifestWithLegs)) as unknown as typeof prisma.manifest.findUnique;
        (prisma as any).orderLeg = {
            findFirst: async () => null,
            findMany: async () => [authorizedCteLegFixture('o1')],
        };
        prisma.manifestFiscalDocument.findMany = (async () => [authorizedMdfeFixture]) as unknown as typeof prisma.manifestFiscalDocument.findMany;

        prisma.$transaction = (async (fn: unknown) => {
            if (typeof fn !== 'function') throw new Error('batch not mocked');
            const tx = {
                manifest: {
                    update: async (args: { data: Record<string, unknown> }) => {
                        txStartLog.push({ model: 'manifest', action: 'update', args });
                        return args.data;
                    },
                },
                order: {
                    update: async (args: { data: Record<string, unknown> }) => {
                        txStartLog.push({ model: 'order', action: 'update', args });
                        return args.data;
                    },
                },
                orderLeg: {
                    updateMany: async (args: any) => {
                        txStartLog.push({ model: 'orderLeg', action: 'updateMany', args });
                        return { count: 1 };
                    }
                },
                manifestStop: {
                    updateMany: async (args: any) => {
                        txStartLog.push({ model: 'manifestStop', action: 'updateMany', args });
                        return { count: 0 };
                    }
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

        const orderUpdate = txStartLog.find((o) => o.model === 'order');
        assert.equal(
            (orderUpdate?.args.data as Record<string, unknown> | undefined)?.status,
            'OUT_FOR_DELIVERY'
        );
    });

    it('consolidation by HUB writes ConsolidationFeedback with actorRole=HUB, actorUserId, and adminId=null', async () => {
        const draftManifestId = 'man-draft-hub';
        const orderId = 'ord-hub-1';
        const txAddLog: Array<{ model: string; data: Record<string, unknown> }> = [];

        prisma.manifest.findUnique = (async (args: any) => ({
            id: draftManifestId,
            status: 'DRAFT',
            tripType: 'TRANSFER',
            hubId: originHubId,
            totalWeight: 50,
            totalVolume: 0.5,
            totalValue: 200,
            vehicleType: { maxWeight: 5000, maxVolume: 50, code: 'TRUCK' },
            destHub: { code: 'IMP-MA' },
            legs: [],
        })) as any;

        prisma.order.findUnique = (async () => ({
            id: orderId,
            manifestId: null,
            status: 'AT_HUB',
            currentHubId: originHubId,
            demand: { weight: 50, volume: 0.5, nfValue: 200, cubedWeight: null, expectedHubId: originHubId }
        })) as any;

        (prisma as any).orderLeg = {
            findUnique: async () => null,
            findFirst: async () => null,
        };

        prisma.$transaction = (async (fn: any) => {
            const tx = {
                order: {
                    findUnique: async () => ({
                        id: orderId,
                        demand: { weight: 50, volume: 0.5, nfValue: 200, cubedWeight: null, quotedPrice: 100 }
                    }),
                    update: async ({ data }: any) => data,
                },
                orderLeg: {
                    findFirst: async () => null,
                    create: async ({ data }: any) => ({ id: 'leg-1', ...data }),
                    update: async ({ data }: any) => data,
                },
                manifest: {
                    findUnique: async () => ({
                        id: draftManifestId,
                        status: 'DRAFT',
                        tripType: 'TRANSFER',
                        totalWeight: 50,
                        totalVolume: 0.5,
                        totalValue: 200,
                        vehicleType: { maxWeight: 5000, maxVolume: 50, code: 'TRUCK' },
                        destHub: { code: 'IMP-MA' },
                        legs: [],
                    }),
                    update: async ({ data }: any) => data,
                },
                orderHistory: {
                    create: async ({ data }: any) => data,
                },
                orderFreightCalculation: {
                    findFirst: async () => null,
                },
                linkPricingAgreement: {
                    findFirst: async () => null,
                },
                hubCommissionAgreement: {
                    findFirst: async () => null,
                },
                admin: {
                    findFirst: async () => null, // Should not be queried
                },
                consolidationFeedback: {
                    create: async ({ data }: any) => {
                        txAddLog.push({ model: 'consolidationFeedback', data });
                        return { id: 'cf' };
                    }
                }
            };
            return fn(tx);
        }) as any;

        await addOrderToManifest(draftManifestId, orderId, { userId: 'hub-user-id', role: 'HUB' });

        const feedback = txAddLog.find(o => o.model === 'consolidationFeedback');
        assert.ok(feedback);
        assert.equal(feedback!.data.actorUserId, 'hub-user-id');
        assert.equal(feedback!.data.actorRole, 'HUB');
        assert.equal(feedback!.data.adminId, null);
    });
});
