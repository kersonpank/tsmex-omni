import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import {
    getOrderFreightValue,
    calculateLinkCost,
    calculateLegHubCost,
    allocateLegCosts,
    getManifestMargin,
    getOrderFreightBreakdown,
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

    describe('getOrderFreightBreakdown', () => {
        it('separa bruto, ICMS e líquido do documento oficial, com 2 casas', async () => {
            prisma.orderFreightCalculation.findFirst = (async () => ({ freightTotal: 509.4700000004, icmsValue: 61.14, status: 'CTE_AUTHORIZED' })) as any;
            const b = await getOrderFreightBreakdown('ord-1');
            assert.deepEqual(b, { gross: 509.47, icms: 61.14, net: 448.33, source: 'OFFICIAL' });
        });

        it('só consulta documento oficial primeiro; sem ele o cálculo vivo é estimativa', async () => {
            const seen: any[] = [];
            prisma.orderFreightCalculation.findFirst = (async (args: any) => {
                seen.push(args.where.status);
                return args.where.status.in ? null : { freightTotal: 300, icmsValue: null, status: 'CALCULATED' };
            }) as any;
            const b = await getOrderFreightBreakdown('ord-1');
            assert.equal(b.source, 'ESTIMATE');
            assert.equal(b.net, 300);
            assert.deepEqual(seen[0].in, ['CTE_AUTHORIZED', 'DCE_AUTHORIZED', 'MINUTA_EMITTED']);
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
        type FakeCalc = { orderId: string; status: string; freightTotal: number; icmsValue?: number | null; createdAt?: Date };
        interface FakeManifest {
            id: string;
            linkId?: string | null;
            totalWeight?: number;
            totalVolume?: number;
            freightAgreement?: { id: string; freteBruto: number; pedagio: number } | null;
            legs: Array<{ orderId: string; originHubId?: string | null; destHubId?: string | null; sequence: number; allocatedCost?: number | null }>;
        }

        /** tx falso: várias viagens, cálculos de frete e acordos em memória. */
        function fakeTx(manifests: FakeManifest[], calcs: FakeCalc[], opts: { linkAgreement?: any; hubAgreements?: Record<string, any>; quoted?: Record<string, number> } = {}) {
            const vehicleType = { code: 'TRUCK', maxWeight: 1000, maxVolume: 20 };
            return {
                manifest: {
                    findUnique: async ({ where }: any) => {
                        const m = manifests.find((x) => x.id === where.id);
                        return m ? { origin: 'SP', destination: 'MA', linkId: 'link-1', totalWeight: 0, totalVolume: 0, freightAgreement: null, ...m, vehicleType } : null;
                    },
                },
                orderLeg: {
                    findMany: async ({ where }: any) => manifests.flatMap((m) =>
                        m.legs.filter((l) => where.orderId.in.includes(l.orderId)).map((l) => ({ orderId: l.orderId, manifestId: m.id, sequence: l.sequence, allocatedCost: l.allocatedCost ?? null }))),
                },
                orderFreightCalculation: {
                    findFirst: async ({ where }: any) => {
                        const rows = calcs.filter((c) => c.orderId === where.orderId && c.freightTotal > 0 &&
                            (where.status.in ? where.status.in.includes(c.status) : !where.status.notIn.includes(c.status)));
                        return rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0] ?? null;
                    },
                },
                order: { findUnique: async ({ where }: any) => ({ id: where.id, demand: { quotedPrice: opts.quoted?.[where.id] ?? 0 } }) },
                linkPricingAgreement: { findFirst: async () => opts.linkAgreement ?? null },
                hubCommissionAgreement: { findFirst: async ({ where }: any) => opts.hubAgreements?.[where.hubId] ?? null },
            } as any;
        }

        it('receita é o frete líquido de ICMS do documento oficial; custo e margem fecham', async () => {
            const tx = fakeTx(
                [{ id: 'man-1', totalWeight: 500, totalVolume: 5, legs: [
                    { orderId: 'ord-1', originHubId: 'hub-1', sequence: 1 },
                    { orderId: 'ord-2', destHubId: 'hub-2', sequence: 2 },
                ] }],
                [
                    { orderId: 'ord-1', status: 'CTE_AUTHORIZED', freightTotal: 1200, icmsValue: 200 },
                    { orderId: 'ord-2', status: 'MINUTA_EMITTED', freightTotal: 800, icmsValue: null },
                ],
                {
                    linkAgreement: { flatRate: 1000, costMode: 'FLAT' },
                    hubAgreements: { 'hub-1': { handlingFeePerOrder: 50, percentOfFreight: 0 }, 'hub-2': { handlingFeePerOrder: 50, percentOfFreight: 10 } },
                },
            );
            const m = await getManifestMargin('man-1', tx);
            assert.equal(m.revenueGross, 2000);
            assert.equal(m.icms, 200);
            assert.equal(m.revenueNet, 1800);
            assert.equal(m.revenue, 1800, 'nome antigo aponta para a receita líquida');
            assert.equal(m.revenueEstimated, false);
            assert.equal(m.linkCost, 1000);
            assert.equal(m.hubCost, 180); // 50 + (50 + 10% de 800)
            assert.equal(m.totalCost, 1180);
            assert.equal(m.margin, 620);
            assert.equal(m.marginPercent, 34.44);
            assert.equal(m.costComplete, true);
            assert.equal(m.occupancyWeightPercent, 50);
            assert.equal(m.occupancyVolumePercent, 25);
            assert.equal(m.occupancyPercent, 50);
            assert.equal(m.linkCostSource, 'ACORDO');
        });

        it('pedido com tronco + entrega NÃO conta o frete cheio em cada viagem (soma das viagens = frete do pedido)', async () => {
            const manifests: FakeManifest[] = [
                { id: 'tronco', legs: [{ orderId: 'ord-1', sequence: 1, allocatedCost: 300 }] },
                { id: 'entrega', legs: [{ orderId: 'ord-1', sequence: 2, allocatedCost: 100 }] },
            ];
            const tx = fakeTx(manifests, [{ orderId: 'ord-1', status: 'CTE_AUTHORIZED', freightTotal: 509.47, icmsValue: 61.14 }], { linkAgreement: { flatRate: 0, costMode: 'FLAT' } });
            const a = await getManifestMargin('tronco', tx);
            const b = await getManifestMargin('entrega', tx);
            assert.equal(a.revenueGross + b.revenueGross, 509.47);
            assert.equal(a.icms + b.icms, 61.14);
            assert.equal(Math.round((a.revenueNet + b.revenueNet) * 100) / 100, 448.33);
            assert.ok(a.revenueGross < 509.47 && b.revenueGross < 509.47);
            assert.equal(a.revenueGross, 382.1); // 75% do custo alocado
        });

        it('propriedade: para qualquer número de pernas a soma das receitas das viagens fecha com o frete do pedido', async () => {
            for (const n of [1, 2, 3, 5]) {
                for (const withCosts of [true, false]) {
                    const manifests: FakeManifest[] = Array.from({ length: n }, (_, i) => ({
                        id: `m${i}`,
                        legs: [{ orderId: 'ord-1', sequence: i + 1, allocatedCost: withCosts ? 33.33 + i : null }],
                    }));
                    const tx = fakeTx(manifests, [{ orderId: 'ord-1', status: 'CTE_AUTHORIZED', freightTotal: 1000.01, icmsValue: 120.13 }], { linkAgreement: { flatRate: 0, costMode: 'FLAT' } });
                    const parts = await Promise.all(manifests.map((m) => getManifestMargin(m.id, tx)));
                    const gross = Math.round(parts.reduce((s, p) => s + p.revenueGross * 100, 0));
                    const icms = Math.round(parts.reduce((s, p) => s + p.icms * 100, 0));
                    assert.equal(gross, 100001, `n=${n} custos=${withCosts}`);
                    assert.equal(icms, 12013, `n=${n} custos=${withCosts}`);
                }
            }
        });

        it('sem documento oficial: receita entra como estimativa e fica marcada; rascunho e cancelado não são receita realizada', async () => {
            const tx = fakeTx(
                [{ id: 'man-1', legs: [{ orderId: 'ord-1', sequence: 1 }, { orderId: 'ord-2', sequence: 1 }, { orderId: 'ord-3', sequence: 1 }] }],
                [
                    { orderId: 'ord-1', status: 'CALCULATED', freightTotal: 300, icmsValue: 0 },
                    { orderId: 'ord-2', status: 'CTE_CANCELLED', freightTotal: 999 },
                    { orderId: 'ord-3', status: 'CTE_AUTHORIZED', freightTotal: 100, icmsValue: 10 },
                ],
                { linkAgreement: { flatRate: 0, costMode: 'FLAT' } },
            );
            const m = await getManifestMargin('man-1', tx);
            assert.equal(m.revenueEstimated, true);
            assert.equal(m.ordersWithoutOfficialFreight, 2);
            assert.equal(m.ordersWithoutFreightValue, 1);
            assert.equal(m.revenueRealized, 90);
            assert.equal(m.revenueNet, 390); // 300 estimado + 90 oficial; cancelado não entra
        });

        it('cotação da demanda só entra como estimativa', async () => {
            const tx = fakeTx([{ id: 'man-1', legs: [{ orderId: 'ord-1', sequence: 1 }] }], [], { quoted: { 'ord-1': 250 }, linkAgreement: { flatRate: 0, costMode: 'FLAT' } });
            const m = await getManifestMargin('man-1', tx);
            assert.equal(m.revenueNet, 250);
            assert.equal(m.revenueRealized, 0);
            assert.equal(m.revenueEstimated, true);
        });

        it('Carta Frete real é a fonte do custo do transportador quando existe', async () => {
            const tx = fakeTx(
                [{ id: 'man-1', freightAgreement: { id: 'fa', freteBruto: 700, pedagio: 55.5 }, legs: [{ orderId: 'ord-1', sequence: 1 }] }],
                [{ orderId: 'ord-1', status: 'CTE_AUTHORIZED', freightTotal: 1000, icmsValue: 0 }],
            );
            const m = await getManifestMargin('man-1', tx);
            assert.equal(m.linkCost, 755.5);
            assert.equal(m.linkCostSource, 'CARTA_FRETE');
            assert.equal(m.margin, 244.5);
        });

        it('costComplete = false e margem nula se há transportador sem acordo nem Carta Frete', async () => {
            const tx = fakeTx(
                [{ id: 'man-1', legs: [{ orderId: 'ord-1', originHubId: 'hub-1', sequence: 1 }] }],
                [{ orderId: 'ord-1', status: 'CTE_AUTHORIZED', freightTotal: 500, icmsValue: 0 }],
            );
            const m = await getManifestMargin('man-1', tx);
            assert.equal(m.costComplete, false);
            assert.equal(m.linkCost, null);
            assert.equal(m.totalCost, null);
            assert.equal(m.margin, null);
            assert.equal(m.marginPercent, null);
            assert.equal(m.revenueNet, 500);
            assert.ok(m.missing.includes('LinkPricingAgreement not found'));
        });
    });
});
