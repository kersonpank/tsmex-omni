import assert from 'node:assert/strict';
import { describe, it, afterEach, beforeEach } from 'node:test';
import prisma from '../../lib/prisma.js';
import { confirmIntakeArrival } from './confirmIntakeArrival.js';

const LOCAL_CARGO = { chave: '35260512345678000190550010000000012345678901', emitente: { cnpj: '11111111000111', razaoSocial: 'Emitente' }, destinatario: { cnpj: '22222222000122', razaoSocial: 'Destinatário' }, produtos: [], valorTotalNota: 100 };
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
    const origDistribuicao = prisma.nfeDistribuicaoDocumento.findUnique.bind(prisma.nfeDistribuicaoDocumento);

    beforeEach(() => {
        // Sem XML na Distribuição: o resolver local não acha documento (e não toca no banco).
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => null) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;
    });

    afterEach(() => {
        prisma.demand.findUnique = origFind;
        prisma.nfeDistribuicaoDocumento.findUnique = origDistribuicao;
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
            rawInputData: { nfeXmlData: LOCAL_CARGO },
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
            rawInputData: { nfeXmlData: LOCAL_CARGO },
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
            rawInputData: { nfeXmlData: LOCAL_CARGO },
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

    it('modo AUTO sem oportunidade de coleta presume entrega direta no hub', async () => {
        const deps = stubTransactionDeps({
            personsById: {
                'p-remet': { city: 'SÃ£o Paulo', state: 'SP', cityIbgeCode: '3550308' },
                'p-dest': { city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302' },
            },
        });
        const originalHubFind = prisma.hub.findUnique;
        prisma.hub.findUnique = (async () => ({ city: 'Fortaleza', state: 'CE', cityIbgeCode: '2304400' })) as any;
        prisma.demand.findUnique = (async () => ({
            id: 'd1', status: 'AWAITING_ARRIVAL', sourceType: 'NFE_KEY', clientId: 'c1',
            origin: 'SÃ£o Paulo, SP', destination: 'Imperatriz, MA', nfNumber: '1',
            client: { id: 'c1', personId: 'p-remet', companyName: 'X' }, order: null, expectedHubId: 'hub-1',
        })) as any;
        try {
            await confirmIntakeArrival({
                demandId: 'd1', actingRoles: ['HUB'], actingHubId: 'hub-1', remetentePersonId: 'p-remet',
                destinatarioPersonId: 'p-dest', intakeMode: 'AUTO',
            });
            const order = deps.orderCreateCalls[0]?.data;
            assert.equal(order?.intakeMode, 'HUB_DIRECT');
            assert.equal(order?.origemPrestacao, 'Fortaleza, CE');
            assert.equal(order?.origemIbgeCode, '2304400');
            assert.equal(order?.remetentePersonId, 'p-remet');
        } finally {
            prisma.hub.findUnique = originalHubFind;
            deps.restore();
        }
    });

    it('entrega direta registra o hub que recebeu como origem, mantendo o remetente', async () => {
        const deps = stubTransactionDeps({
            personsById: {
                'p-remet': { city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308' },
                'p-dest': { city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302' },
            },
        });
        const originalHubFind = prisma.hub.findUnique;
        prisma.hub.findUnique = (async ({ where }: any) => {
            assert.equal(where.id, 'hub-1');
            return { city: 'Fortaleza', state: 'CE', cityIbgeCode: '2304400' };
        }) as any;
        prisma.demand.findUnique = (async () => ({
            id: 'd1', status: 'AWAITING_ARRIVAL', sourceType: 'NFE_KEY', clientId: 'c1',
            origin: 'São Paulo, SP', destination: 'Imperatriz, MA', nfNumber: '1',
            client: { id: 'c1', personId: 'p-remet', companyName: 'X' }, order: null, expectedHubId: 'hub-1',
        })) as any;
        try {
            await confirmIntakeArrival({
                demandId: 'd1', actingRoles: ['HUB'], actingHubId: 'hub-1', remetentePersonId: 'p-remet',
                destinatarioPersonId: 'p-dest', intakeMode: 'HUB_DIRECT', actorUserId: 'operator',
            });
            const order = deps.orderCreateCalls[0]?.data;
            assert.equal(order?.intakeMode, 'HUB_DIRECT');
            assert.equal(order?.intakeHubId, 'hub-1');
            assert.equal(order?.origemPrestacao, 'Fortaleza, CE');
            assert.equal(order?.origemIbgeCode, '2304400');
            assert.equal(order?.remetentePersonId, 'p-remet');
            assert.equal(order?.fimPrestacao, 'Imperatriz, MA');
        } finally {
            prisma.hub.findUnique = originalHubFind;
            deps.restore();
        }
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

    const CHAVE44 = '35260512345678000190550010000000012345678901';

    it('documentType NFE com cargoData completo: cria OrderInvoice com chave/número/emissão/peso/volumes/valor/natureza', async () => {
        const deps = stubTransactionDeps();
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'DFE_ACBR',
            clientId: 'c1',
            origin: 'A',
            destination: 'B',
            nfNumber: '12345',
            documentType: 'NFE',
            documentKey: CHAVE44,
            rawInputData: {
                nfeXmlData: {
                    chave: CHAVE44,
                    emitente: { cnpj: '12345678000190', razaoSocial: 'Fornecedor XML LTDA' },
                    destinatario: { cnpj: '10256071000103', razaoSocial: 'F C C ABREU LTDA' },
                    produtos: [{ descricao: 'Caixa de parafusos', ncm: '73181500', quantidade: 10, valorUnitario: 25.5, valorTotal: 255 }],
                    pesoBruto: 125,
                    pesoLiquido: 118.5,
                    quantidadeVolumes: 3,
                    valorTotalNota: 1155,
                },
            },
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

        const invoiceData = (deps.orderCreateCalls[0]?.data as any)?.invoicesRel?.create;
        assert.equal(invoiceData?.type, 'NFE');
        assert.equal(invoiceData?.nfNumber, '12345');
        assert.equal(invoiceData?.nfKey, CHAVE44);
        assert.equal(invoiceData?.emissionDate?.getTime(), new Date('2026-05-01').getTime());
        assert.equal(invoiceData?.nature, 'Caixa de parafusos');
        assert.equal(invoiceData?.volumes, 3);
        assert.equal(invoiceData?.weight, 125);
        assert.equal(invoiceData?.value, 1155);
        deps.restore();
    });

    it('documentType NFE sem cargoData (XML ainda não baixado): cria OrderInvoice só com chave/número/emissão', async () => {
        const deps = stubTransactionDeps();
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'NFE_KEY',
            clientId: 'c1',
            origin: 'A',
            destination: 'B',
            nfNumber: '12345',
            documentType: 'NFE',
            documentKey: CHAVE44,
            rawInputData: null,
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

        const invoiceData = (deps.orderCreateCalls[0]?.data as any)?.invoicesRel?.create;
        assert.equal(invoiceData?.nfKey, CHAVE44);
        assert.equal(invoiceData?.nfNumber, '12345');
        assert.ok(invoiceData?.emissionDate instanceof Date, 'emissão vem só da chave, não depende de cargoData');
        assert.equal(invoiceData?.nature, undefined);
        assert.equal(invoiceData?.volumes, 0);
        assert.equal(invoiceData?.weight, 0);
        assert.equal(invoiceData?.value, 0);
        deps.restore();
    });

    it('sem XML, carga conferida na DANFE no balcão: volumes/peso/valor vão para a NF do pedido e para a Demand', async () => {
        const deps = stubTransactionDeps();
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'NFE_KEY',
            clientId: 'c1',
            origin: 'A',
            destination: 'B',
            nfNumber: '12345',
            documentType: 'NFE',
            documentKey: CHAVE44,
            rawInputData: null,
            missingFields: ['weight', 'nfValue', 'destinatario', 'volume'],
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
            cargo: { units: 3, weightKg: 120.5, nfValue: 4500 },
            actorUserId: 'user-hub',
        });

        const invoiceData = (deps.orderCreateCalls[0]?.data as any)?.invoicesRel?.create;
        assert.equal(invoiceData?.volumes, 3);
        assert.equal(invoiceData?.weight, 120.5);
        assert.equal(invoiceData?.value, 4500);
        const demandUpdate = deps.updateCalls[0]?.data;
        assert.equal(demandUpdate?.units, 3);
        assert.equal(demandUpdate?.weight, 120.5);
        assert.equal(demandUpdate?.nfValue, 4500);
        assert.deepEqual(demandUpdate?.missingFields, ['destinatario', 'volume']);
        deps.restore();
    });

    it('documentType não-NFE (DECLARATION): não cria OrderInvoice nenhum', async () => {
        const deps = stubTransactionDeps();
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'DECLARATION',
            clientId: 'c1',
            origin: 'A',
            destination: 'B',
            nfNumber: 'DECL-1',
            documentType: 'DECLARATION',
            documentKey: null,
            rawInputData: null,
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

        const orderData = deps.orderCreateCalls[0]?.data as any;
        assert.equal(orderData?.invoicesRel, undefined);
        deps.restore();
    });
});
