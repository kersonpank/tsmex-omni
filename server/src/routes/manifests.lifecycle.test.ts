/**
 * Fluxo TRANSFER SP-GRU → IMP-MA (12 asserts do PR001) via manifestLifecycle + mocks Prisma.
 */
import assert from 'node:assert/strict';
import type { ManifestStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import {
    addOrderToManifest,
    completeManifest,
    startManifest,
} from '../services/manifestLifecycle.js';

describe('manifests lifecycle TRANSFER E2E (mocked)', () => {
    const hubSpGru = 'hub-sp-gru-id';
    const hubImpMa = 'hub-imp-ma-id';
    const manifestId = 'mf-transfer-e2e';
    const demandIds = ['dem-e2e-1', 'dem-e2e-2'];
    const orderIds = ['ord-e2e-1', 'ord-e2e-2'];
    const vehicleTypeId = 'vt-truck';

    const store = {
        manifest: {
            id: manifestId,
            status: 'ACCEPTED' as ManifestStatus,
            tripType: 'TRANSFER' as const,
            origin: 'Guarulhos, SP',
            destination: 'Imperatriz, MA',
            hubId: hubSpGru,
            destHubId: hubImpMa,
            linkId: 'link-e2e',
            totalWeight: 0,
            totalVolume: 0,
            totalValue: 0,
            vehicleTypeId,
            demands: [] as Array<{ id: string; weight: number; volume: number; nfValue: number; cubedWeight: number | null }>,
            legs: [] as any[],
        },
        demands: new Map(
            demandIds.map((id, i) => [
                id,
                {
                    id,
                    weight: 100 + i * 10,
                    volume: 1,
                    nfValue: 500,
                    cubedWeight: null,
                    status: 'CONVERTED',
                },
            ])
        ),
        orders: new Map(
            orderIds.map((id, i) => [
                id,
                {
                    id,
                    demandId: demandIds[i],
                    manifestId: null as string | null,
                    status: 'PENDING',
                    currentHubId: null as string | null,
                    enteredAtHubAt: null as Date | null,
                    demand: {
                        weight: 100 + i * 10,
                        volume: 1,
                        nfValue: 500,
                        cubedWeight: null,
                    }
                },
            ])
        ),
        orderLegs: new Map<string, any>(),
        demandEvents: [] as Array<{ demandId: string; status: string }>,
        orderHistories: [] as Array<{ orderId: string; eventType: string }>,
        linkDeliveryCount: 0,
    };

    const vehicleType = { maxWeight: 20000, maxVolume: 100, maxValue: 2_000_000 };

    const original = {
        manifestFindUnique: prisma.manifest.findUnique.bind(prisma.manifest),
        demandFindUnique: prisma.demand.findUnique.bind(prisma.demand),
        demandFindFirst: prisma.demand.findFirst.bind(prisma.demand),
        orderFindUnique: prisma.order.findUnique.bind(prisma.order),
        orderFindFirst: prisma.order.findFirst.bind(prisma.order),
        orderFindMany: prisma.order.findMany.bind(prisma.order),
        orderLegFindUnique: (prisma as any).orderLeg?.findUnique?.bind((prisma as any).orderLeg),
        orderLegFindFirst: (prisma as any).orderLeg?.findFirst?.bind((prisma as any).orderLeg),
        transaction: prisma.$transaction.bind(prisma),
        linkUpdate: prisma.link.update.bind(prisma.link),
    };

    function buildTx() {
        return {
            demand: {
                update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
                    const d = store.demands.get(where.id);
                    if (d) Object.assign(d, data);
                    return d;
                },
            },
            order: {
                findUnique: async ({ where }: any) => {
                    return store.orders.get(where.id) || null;
                },
                update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
                    const o = store.orders.get(where.id);
                    if (o) Object.assign(o, data);
                    return o;
                },
                updateMany: async ({ where, data }: { where: { demandId: string }; data: Record<string, unknown> }) => {
                    for (const o of store.orders.values()) {
                        if (o.demandId === where.demandId) Object.assign(o, data);
                    }
                    return { count: 1 };
                },
            },
            manifest: {
                findUnique: async () => {
                    return {
                        ...store.manifest,
                        vehicleType,
                        destHub: { id: hubImpMa, code: 'IMP-MA' },
                    };
                },
                update: async ({ data }: { data: Record<string, unknown> }) => {
                    Object.assign(store.manifest, data);
                    return store.manifest;
                },
            },
            orderLeg: {
                findFirst: async () => null,
                create: async ({ data }: any) => {
                    const id = `leg-${Math.random()}`;
                    const leg = { id, ...data };
                    store.orderLegs.set(id, leg);
                    store.manifest.legs.push({
                        ...leg,
                        order: store.orders.get(leg.orderId)
                    });
                    return leg;
                },
                delete: async ({ where }: any) => {
                    const orderId = where.orderId_manifestId?.orderId;
                    const manifestId = where.orderId_manifestId?.manifestId;
                    for (const [id, leg] of store.orderLegs.entries()) {
                        if (leg.orderId === orderId && leg.manifestId === manifestId) {
                            store.orderLegs.delete(id);
                        }
                    }
                    store.manifest.legs = store.manifest.legs.filter(
                        l => !(l.orderId === orderId && l.manifestId === manifestId)
                    );
                    return {};
                },
                updateMany: async () => {
                    return { count: 1 };
                },
                update: async (args: any) => {
                    return { id: args.where.orderId_manifestId.orderId, ...args.data };
                }
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
            demandEvent: {
                create: async ({ data }: { data: { demandId: string; status: string } }) => {
                    store.demandEvents.push(data);
                    return data;
                },
            },
            orderHistory: {
                create: async ({ data }: { data: { orderId: string; eventType: string } }) => {
                    store.orderHistories.push(data);
                    return data;
                },
            },
            admin: {
                findFirst: async () => ({ id: 'admin-1' }),
            },
            consolidationFeedback: {
                create: async (args: any) => {
                    return { id: 'cf' };
                },
            }
        };
    }

    function installPrismaMocks() {
        prisma.manifest.findUnique = (async () => ({
            ...store.manifest,
            vehicleType,
            destHub: { id: hubImpMa, code: 'IMP-MA' },
        })) as unknown as typeof prisma.manifest.findUnique;

        prisma.demand.findUnique = (async (args: { where: { id: string } }) => {
            const d = store.demands.get(args.where.id);
            if (!d) return null;
            const order = [...store.orders.values()].find((o) => o.demandId === d.id);
            return { ...d, order: order ? { id: order.id } : null };
        }) as unknown as typeof prisma.demand.findUnique;

        prisma.order.findUnique = (async (args: { where: { id: string } }) => {
            return store.orders.get(args.where.id) || null;
        }) as unknown as typeof prisma.order.findUnique;

        prisma.demand.findFirst = (async () => null) as unknown as typeof prisma.demand.findFirst;
        prisma.order.findFirst = (async () => null) as unknown as typeof prisma.order.findFirst;

        (prisma as any).orderLeg = {
            findUnique: async () => null,
            findFirst: async () => null,
        };

        prisma.order.findMany = (async (args: { where?: { manifestId?: string } }) => {
            if (!args.where?.manifestId) return [];
            return [...store.orders.values()].filter((o) => o.manifestId === args.where!.manifestId);
        }) as unknown as typeof prisma.order.findMany;

        prisma.$transaction = (async (fn: unknown) => {
            if (typeof fn === 'function') return fn(buildTx());
            throw new Error('batch tx not used');
        }) as unknown as typeof prisma.$transaction;

        prisma.link.update = (async (args: { data: { deliveryCount?: { increment: number } } }) => {
            if (args.data.deliveryCount?.increment) {
                store.linkDeliveryCount += args.data.deliveryCount.increment;
            }
            return { id: 'link-e2e', deliveryCount: store.linkDeliveryCount };
        }) as unknown as typeof prisma.link.update;
    }

    function restorePrismaMocks() {
        prisma.manifest.findUnique = original.manifestFindUnique;
        prisma.demand.findUnique = original.demandFindUnique;
        prisma.demand.findFirst = original.demandFindFirst;
        prisma.order.findUnique = original.orderFindUnique;
        prisma.order.findFirst = original.orderFindFirst;
        prisma.order.findMany = original.orderFindMany;
        prisma.$transaction = original.transaction;
        prisma.link.update = original.linkUpdate;
        if (original.orderLegFindUnique) {
            (prisma as any).orderLeg.findUnique = original.orderLegFindUnique;
        }
        if (original.orderLegFindFirst) {
            (prisma as any).orderLeg.findFirst = original.orderLegFindFirst;
        }
    }

    beforeEach(() => installPrismaMocks());
    afterEach(() => restorePrismaMocks());

    it('TRANSFER flow: create context, add 2 orders, start, complete — 12 checks', async () => {
        store.manifest.status = 'DRAFT';
        store.manifest.demands = [];
        store.manifest.legs = [];
        store.orderLegs.clear();
        store.demandEvents = [];
        store.orderHistories = [];
        store.linkDeliveryCount = 0;

        // 1–2: manifesto TRANSFER SP-GRU → IMP-MA (contexto)
        assert.equal(store.manifest.tripType, 'TRANSFER');
        assert.equal(store.manifest.destHubId, hubImpMa);
        assert.equal(store.manifest.hubId, hubSpGru);

        // 3–4: adicionar 2 pedidos ao manifesto
        for (const orderId of orderIds) {
            store.manifest.status = 'DRAFT';
            prisma.manifest.findUnique = (async () => ({
                ...store.manifest,
                vehicleType,
                destHub: { id: hubImpMa, code: 'IMP-MA' },
            })) as unknown as typeof prisma.manifest.findUnique;
            await addOrderToManifest(manifestId, orderId, { userId: 'admin-user-id', role: 'ADMIN', adminId: 'admin-1' });
            const o = store.orders.get(orderId)!;
            assert.equal(o.manifestId, manifestId);
            const leg = [...store.orderLegs.values()].find((l) => l.orderId === orderId && l.manifestId === manifestId);
            assert.ok(leg);
        }

        // 5–6: iniciar
        store.manifest.status = 'ACCEPTED';
        prisma.manifest.findUnique = (async () => ({
            ...store.manifest,
            vehicleType,
            destHub: { id: hubImpMa, code: 'IMP-MA' },
        })) as unknown as typeof prisma.manifest.findUnique;

        await startManifest(manifestId);
        for (const orderId of orderIds) {
            assert.equal(store.orders.get(orderId)!.status, 'IN_TRANSIT');
        }

        // 7–11: concluir
        store.manifest.status = 'IN_PROGRESS';
        await completeManifest(manifestId, { userId: 'admin-user-id', role: 'ADMIN', adminId: 'admin-1' });

        assert.equal(store.manifest.status, 'COMPLETED');
        for (const orderId of orderIds) {
            const o = store.orders.get(orderId)!;
            assert.equal(o.status, 'AT_HUB');
            assert.notEqual(o.status, 'DELIVERED');
            assert.equal(o.currentHubId, hubImpMa);
        }

        // 12: eventos
        assert.ok(store.orderHistories.length >= 2);
        assert.equal(store.linkDeliveryCount, 0);
    });
});
