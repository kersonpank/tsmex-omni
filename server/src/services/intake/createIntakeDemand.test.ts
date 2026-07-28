import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import axios from 'axios';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createIntakeDemand, createIntakeDemandFromNfeKey } from './createIntakeDemand.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

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
            // Mesma semântica do Prisma real: chave com valor `undefined` em `data` é omitida do
            // UPDATE (não sobrescreve), diferente de `null` (que limpa o campo de propósito).
            for (const [key, value] of Object.entries(data)) {
                if (value !== undefined) row[key] = value;
            }
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

    it('cria Demand sem clientId (cliente ainda não resolvido) — não bloqueia, clientId fica null e entra em missingFields', async () => {
        const demand = await createIntakeDemand({
            sourceType: 'DFE_ACBR',
            expectedHubId: HUB_ID,
            origin: 'São Paulo, SP',
            destination: 'Rio de Janeiro, RJ',
            commodity: 'Peças',
            weight: 12,
            volume: 0.5,
            nfNumber: 'NF-101',
            nfValue: 500,
        });

        assert.equal(demand.clientId, undefined, 'clientId não informado não deve ser setado (fica null no banco real)');
        assert.equal(demand.status, 'AWAITING_ARRIVAL', 'não bloqueia a criação da Demand');
        assert.ok((demand.missingFields as string[]).includes('clientId'));
    });

    it('reprocessar a mesma chave sem clientId NÃO apaga um clientId já resolvido antes (update preserva)', async () => {
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
        assert.equal(first.clientId, CLIENT_ID);

        const second = await createIntakeDemand({
            sourceType: 'DFE_ACBR',
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

        assert.equal(second.id, first.id);
        assert.equal(second.clientId, CLIENT_ID, 'update sem clientId não deve regredir um valor já resolvido');
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

    it('sem clientId (fornecedor não cadastrado como Client) — cria a Demand mesmo assim', async () => {
        const { demand } = await createIntakeDemandFromNfeKey({ chave: CHAVE44, sourceType: 'DFE_ACBR' });
        assert.equal(demand.clientId, undefined);
        assert.equal(demand.status, 'AWAITING_ARRIVAL');
        assert.ok((demand.missingFields as string[]).includes('clientId'));
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

    const cargoData: ParsedNfeCargo = {
        chave: CHAVE44,
        emitente: { cnpj: '12345678000190', razaoSocial: 'Fornecedor XML LTDA', municipio: 'Imperatriz', uf: 'MA' },
        destinatario: { cnpj: '10256071000103', razaoSocial: 'F C C ABREU LTDA' },
        produtos: [
            { descricao: 'Caixa de parafusos', ncm: '73181500', quantidade: 10, valorUnitario: 25.5, valorTotal: 255 },
            { descricao: 'Chapa de aço', ncm: '72091700', quantidade: 2, valorUnitario: 450, valorTotal: 900 },
        ],
        pesoBruto: 125,
        pesoLiquido: 118.5,
        quantidadeVolumes: 3,
        valorTotalNota: 1155,
    };

    it('com cargoData (XML já baixado): usa nfValue, origin, commodity, weight, units reais em vez de placeholder', async () => {
        const { demand } = await createIntakeDemandFromNfeKey({ chave: CHAVE44, clientId: CLIENT_ID, cargoData });

        assert.equal(demand.nfValue, 1155);
        assert.equal(demand.weight, 125);
        assert.equal(demand.units, 3);
        assert.equal(demand.origin, 'Fornecedor XML LTDA - Imperatriz, MA');
        assert.equal(demand.commodity, 'Caixa de parafusos e mais 1 item');

        const missing = demand.missingFields as string[];
        assert.ok(!missing.includes('weight'), 'weight não deveria estar em missingFields');
        assert.ok(!missing.includes('nfValue'), 'nfValue não deveria estar em missingFields');
        assert.ok(!missing.includes('produtos'), 'produtos não deveria estar em missingFields');
        assert.ok(missing.includes('destination'), 'destination continua missing (não vem do XML)');
        assert.ok(missing.includes('volume'), 'volume continua missing (XML não tem m³)');
        assert.ok(missing.includes('cubagem'), 'cubagem continua missing');
        assert.ok(missing.includes('destinatario'), 'destinatario continua missing');
    });

    it('sem cargoData: mantém placeholders (comportamento atual, sem regressão)', async () => {
        const { demand } = await createIntakeDemandFromNfeKey({ chave: CHAVE44, clientId: CLIENT_ID });

        assert.equal(demand.nfValue, 0.01);
        assert.equal(demand.weight, 1);
        assert.equal(demand.units, 1);
        assert.equal(demand.commodity, 'A definir');

        const missing = demand.missingFields as string[];
        assert.ok(missing.includes('weight'));
        assert.ok(missing.includes('nfValue'));
        assert.ok(missing.includes('produtos'));
    });

    it('cargoData guarda o parse completo em rawInputData.nfeXmlData pra auditoria', async () => {
        const { demand } = await createIntakeDemandFromNfeKey({ chave: CHAVE44, clientId: CLIENT_ID, cargoData });
        const raw = demand.rawInputData as { nfeXmlData?: ParsedNfeCargo };
        assert.equal(raw.nfeXmlData?.valorTotalNota, 1155);
        assert.equal(raw.nfeXmlData?.destinatario.cnpj, '10256071000103');
    });
});
