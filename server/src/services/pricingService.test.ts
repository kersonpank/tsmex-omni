import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import {
    getOrderFreightValue,
    calculateLinkCost,
    calculateLegHubCost,
    allocateLegCosts,
    getManifestMargin
} from './pricingService.js';

const prismaSnapshot = {
    orderFreightCalculationFindFirst: prisma.orderFreightCalculation.findFirst.bind(prisma.orderFreightCalculation),
    orderFindUnique: prisma.order.findUnique.bind(prisma.order),
    manifestFindUnique: prisma.manifest.findUnique.bind(prisma.manifest),
    linkPricingAgreementFindFirst: prisma.linkPricingAgreement.findFirst.bind(prisma.linkPricingAgreement),
    hubCommissionAgreementFindFirst: prisma.hubCommissionAgreement.findFirst.bind(prisma.hubCommissionAgreement),
    orderLegUpdate: prisma.orderLeg.update.bind(prisma.orderLeg),
    transaction: prisma.$transaction.bind(prisma),
};

function restorePrismaMocks() {
    prisma.orderFreightCalculation.findFirst = prismaSnapshot.orderFreightCalculationFindFirst;
    prisma.order.findUnique = prismaSnapshot.orderFindUnique;
    prisma.manifest.findUnique = prismaSnapshot.manifestFindUnique;
    prisma.linkPricingAgreement.findFirst = prismaSnapshot.linkPricingAgreementFindFirst;
    prisma.hubCommissionAgreement.findFirst = prismaSnapshot.hubCommissionAgreementFindFirst;
    prisma.orderLeg.update = prismaSnapshot.orderLegUpdate;
    prisma.$transaction = prismaSnapshot.transaction;
}

