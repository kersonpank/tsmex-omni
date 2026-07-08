import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import axios from 'axios';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createIntakeDemand, createIntakeDemandFromNfeKey } from './createIntakeDemand.js';

const CLIENT_ID = '550e8400-e29b-41d4-a716-446655440001';
const HUB_ID = '550e8400-e29b-41d4-a716-446655440002';
const CHAVE44 = '35260512345678000190550010000000012345678901';

describe('createIntakeDemand', () => {
    const store = {
        demands: new Map<string, Record<string, unknown>>(),
        events: [] as Array<{ demandId: string; description: string; status: string }>,
    };

    const original = {
        findFirst: prisma.demand.findFirst.bind(prisma.demand),
        create: prisma.demand.create.bind(prisma.demand),
        update: prisma.demand.update.bind(prisma.demand),
        transaction: prisma.$transaction.bind(prisma),
        eventCreate: prisma.demandEvent.create.bind(prisma.demandEvent),
    };

    beforeEach(() => {
        store.demands.clear();
        store.events = [];

        prisma.demand.findFirst = (async (args: {
            where?: { sourceType?: string; externalReference?: string };
        }) => {
            const st = args?.where?.sourceType;
            const ext = args?.where?.externalReference;
            if (!ext) return null;
            for (const d of store.demands.values()) {
                if (d.sourceType === st && d.externalReference === ext) return d;
            }
            return null;
        }) as unknown as typeof prisma.demand.findFirst;

        prisma.demand.create = (async ({ data }: { data: Record<string, unknown> }) => {
            const id = `dem-${store.demands.size + 1}`;
            const row = { id, ...data, order: null };
            store.demands.set(id, row);
            return row;
        }) as unknown as typeof prisma.demand.create;

        prisma.demand.update = (async ({
            where,
            data,
        }: {
            where: { id: string };
            data: Record<string, unknown>;
        }) => {
            const row = store.demands.get(where.id);
            if (!row) throw new Error('not found');
            Object.assign(row, data);
            return row;
        }) as unknown as typeof prisma.demand.update;

        prisma.demandEvent.create = (async ({ data }: { data: { demandId: string; description: string; status: string } }) => {
            store.events.push(data);
            return { id: 'ev-1', ...data };
        }) as unknown as typeof prisma.demandEvent.create;

        prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) =>
            fn(prisma)) as unknown as typeof prisma.$transaction;
    });

    afterEach(() => {
        prisma.demand.findFirst = original.findFirst;
        prisma.demand.create = original.create;
        prisma.demand.update = original.update;
        prisma.demandEvent.create = original.eventCreate;
        prisma.$transaction = original.transaction;
    });

    it('cria Demand manual AWAITING_ARRIVAL sem Order', async () => {
        const demand = await createIntakeDemand({
            sourceType: 'MANUAL_HUB',
            clientId: CLIENT_ID,
            expectedHubId: HUB_ID,
            origin: 'São Paulo, SP',
            destination: 'Rio de Janeiro, RJ',
            commodity: 'Peças',
            weight: 12,
            volume: 0.5,
            nfNumber: 'NF-100',
            nfValue: 500,
        });

        assert.equal(demand.status, 'AWAITING_ARRIVAL');
        assert.equal(demand.sourceType, 'MANUAL_HUB');
        assert.equal((demand as { order?: unknown }).order ?? null, null);
        assert.ok(store.events.some((e) => e.description.includes('entrada manual')));
    });

    it('cria Demand declaração sem Order', async () => {
        const demand = await createIntakeDemand({
            sourceType: 'DECLARATION',
            clientId: CLIENT_ID,
            expectedHubId: HUB_ID,
            documentType: 'DECLARATION',
            declarationData: { description: 'Roupas usadas' },
            origin: 'Curitiba, PR',
            destination: 'Florianópolis, SC',
            commodity: 'Roupas',
            weight: 5,
            volume: 0.2,
            nfNumber: 'DECL-1',
            nfValue: 200,
        });

        assert.equal(demand.status, 'AWAITING_ARRIVAL');
        assert.equal(demand.sourceType, 'DECLARATION');
        assert.equal(demand.documentType, 'DECLARATION');
    });

    it('idempotência NFE_KEY não cria segunda Demand', async () => {
        const first = await createIntakeDemand({
            sourceType: 'NFE_KEY',
            clientId: CLIENT_ID,
            expectedHubId: HUB_ID,
            documentType: 'NFE',
            documentKey: CHAVE44,
            nfNumber: '12345',
            nfValue: 10,
            origin: 'SP, SP',
            destination: 'A definir',
            commodity: 'A definir',
            weight: 1,
            volume: 0.001,
        });

        const second = await createIntakeDemand({
            sourceType: 'NFE_KEY',
            clientId: CLIENT_ID,
            expectedHubId: HUB_ID,
            documentType: 'NFE',
            documentKey: CHAVE44,
            nfNumber: '12345',
            nfValue: 10,
            origin: 'SP, SP',
            destination: 'A definir',
            commodity: 'A definir',
            weight: 1,
            volume: 0.001,
        });

        assert.equal(first.id, second.id);
        assert.equal(store.demands.size, 1);
    });

    it('Demand terminal com mesma chave → 409 sem reabrir fila', async () => {
        store.demands.set('dem-old', {
            id: 'dem-old',
            sourceType: 'NFE_KEY',
            externalReference: CHAVE44,
            status: 'DELIVERED',
            order: { id: 'ord-1' },
        });

        await assert.rejects(
            () =>
                createIntakeDemand({
                    sourceType: 'NFE_KEY',
                    clientId: CLIENT_ID,
                    expectedHubId: HUB_ID,
                    documentType: 'NFE',
                    documentKey: CHAVE44,
                    nfNumber: '12345',
                    nfValue: 10,
                    origin: 'SP, SP',
                    destination: 'A definir',
                    commodity: 'A definir',
                    weight: 1,
                    volume: 0.001,
                }),
            (err: unknown) => err instanceof AppError && err.statusCode === 409,
        );
    });

    it('idempotência DFE_ACBR (triagem da Distribuição NF-e) não cria segunda Demand', async () => {
        const first = await createIntakeDemand({
            sourceType: 'DFE_ACBR',
            clientId: CLIENT_ID,
            expectedHubId: HUB_ID,
            documentType: 'NFE',
            documentKey: CHAVE44,
            nfNumber: '12345',
            nfValue: 10,
            origin: 'SP, SP',
            destination: 'A definir',
            commodity: 'A definir',
            weight: 1,
            volume: 0.001,
        });

        const second = await createIntakeDemand({
            sourceType: 'DFE_ACBR',
            clientId: CLIENT_ID,
            expectedHubId: HUB_ID,
            documentType: 'NFE',
            documentKey: CHAVE44,
            nfNumber: '12345',
            nfValue: 10,
            origin: 'SP, SP',
            destination: 'A definir',
            commodity: 'A definir',
            weight: 1,
            volume: 0.001,
        });

        assert.equal(first.id, second.id);
        assert.equal(first.sourceType, 'DFE_ACBR');
        assert.equal(store.demands.size, 1);
    });
});

