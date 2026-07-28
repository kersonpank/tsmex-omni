import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import prisma from '../../lib/prisma.js';
import { confirmIntakeArrival } from './confirmIntakeArrival.js';
import { AppError } from '../../middleware/errorHandler.js';

function stubTransactionDeps() {
    const original = {
        opportunityFindFirst: prisma.opportunity.findFirst,
        personFindUnique: prisma.person.findUnique,
        transaction: prisma.$transaction,
    };
    const updateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];

    prisma.opportunity.findFirst = (async () => null) as any;
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
                create: async (args: any) => ({ id: 'order-1', ...args.data }),
            },
            orderHistory: {
                create: async () => ({ id: 'oh-1' }),
            },
        })) as any;

    return {
        updateCalls,
        restore: () => {
            prisma.opportunity.findFirst = original.opportunityFindFirst;
            prisma.person.findUnique = original.personFindUnique;
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
});