describe('pricingService', () => {
    beforeEach(() => restorePrismaMocks());
    afterEach(() => restorePrismaMocks());

    describe('getOrderFreightValue', () => {
        it('should return freightTotal from OrderFreightCalculation if available and > 0', async () => {
            prisma.orderFreightCalculation.findFirst = (async () => ({
                freightTotal: 550.00
            })) as any;

            const val = await getOrderFreightValue('some-order-id');
            assert.equal(val, 550.00);
        });

        it('should fallback to demand.quotedPrice if OrderFreightCalculation not found or 0', async () => {
            prisma.orderFreightCalculation.findFirst = (async () => null) as any;
            prisma.order.findUnique = (async () => ({
                id: 'some-order-id',
                demand: { quotedPrice: 320.00 }
            })) as any;

            const val = await getOrderFreightValue('some-order-id');
            assert.equal(val, 320.00);
        });
    });

    describe('calculateLinkCost', () => {
        it('should return 0 if manifest has no linkId', async () => {
            prisma.manifest.findUnique = (async () => ({
                id: 'man-1',
                linkId: null
            })) as any;

            const cost = await calculateLinkCost('man-1');
            assert.equal(cost, 0);
        });

        it('should return null (not 0) if manifest has linkId but no LinkPricingAgreement matches', async () => {
            // BRIEF 2 TEST
            prisma.manifest.findUnique = (async () => ({
                id: 'man-1',
                linkId: 'link-123',
                origin: 'SÃO PAULO',
                destination: 'IMPERATRIZ',
                vehicleType: { code: 'TRUCK' }
            })) as any;
            prisma.linkPricingAgreement.findFirst = (async () => null) as any;

            const cost = await calculateLinkCost('man-1');
            assert.equal(cost, null);
        });

        it('should respect FLAT costMode correctly', async () => {
            // BRIEF 3 TEST
            prisma.manifest.findUnique = (async () => ({
                id: 'man-1',
                linkId: 'link-123',
                origin: 'SÃO PAULO',
                destination: 'IMPERATRIZ',
                totalVolume: 10,
                totalWeight: 1000,
                vehicleType: { code: 'TRUCK' }
            })) as any;
            prisma.linkPricingAgreement.findFirst = (async () => ({
                flatRate: 1500.00,
                ratePerM3: 20.00,
                ratePerKg: 0.50,
                costMode: 'FLAT'
            })) as any;

            const cost = await calculateLinkCost('man-1');
            assert.equal(cost, 1500.00);
        });

        it('should respect PER_M3 costMode correctly', async () => {
            // BRIEF 3 TEST
            prisma.manifest.findUnique = (async () => ({
                id: 'man-1',
                linkId: 'link-123',
                origin: 'SÃO PAULO',
                destination: 'IMPERATRIZ',
                totalVolume: 12.5,
                totalWeight: 1000,
                vehicleType: { code: 'TRUCK' }
            })) as any;
            prisma.linkPricingAgreement.findFirst = (async () => ({
                flatRate: 1500.00,
                ratePerM3: 40.00,
                ratePerKg: 0.50,
                costMode: 'PER_M3'
            })) as any;

            const cost = await calculateLinkCost('man-1');
            assert.equal(cost, 12.5 * 40.00);
        });

        it('should respect PER_KG costMode correctly', async () => {
            // BRIEF 3 TEST
            prisma.manifest.findUnique = (async () => ({
                id: 'man-1',
                linkId: 'link-123',
                origin: 'SÃO PAULO',
                destination: 'IMPERATRIZ',
                totalVolume: 10,
                totalWeight: 800,
                vehicleType: { code: 'TRUCK' }
            })) as any;
            prisma.linkPricingAgreement.findFirst = (async () => ({
                flatRate: 1500.00,
                ratePerM3: 20.00,
                ratePerKg: 1.50,
                costMode: 'PER_KG'
            })) as any;

            const cost = await calculateLinkCost('man-1');
            assert.equal(cost, 800 * 1.50);
        });

        it('should perform robust city string matching by splitting at commas/hyphens', async () => {
            // BRIEF 3 Matching TEST
            prisma.manifest.findUnique = (async () => ({
                id: 'man-1',
                linkId: 'link-123',
                origin: 'Guarulhos, SP',
                destination: 'Imperatriz - MA',
                totalVolume: 10,
                totalWeight: 1000,
                vehicleType: { code: 'TRUCK' }
            })) as any;

            let queriedOrigin = '';
            let queriedDest = '';
            prisma.linkPricingAgreement.findFirst = (async (args: any) => {
                queriedOrigin = args.where.originCity.contains;
                queriedDest = args.where.destinationCity.contains;
                return {
                    flatRate: 1800.00,
                    costMode: 'FLAT'
                };
            }) as any;

            const cost = await calculateLinkCost('man-1');
            assert.equal(cost, 1800.00);
            assert.equal(queriedOrigin, 'Guarulhos');
            assert.equal(queriedDest, 'Imperatriz');
        });
    });

    describe('calculateLegHubCost', () => {
        it('should only charge origin hub if sequence = 1', async () => {
            // BRIEF 1 TEST
            const legSeq1 = {
                orderId: 'ord-1',
                originHubId: 'hub-orig',
                destHubId: 'hub-dest',
                sequence: 1
            };

            const legSeq2 = {
                orderId: 'ord-1',
                originHubId: 'hub-orig',
                destHubId: 'hub-dest',
                sequence: 2
            };

            prisma.hubCommissionAgreement.findFirst = (async (args: any) => {
                if (args.where.hubId === 'hub-orig') {
                    return { handlingFeePerOrder: 50.00, percentOfFreight: 5 }; // 5% of 1000 = 50 -> total 100
                }
                if (args.where.hubId === 'hub-dest') {
                    return { handlingFeePerOrder: 30.00, percentOfFreight: 2 }; // 2% of 1000 = 20 -> total 50
                }
                return null;
            }) as any;

            // sequence 1 charges both origin (100) and dest (50) = 150
            const costSeq1 = await calculateLegHubCost(legSeq1, 1000.00);
            assert.equal(costSeq1, 150.00);

            // sequence 2 does NOT charge origin, only charges dest (50)
            const costSeq2 = await calculateLegHubCost(legSeq2, 1000.00);
            assert.equal(costSeq2, 50.00);
        });

        it('should not charge dest hub if destHubId is null (delivery leg)', async () => {
            // BRIEF 1 TEST
            const legDelivery = {
                orderId: 'ord-1',
                originHubId: 'hub-orig',
                destHubId: null,
                sequence: 2
            };

            prisma.hubCommissionAgreement.findFirst = (async (args: any) => {
                if (args.where.hubId === 'hub-orig') {
                    return { handlingFeePerOrder: 50.00, percentOfFreight: 0 };
                }
                return null;
            }) as any;

            const cost = await calculateLegHubCost(legDelivery, 1000.00);
            assert.equal(cost, 0); // sequence=2 skips origin, destHubId=null skips dest
        });
    });

    describe('allocateLegCosts', () => {
        it('should allocate link share pro-rata based on effective weight (max of weight and cubedWeight)', async () => {
            // BRIEF 6 TEST
            const manifest = {
                id: 'man-1',
                linkId: 'link-1',
                origin: 'SP',
                destination: 'MA',
                totalWeight: 800,
                totalVolume: 40,
                vehicleType: { maxWeight: 1000, maxVolume: 100, code: 'TRUCK' },
                legs: [
                    {
                        orderId: 'ord-1',
                        manifestId: 'man-1',
                        originHubId: null,
                        destHubId: null,
                        sequence: 1,
                        order: {
                            id: 'ord-1',
                            demand: { weight: 100, volume: 10, cubedWeight: 300 } // Cubed weight 300 is effective weight
                        }
                    },
                    {
                        orderId: 'ord-2',
                        manifestId: 'man-1',
                        originHubId: null,
                        destHubId: null,
                        sequence: 1,
                        order: {
                            id: 'ord-2',
                            demand: { weight: 500, volume: 30, cubedWeight: null } // weight 500 is effective weight
                        }
                    }
                ]
            };

            prisma.manifest.findUnique = (async () => manifest) as any;
            prisma.linkPricingAgreement.findFirst = (async () => ({
                flatRate: 1600.00,
                costMode: 'FLAT'
            })) as any;
            prisma.orderFreightCalculation.findFirst = (async () => null) as any;
            prisma.order.findUnique = (async () => ({ demand: { quotedPrice: 100 } })) as any;

            const updates: any[] = [];
            prisma.orderLeg.update = (async (args: any) => {
                updates.push(args);
                return args;
            }) as any;

            await allocateLegCosts('man-1');

            // totalLinkCost = 1600
            // ord-1 effWeight = max(100, 300) = 300
            // ord-2 effWeight = max(500, 0) = 500
            // totalEffWeight = 800
            // ord-1 share = 300/800 = 37.5% -> 600
            // ord-2 share = 500/800 = 62.5% -> 1000
            assert.equal(updates.length, 2);
            const update1 = updates.find(u => u.where.orderId_manifestId.orderId === 'ord-1');
            const update2 = updates.find(u => u.where.orderId_manifestId.orderId === 'ord-2');

            assert.equal(update1.data.allocatedCost, 600);
            assert.equal(update2.data.allocatedCost, 1000);
        });

        it('should leave allocatedCost = null if totalLinkCost is null', async () => {
            // BRIEF 2 TEST
            const manifest = {
                id: 'man-1',
                linkId: 'link-1',
                origin: 'SP',
                destination: 'MA',
                vehicleType: { code: 'TRUCK' },
                legs: [
                    {
                        orderId: 'ord-1',
                        manifestId: 'man-1',
                        sequence: 1,
                        order: { id: 'ord-1', demand: { weight: 100, volume: 10 } }
                    }
                ]
            };

            prisma.manifest.findUnique = (async () => manifest) as any;
            prisma.linkPricingAgreement.findFirst = (async () => null) as any; // No agreement -> link cost is null

            const updates: any[] = [];
            prisma.orderLeg.update = (async (args: any) => {
                updates.push(args);
                return args;
            }) as any;

            await allocateLegCosts('man-1');

            assert.equal(updates.length, 1);
            assert.equal(updates[0].data.allocatedCost, null);
        });
    });

    describe('getManifestMargin', () => {
        it('should correctly rollup margins when costs are complete', async () => {
            const manifest = {
                id: 'man-1',
                linkId: 'link-1',
                origin: 'SP',
                destination: 'MA',
                totalWeight: 1000,
                totalVolume: 10,
                vehicleType: { code: 'TRUCK' },
                legs: [
                    { orderId: 'ord-1', originHubId: 'hub-1', destHubId: null, sequence: 1 },
                    { orderId: 'ord-2', originHubId: null, destHubId: 'hub-2', sequence: 2 }
                ]
            };

            prisma.manifest.findUnique = (async () => manifest) as any;
            prisma.linkPricingAgreement.findFirst = (async () => ({
                flatRate: 1000.00,
                costMode: 'FLAT'
            })) as any;
            prisma.orderFreightCalculation.findFirst = (async (args: any) => {
                if (args.where.orderId === 'ord-1') return { freightTotal: 1200.00 };
                if (args.where.orderId === 'ord-2') return { freightTotal: 800.00 };
                return null;
            }) as any;

            prisma.hubCommissionAgreement.findFirst = (async (args: any) => {
                if (args.where.hubId === 'hub-1') return { handlingFeePerOrder: 50.00, percentOfFreight: 0 };
                if (args.where.hubId === 'hub-2') return { handlingFeePerOrder: 50.00, percentOfFreight: 10 }; // 10% of 800 = 80 -> total 130
                return null;
            }) as any;

            const margin = await getManifestMargin('man-1');
            assert.equal(margin.costComplete, true);
            assert.equal(margin.revenue, 2000.00);
            assert.equal(margin.linkCost, 1000.00);
            assert.equal(margin.hubCost, 180.00); // 50 + 130
            assert.equal(margin.totalCost, 1180.00);
            assert.equal(margin.margin, 820.00);
            assert.equal(margin.marginPercent, 41.00);
        });

        it('should return costComplete = false and null margins if linkId has no agreement', async () => {
            // BRIEF 2 TEST
            const manifest = {
                id: 'man-1',
                linkId: 'link-1',
                origin: 'SP',
                destination: 'MA',
                totalWeight: 1000,
                totalVolume: 10,
                vehicleType: { code: 'TRUCK' },
                legs: [
                    { orderId: 'ord-1', originHubId: 'hub-1', destHubId: null, sequence: 1 }
                ]
            };

            prisma.manifest.findUnique = (async () => manifest) as any;
            prisma.linkPricingAgreement.findFirst = (async () => null) as any; // No agreement
            prisma.orderFreightCalculation.findFirst = (async () => ({ freightTotal: 500.00 })) as any;
            prisma.hubCommissionAgreement.findFirst = (async () => null) as any;

            const margin = await getManifestMargin('man-1');
            assert.equal(margin.costComplete, false);
            assert.equal(margin.linkCost, null);
            assert.equal(margin.totalCost, null);
            assert.equal(margin.margin, null);
            assert.equal(margin.marginPercent, null);
            assert.ok(margin.missing.includes('LinkPricingAgreement not found'));
        });
    });
});
