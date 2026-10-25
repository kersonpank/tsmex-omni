import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import prisma from '../lib/prisma.js';
import { distributeVolume, packagesVolumeM3, setOrderPackages } from './orderPackages.js';

describe('packagesVolumeM3', () => {
    it('soma qtd × C×L×A / 1e6 com 3 casas', () => {
        assert.equal(packagesVolumeM3([{ quantity: 10, lengthCm: 50, widthCm: 40, heightCm: 30 }]), 0.6);
        assert.equal(
            packagesVolumeM3([
                { quantity: 2, lengthCm: 100, widthCm: 100, heightCm: 100 },
                { quantity: 1, lengthCm: 33, widthCm: 33, heightCm: 33 },
            ]),
            2.036,
        );
        assert.equal(packagesVolumeM3([]), 0);
    });
});

describe('distributeVolume', () => {
    it('uma NF recebe tudo; várias proporcionais ao peso, soma exata', () => {
        assert.deepEqual(distributeVolume(1, [10]), [1]);
        const parts = distributeVolume(1, [30, 10, 10]);
        assert.deepEqual(parts, [0.6, 0.2, 0.2]);
        assert.equal(distributeVolume(1, [0, 0, 0]).reduce((a, b) => a + b, 0).toFixed(3), '1.000');
    });
});

describe('setOrderPackages', () => {
    const orig = {
        tx: prisma.$transaction,
        calcs: prisma.orderFreightCalculation.findMany,
        pkgs: prisma.orderPackage.findMany,
    };
    afterEach(() => {
        prisma.$transaction = orig.tx;
        prisma.orderFreightCalculation.findMany = orig.calcs;
        prisma.orderPackage.findMany = orig.pkgs;
    });

    it('substitui volumes e propaga m³ para NF, collectionData e Demand', async () => {
        const calls: Record<string, any> = {};
        const tx: any = {
            order: {
                findUnique: async () => ({
                    id: 'o1',
                    collectionData: { weight: 5 },
                    demand: { id: 'd1' },
                    invoicesRel: [{ id: 'i1', weight: 10 }],
                }),
                update: async (a: any) => (calls.order = a),
            },
            orderPackage: { deleteMany: async () => (calls.del = true), createMany: async (a: any) => (calls.create = a) },
            orderInvoice: { update: async (a: any) => (calls.inv = a) },
            demand: { update: async (a: any) => (calls.demand = a) },
        };
        prisma.$transaction = (async (fn: any) => fn(tx)) as any;
        prisma.orderFreightCalculation.findMany = (async () => []) as any;
        prisma.orderPackage.findMany = (async () => []) as any;

        const r = await setOrderPackages('o1', [{ quantity: 10, lengthCm: 50, widthCm: 40, heightCm: 30 }]);
        assert.equal(r.volumeM3, 0.6);
        assert.equal(calls.create.data.length, 1);
        assert.equal(calls.inv.data.cubedVolume, 0.6);
        assert.equal(calls.order.data.collectionData.cubedVolume, 0.6);
        assert.equal(calls.order.data.collectionData.weight, 5);
        assert.equal(calls.demand.data.volume, 0.6);
        assert.equal(calls.demand.data.cubedWeight, 180);
    });

    it('atalho m³ total sem volumes; rejeita zero', async () => {
        const calls: Record<string, any> = {};
        const tx: any = {
            order: { findUnique: async () => ({ id: 'o1', collectionData: null, demand: null, invoicesRel: [] }), update: async (a: any) => (calls.order = a) },
            orderPackage: { deleteMany: async () => {}, createMany: async () => { calls.created = true; } },
            orderInvoice: { update: async () => {} },
            demand: { update: async () => {} },
        };
        prisma.$transaction = (async (fn: any) => fn(tx)) as any;
        prisma.orderFreightCalculation.findMany = (async () => []) as any;
        prisma.orderPackage.findMany = (async () => []) as any;
        const r = await setOrderPackages('o1', null, 2.5);
        assert.equal(r.volumeM3, 2.5);
        assert.equal(calls.created, undefined);
        assert.equal(calls.order.data.collectionData.cubedVolume, 2.5);
        await assert.rejects(() => setOrderPackages('o1', null, 0));
    });
});