describe('createIntakeDemandFromNfeKey — sourceType', () => {
    const store = {
        demands: new Map<string, Record<string, unknown>>(),
        events: [] as Array<{ demandId: string; description: string; status: string }>,
    };

    const original = {
        findFirst: prisma.demand.findFirst.bind(prisma.demand),
        create: prisma.demand.create.bind(prisma.demand),
        update: prisma.demand.update.bind(prisma.demand),
        eventCreate: prisma.demandEvent.create.bind(prisma.demandEvent),
        transaction: prisma.$transaction.bind(prisma),
        axiosGet: axios.get,
    };

    beforeEach(() => {
        store.demands.clear();
        store.events = [];

        prisma.demand.findFirst = (async (args: { where?: { sourceType?: string; externalReference?: string } }) => {
            const st = args?.where?.sourceType;
            const ext = args?.where?.externalReference;
            if (!ext) return null;
            for (const d of store.demands.values()) {
                if (d.sourceType === st && d.externalReference === ext) return d;
            }
            return null;
        }) as unknown as typeof prisma.demand.findFirst;

        prisma.demand.create = (async ({ data }: { data: Record<string, unknown> }) => {
            const id = `dem-${store.demands.size + 1}`;
            const row = { id, ...data, order: null };
            store.demands.set(id, row);
            return row;
        }) as unknown as typeof prisma.demand.create;

        prisma.demand.update = (async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = store.demands.get(where.id);
            if (!row) throw new Error('not found');
            Object.assign(row, data);
            return row;
        }) as unknown as typeof prisma.demand.update;

        prisma.demandEvent.create = (async ({ data }: { data: { demandId: string; description: string; status: string } }) => {
            store.events.push(data);
            return { id: 'ev-1', ...data };
        }) as unknown as typeof prisma.demandEvent.create;

        prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as unknown as typeof prisma.$transaction;

        axios.get = (async () => ({
            data: { razao_social: 'Fornecedor Teste LTDA', nome_fantasia: 'Forn Teste', municipio: 'Imperatriz' },
        })) as unknown as typeof axios.get;
    });

    afterEach(() => {
        prisma.demand.findFirst = original.findFirst;
        prisma.demand.create = original.create;
        prisma.demand.update = original.update;
        prisma.demandEvent.create = original.eventCreate;
        prisma.$transaction = original.transaction;
        axios.get = original.axiosGet;
    });

    it('default: sem sourceType explícito, grava NFE_KEY (bipagem manual não regride)', async () => {
        const { demand } = await createIntakeDemandFromNfeKey({ chave: CHAVE44, clientId: CLIENT_ID });
        assert.equal(demand.sourceType, 'NFE_KEY');
    });

    it('sourceType DFE_ACBR é aceito e gravado (triagem da Distribuição NF-e)', async () => {
        const { demand } = await createIntakeDemandFromNfeKey({ chave: CHAVE44, clientId: CLIENT_ID, sourceType: 'DFE_ACBR' });
        assert.equal(demand.sourceType, 'DFE_ACBR');
    });

    it('idempotência por chave também vale para DFE_ACBR (mesma chave duas vezes → mesma Demand)', async () => {
        const first = await createIntakeDemandFromNfeKey({ chave: CHAVE44, clientId: CLIENT_ID, sourceType: 'DFE_ACBR' });
        const second = await createIntakeDemandFromNfeKey({ chave: CHAVE44, clientId: CLIENT_ID, sourceType: 'DFE_ACBR' });
        assert.equal(first.demand.id, second.demand.id);
        assert.equal(store.demands.size, 1);
    });
});
