import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import prisma from '../lib/prisma.js';
import { syncDemandFromInvoices } from './orders.js';

describe('syncDemandFromInvoices — sincroniza Demand a partir das OrderInvoice do pedido', () => {
    const original = {
        orderFindUnique: prisma.order.findUnique,
        demandUpdate: prisma.demand.update,
    };

    let lastDemandUpdateArgs: any = null;

    function mockOrder(overrides: Partial<{ demand: any; invoicesRel: any[] }> = {}) {
        prisma.order.findUnique = (async (_args: any) => ({
            id: 'order-1',
            demandId: 'demand-1',
            demand: overrides.demand === undefined ? { id: 'demand-1' } : overrides.demand,
            invoicesRel: overrides.invoicesRel ?? [],
        })) as any;
    }

    function mockOrderNotFound() {
        prisma.order.findUnique = (async (_args: any) => null) as any;
    }

    beforeEach(() => {
        lastDemandUpdateArgs = null;
        prisma.demand.update = (async (args: any) => {
            lastDemandUpdateArgs = args;
            return { id: args.where.id, ...args.data };
        }) as any;
    });

    afterEach(() => {
        prisma.order.findUnique = original.orderFindUnique;
        prisma.demand.update = original.demandUpdate;
    });

    it('happy path: soma weight/units/volume/cubedWeight/nfValue de 2 invoices', async () => {
        mockOrder({
            invoicesRel: [
                { weight: 10, volumes: 2, cubedVolume: 1.5, value: 100 },
                { weight: 15, volumes: 3, cubedVolume: 2.0, value: 200 },
            ],
        });

        await syncDemandFromInvoices('order-1');

        assert.ok(lastDemandUpdateArgs, 'esperava que prisma.demand.update tivesse sido chamado');
        assert.equal(lastDemandUpdateArgs.where.id, 'demand-1');
        assert.equal(lastDemandUpdateArgs.data.weight, 25);
        assert.equal(lastDemandUpdateArgs.data.units, 5);
        assert.equal(lastDemandUpdateArgs.data.volume, 3.5);
        assert.equal(lastDemandUpdateArgs.data.cubedWeight, 1050); // 3.5 * 300
        assert.equal(lastDemandUpdateArgs.data.nfValue, 300);
    });

    it('zero-guard: invoice com campos zerados não deve zerar Demand — campo fica ausente do payload', async () => {
        mockOrder({
            invoicesRel: [
                { weight: 0, volumes: 0, cubedVolume: null, value: 0 },
            ],
        });

        await syncDemandFromInvoices('order-1');

        // Todos os totais são 0 -> updateData fica vazio -> update nem deve ser chamado
        assert.equal(lastDemandUpdateArgs, null, 'esperava que prisma.demand.update NÃO fosse chamado quando todos os totais são 0');
    });

    it('zero-guard parcial: só os campos com total > 0 entram no payload de update', async () => {
        mockOrder({
            invoicesRel: [
                { weight: 12, volumes: 0, cubedVolume: null, value: 0 },
            ],
        });

        await syncDemandFromInvoices('order-1');

        assert.ok(lastDemandUpdateArgs, 'esperava chamada a prisma.demand.update pois weight > 0');
        assert.equal(lastDemandUpdateArgs.data.weight, 12);
        assert.ok(!('units' in lastDemandUpdateArgs.data), 'units não deveria estar no payload (total = 0)');
        assert.ok(!('volume' in lastDemandUpdateArgs.data), 'volume não deveria estar no payload (total = 0)');
        assert.ok(!('cubedWeight' in lastDemandUpdateArgs.data), 'cubedWeight não deveria estar no payload (total = 0)');
        assert.ok(!('nfValue' in lastDemandUpdateArgs.data), 'nfValue não deveria estar no payload (total = 0)');
    });

    it('sem invoices: demand.update não deve ser chamado', async () => {
        mockOrder({ invoicesRel: [] });

        await syncDemandFromInvoices('order-1');

        assert.equal(lastDemandUpdateArgs, null, 'esperava que prisma.demand.update NÃO fosse chamado sem invoices');
    });

    it('fator de cubagem: cubedVolume 2.5 m³ -> volume: 2.5 e cubedWeight: 750 (2.5 * 300)', async () => {
        mockOrder({
            invoicesRel: [
                { weight: 0, volumes: 0, cubedVolume: 2.5, value: 0 },
            ],
        });

        await syncDemandFromInvoices('order-1');

        assert.ok(lastDemandUpdateArgs);
        assert.equal(lastDemandUpdateArgs.data.volume, 2.5);
        assert.equal(lastDemandUpdateArgs.data.cubedWeight, 750);
    });

    it('order não encontrado: retorna sem lançar e sem chamar demand.update', async () => {
        mockOrderNotFound();

        await assert.doesNotReject(() => syncDemandFromInvoices('order-inexistente'));

        assert.equal(lastDemandUpdateArgs, null, 'esperava que prisma.demand.update NÃO fosse chamado quando order não existe');
    });
});
