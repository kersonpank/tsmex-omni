import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import prisma from '../../lib/prisma.js';
import { confirmIntakeArrival } from './confirmIntakeArrival.js';
import { AppError } from '../../middleware/errorHandler.js';

function stubTransactionDeps(options: { personsById?: Record<string, { city?: string | null; state?: string | null; cityIbgeCode?: string | null }> } = {}) {
    const original = {
        opportunityFindFirst: prisma.opportunity.findFirst,
        personFindUnique: prisma.person.findUnique,
        personFindMany: prisma.person.findMany,
        transaction: prisma.$transaction,
    };
    const updateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];
    const orderCreateCalls: Array<{ data: Record<string, unknown> }> = [];

    prisma.opportunity.findFirst = (async () => null) as any;
    prisma.person.findMany = (async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        const byId = options.personsById ?? {};
        return ids
            .filter((id) => id in byId)
            .map((id) => ({ id, city: null, state: null, cityIbgeCode: null, ...byId[id] }));
    }) as any;
    prisma.$transaction = (async (fn: any) =>
        fn({
            demand: {
                update: async ({ where, data }: any) => {
                    updateCalls.push({ where, data });
                    return { id: where.id, status: data.status, clientId: data.clientId };
                },
            },
            demandEvent: {
                create: async () => ({ id: 'ev-1' }),
                findMany: async () => [],
            },
            order: {
                create: async (args: any) => {
                    orderCreateCalls.push(args);
                    return { id: 'order-1', ...args.data };
                },
            },
            orderHistory: {
                create: async () => ({ id: 'oh-1' }),
            },
        })) as any;

    return {
        updateCalls,
        orderCreateCalls,
        restore: () => {
            prisma.opportunity.findFirst = original.opportunityFindFirst;
            prisma.person.findUnique = original.personFindUnique;
            prisma.person.findMany = original.personFindMany;
            prisma.$transaction = original.transaction;
        },
    };
}

describe('confirmIntakeArrival', () => {
    const origFind = prisma.demand.findUnique.bind(prisma.demand);

    afterEach(() => {
        prisma.demand.findUnique = origFind;
    });

    it('Hub de outro CD → 403', async () => {
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'MANUAL_HUB',
            clientId: 'c1',
            origin: 'A',
            destination: 'B',
            nfNumber: 'NF1',
            manifestId: null,
            client: { id: 'c1', personId: 'p-remet', companyName: 'X' },
            order: null,
            expectedHubId: 'hub-1',
        })) as unknown as typeof prisma.demand.findUnique;

        await assert.rejects(
            () =>
                confirmIntakeArrival({
                    demandId: 'd1',
                    actingRoles: ['HUB'],
                    actingHubId: 'hub-2',
                    destinatarioPersonId: 'p-dest',
                }),
            (err: unknown) => err instanceof AppError && err.statusCode === 403,
        );
    });

    it('Cliente sem personId e sem remetente no body → 400', async () => {
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'MANUAL_HUB',
            clientId: 'c1',
            origin: 'A',
            destination: 'B',
            nfNumber: 'NF1',
            manifestId: null,
            client: { id: 'c1', personId: null, companyName: 'X' },
            order: null,
            expectedHubId: 'hub-1',
        })) as unknown as typeof prisma.demand.findUnique;

        await assert.rejects(
            () =>
                confirmIntakeArrival({
                    demandId: 'd1',
                    actingRoles: ['HUB'],
                    actingHubId: 'hub-1',
                    destinatarioPersonId: 'p-dest',
                }),
            (err: unknown) => err instanceof AppError && err.statusCode === 400,
        );
    });

    it('Demand sem clientId (NF-e descoberta): resolve o cliente tardio via freightTerm quando o pagador é um Client', async () => {
        const deps = stubTransactionDeps();
        prisma.person.findUnique = (async ({ where }: any) => {
            if (where.id === 'p-remet') return { id: 'p-remet', clients: [{ id: 'client-resolvido' }] };
            return null;
        }) as any;
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'DFE_ACBR',
            clientId: null,
            origin: 'A',
            destination: 'B',
            nfNumber: 'NF1',
            manifestId: null,
            client: null,
            order: null,
            expectedHubId: 'hub-1',
        })) as unknown as typeof prisma.demand.findUnique;

        const result = await confirmIntakeArrival({
            demandId: 'd1',
            actingRoles: ['HUB'],
            actingHubId: 'hub-1',
            remetentePersonId: 'p-remet',
            destinatarioPersonId: 'p-dest',
            freightTerm: 'CIF',
        });

        assert.equal(result.demand.clientId, 'client-resolvido');
        assert.equal(deps.updateCalls[0]?.data.clientId, 'client-resolvido');
        deps.restore();
    });

    it('Demand sem clientId: pagador não é Client → segue sem bloquear, clientId continua null', async () => {
        const deps = stubTransactionDeps();
        prisma.person.findUnique = (async () => ({ id: 'p-remet', clients: [] })) as any;
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'DFE_ACBR',
            clientId: null,
            origin: 'A',
            destination: 'B',
            nfNumber: 'NF1',
            manifestId: null,
            client: null,
            order: null,
            expectedHubId: 'hub-1',
        })) as unknown as typeof prisma.demand.findUnique;

        const result = await confirmIntakeArrival({
            demandId: 'd1',
            actingRoles: ['HUB'],
            actingHubId: 'hub-1',
            remetentePersonId: 'p-remet',
            destinatarioPersonId: 'p-dest',
            freightTerm: 'CIF',
        });

        assert.equal(result.demand.clientId, undefined, 'não deve gravar clientId — chave nunca foi incluída no update');
        assert.equal(deps.updateCalls[0]?.data.clientId, undefined, 'update não deve tentar setar clientId quando não resolvido');
        deps.restore();
    });

    it('Demand já com clientId resolvido: não chama resolvePayerClient de novo (preserva o cliente já definido)', async () => {
        const deps = stubTransactionDeps();
        let personLookupCalled = false;
        prisma.person.findUnique = (async () => {
            personLookupCalled = true;
            return null;
        }) as any;
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'MANUAL_HUB',
            clientId: 'client-ja-resolvido',
            origin: 'A',
            destination: 'B',
            nfNumber: 'NF1',
            manifestId: null,
            client: { id: 'client-ja-resolvido', personId: 'p-remet', companyName: 'X' },
            order: null,
            expectedHubId: 'hub-1',
        })) as unknown as typeof prisma.demand.findUnique;

        await confirmIntakeArrival({
            demandId: 'd1',
            actingRoles: ['HUB'],
            actingHubId: 'hub-1',
            destinatarioPersonId: 'p-dest',
            freightTerm: 'CIF',
        });

        assert.equal(personLookupCalled, false, 'clientId já resolvido não deve disparar nova busca de pagador');
        assert.equal(deps.updateCalls[0]?.data.clientId, undefined);
        deps.restore();
    });

    it('origemPrestacao/fimPrestacao vêm do city/state do Person vinculado (não do texto congelado da Demand)', async () => {
        const deps = stubTransactionDeps({
            personsById: {
                'p-remet': { city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302' },
                'p-dest': { city: 'São Luís', state: 'MA', cityIbgeCode: '2111300' },
            },
        });
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'DFE_ACBR',
            clientId: 'c1',
            origin: 'Fornecedor XML LTDA - Imperatriz, MA',
            destination: 'A definir',
            nfNumber: 'NF1',
            manifestId: null,
            client: { id: 'c1', personId: 'p-remet', companyName: 'X' },
            order: null,
            expectedHubId: 'hub-1',
        })) as unknown as typeof prisma.demand.findUnique;

        await confirmIntakeArrival({
            demandId: 'd1',
            actingRoles: ['HUB'],
            actingHubId: 'hub-1',
            remetentePersonId: 'p-remet',
            destinatarioPersonId: 'p-dest',
            freightTerm: 'CIF',
        });

        const orderData = deps.orderCreateCalls[0]?.data;
        assert.equal(orderData?.origemPrestacao, 'Imperatriz, MA', 'não deve gravar a razão social, só a cidade do Person remetente');
        assert.equal(orderData?.origemIbgeCode, '2105302');
        assert.equal(orderData?.fimPrestacao, 'São Luís, MA', 'destino vem do Person destinatário, não do placeholder congelado na Demand');
        assert.equal(orderData?.fimIbgeCode, '2111300');
        deps.restore();
    });

    it('sem cidade no Person vinculado: cai pro texto da Demand (regressão MANUAL_HUB/DECLARATION sem cargoData)', async () => {
        const deps = stubTransactionDeps({
            personsById: {
                'p-remet': { city: null, state: null },
                'p-dest': { city: null, state: null },
            },
        });
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'MANUAL_HUB',
            clientId: 'c1',
            origin: 'São Paulo, SP',
            destination: 'Rio de Janeiro, RJ',
            nfNumber: 'NF1',
            manifestId: null,
            client: { id: 'c1', personId: 'p-remet', companyName: 'X' },
            order: null,
            expectedHubId: 'hub-1',
        })) as unknown as typeof prisma.demand.findUnique;

        await confirmIntakeArrival({
            demandId: 'd1',
            actingRoles: ['HUB'],
            actingHubId: 'hub-1',
            remetentePersonId: 'p-remet',
            destinatarioPersonId: 'p-dest',
            freightTerm: 'CIF',
        });

        const orderData = deps.orderCreateCalls[0]?.data;
        assert.equal(orderData?.origemPrestacao, 'São Paulo, SP');
        assert.equal(orderData?.origemIbgeCode, null);
        assert.equal(orderData?.fimPrestacao, 'Rio de Janeiro, RJ');
        assert.equal(orderData?.fimIbgeCode, null);
        deps.restore();
    });
});
