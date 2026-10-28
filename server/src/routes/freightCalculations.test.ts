import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';

import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpJson<T>(baseUrl: string, path: string, token: string, init?: RequestInit): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            ...(init?.headers ?? {}),
        },
    });
    return {
        status: response.status,
        body: await response.json() as T,
    };
}

describe('freightCalculations routes (preflight + emit-cte)', () => {
    const jwtSecret = `it-secret-${Date.now()}`;
    const orderId = 'order-1';
    const hubId = 'hub-1';
    const calcValidId = 'calc-valid';
    const calcInvalidId = 'calc-invalid';
    const calcPendingId = 'calc-pending';
    const calcPendingReconciliationNoDocId = 'calc-pending-reconciliation-no-doc';
    const calcPendingReconciliationWithDocId = 'calc-pending-reconciliation-with-doc';
    const calcRejectedId = 'calc-rejected';
    let token = '';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        orderFindUnique: prisma.order.findUnique,
        calcFindFirst: prisma.orderFreightCalculation.findFirst,
        calcUpdateMany: prisma.orderFreightCalculation.updateMany,
        calcUpdate: prisma.orderFreightCalculation.update,
        hubFindUnique: prisma.hub.findUnique,
        fiscalEmitterUpdate: prisma.fiscalEmitter.update,
        cteJobCreate: prisma.cteEmissionJob.create,
    };
    const envSnapshot = {
        ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
        ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
        FISCAL_CTE_PROVIDER: process.env.FISCAL_CTE_PROVIDER,
        FISCAL_PROVIDER: process.env.FISCAL_PROVIDER,
    };

    const mockOrder = {
        id: orderId,
        currentHubId: hubId,
        freightTerm: 'CIF',
        remetentePerson: {
            legalName: 'Remetente SA',
            document: '12345678000190',
            stateRegistration: '123456789',
            address: 'Rua A',
            number: '100',
            neighborhood: 'Centro',
            city: 'Imperatriz',
            state: 'MA',
            cep: '65900000',
        },
        destinatarioPerson: {
            legalName: 'Destinatario SA',
            document: '98765432000110',
            stateRegistration: '987654321',
            address: 'Rua B',
            number: '200',
            neighborhood: 'Centro',
            city: 'São Luís',
            state: 'MA',
            cep: '65000000',
        },
        consignatarioPerson: null,
        expedidorPerson: null,
        invoicesRel: [{
            type: 'NFE',
            nfNumber: '123',
            nfKey: '1'.repeat(44),
            volumes: 1,
            weight: 120,
            value: 1000,
        }],
        collectionData: null,
    };

    const mockHub = {
        id: hubId,
        name: 'Hub Imperatriz',
        code: 'IMP-MA',
        city: 'Imperatriz',
        state: 'MA',
        phone: '99999999',
        rntrc: '12345678',
        person: {
            legalName: 'TSM EX LTDA',
            document: '11222333000144',
            stateRegistration: '123456789',
            address: 'Av Central',
            number: '10',
            neighborhood: 'Centro',
            city: 'Imperatriz',
            state: 'MA',
            cep: '65900000',
        },
    };
    const mockFiscalEmitter = {
        id: 'fe-1',
        active: true,
        provider: 'ACBR',
        environment: 'HOMOLOGACAO',
        cteSeries: 1,
        rntrc: '12345678',
        person: mockHub.person,
        hub: mockHub,
    };

    const calcById = new Map<string, any>([
        [calcValidId, {
            id: calcValidId,
            orderId,
            documentType: 'CTE',
            emissorId: hubId,
            status: 'DRAFT',
            fiscalEmitterId: 'fe-1',
            fiscalEmitter: mockFiscalEmitter,
            cteEnvironment: 'HOMOLOGACAO',
            cteSeries: 1,
            cteAccessKey: null,
            cteProtocol: null,
            cteAuthorizedAt: null,
            freightTotal: 320,
            originCity: 'Imperatriz',
            destCity: 'São Luís',
            cfop: '5352',
            cst: '00',
            tipoFrete: 'Normal',
            observacoes: null,
            volumes: 1,
            weight: 120,
            effectiveWeight: 120,
            cubage: null,
            nfValue: 1000,
            commodity: 'Medicamentos',
            breakdown: null,
            icmsValue: 40,
        }],
        [calcInvalidId, {
            id: calcInvalidId,
            orderId,
            documentType: 'CTE',
            emissorId: hubId,
            status: 'DRAFT',
            fiscalEmitterId: 'fe-1',
            fiscalEmitter: mockFiscalEmitter,
            cteEnvironment: 'HOMOLOGACAO',
            cteSeries: 1,
            cteAccessKey: null,
            cteProtocol: null,
            cteAuthorizedAt: null,
            freightTotal: 0,
            originCity: null,
            destCity: null,
            cfop: null,
            cst: '99',
            tipoFrete: 'Normal',
            observacoes: null,
            volumes: 1,
            weight: 120,
            effectiveWeight: 120,
            cubage: null,
            nfValue: 1000,
            commodity: 'Medicamentos',
            breakdown: null,
            icmsValue: 0,
        }],
        [calcPendingId, {
            id: calcPendingId,
            orderId,
            documentType: 'CTE',
            emissorId: hubId,
            status: 'DRAFT',
            fiscalEmitterId: 'fe-1',
            fiscalEmitter: mockFiscalEmitter,
            cteEnvironment: 'HOMOLOGACAO',
            cteSeries: 1,
            cteAccessKey: null,
            cteProtocol: null,
            cteAuthorizedAt: null,
            freightTotal: 100,
            originCity: 'Imperatriz',
            destCity: 'São Luís',
            cfop: null,
            cst: '00',
            tipoFrete: 'Normal',
            observacoes: null,
            volumes: 1,
            weight: 120,
            effectiveWeight: 120,
            cubage: null,
            nfValue: 1000,
            commodity: 'Medicamentos',
            breakdown: null,
            icmsValue: 0,
        }],
        [calcPendingReconciliationNoDocId, {
            id: calcPendingReconciliationNoDocId,
            orderId,
            documentType: 'CTE',
            emissorId: hubId,
            status: 'CTE_PENDING_RECONCILIATION',
            fiscalEmitterId: 'fe-1',
            fiscalEmitter: mockFiscalEmitter,
            cteEnvironment: 'HOMOLOGACAO',
            cteSeries: 1,
            cteAccessKey: null,
            cteProtocol: null,
            cteAuthorizedAt: null,
            freightTotal: 100,
            originCity: 'Imperatriz',
            destCity: 'São Luís',
            cfop: null, // força falha de preflight — prova que passou do gate de status sem precisar mockar o pipeline ACBr inteiro
            cst: '00',
            tipoFrete: 'Normal',
            observacoes: null,
            volumes: 1,
            weight: 120,
            effectiveWeight: 120,
            cubage: null,
            nfValue: 1000,
            commodity: 'Medicamentos',
            breakdown: null,
            icmsValue: 0,
            cteEmissionJobs: [{ providerDocId: null }],
        }],
        [calcPendingReconciliationWithDocId, {
            id: calcPendingReconciliationWithDocId,
            orderId,
            documentType: 'CTE',
            emissorId: hubId,
            status: 'CTE_PENDING_RECONCILIATION',
            fiscalEmitterId: 'fe-1',
            fiscalEmitter: mockFiscalEmitter,
            cteEnvironment: 'HOMOLOGACAO',
            cteSeries: 1,
            cteAccessKey: null,
            cteProtocol: null,
            cteAuthorizedAt: null,
            freightTotal: 100,
            originCity: 'Imperatriz',
            destCity: 'São Luís',
            cfop: '6352',
            cst: '00',
            tipoFrete: 'Normal',
            observacoes: null,
            volumes: 1,
            weight: 120,
            effectiveWeight: 120,
            cubage: null,
            nfValue: 1000,
            commodity: 'Medicamentos',
            breakdown: null,
            icmsValue: 0,
            cteEmissionJobs: [{ providerDocId: 'ACBR-DOC-123' }],
        }],
    ]);

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        process.env.S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
        process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'test';
        process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? 'test';
        process.env.S3_BUCKET = process.env.S3_BUCKET ?? 'tsm-ex-test';
        process.env.ACBR_CLIENT_ID = 'client-id';
        process.env.ACBR_CLIENT_SECRET = 'client-secret';
        delete process.env.FISCAL_CTE_PROVIDER;
        delete process.env.FISCAL_PROVIDER;
        const { ordersRouter } = await import('./orders.js');

        prisma.user.findUnique = ((async (args: any) => ({
            id: args.where.id,
            email: 'admin@tsmex.com',
            roles: args.where.id === 'hub-outro' ? ['HUB'] : ['ADMIN'],
            active: true,
            hubId: args.where.id === 'hub-outro' ? 'outro-hub' : null,
            permissions: [],
            admin: null,
            client: null,
            link: null,
        })) as unknown) as typeof prisma.user.findUnique;

        prisma.order.findUnique = ((async () => mockOrder) as unknown) as typeof prisma.order.findUnique;
        prisma.hub.findUnique = ((async () => mockHub) as unknown) as typeof prisma.hub.findUnique;

        prisma.orderFreightCalculation.findFirst = ((async (args: any) => {
            const id = args?.where?.id as string;
            return calcById.get(id) ?? null;
        }) as unknown) as typeof prisma.orderFreightCalculation.findFirst;

        prisma.orderFreightCalculation.updateMany = ((async (args: any) => {
            const id = args?.where?.id as string;
            const calc = calcById.get(id);
            if (!calc) return { count: 0 } as any;
            // Respeita o filtro de status do CAS (compare-and-swap) — sem isso o mock mascararia
            // um bug real no gate de elegibilidade (ex.: esquecer de estender a lista de status
            // aceitos), sempre retornando sucesso independente do filtro pedido pela rota.
            const allowedStatuses: string[] | undefined = args?.where?.status?.in;
            if (allowedStatuses && !allowedStatuses.includes(calc.status)) return { count: 0 } as any;
            Object.assign(calc, args?.data ?? {});
            return { count: 1 } as any;
        }) as unknown) as typeof prisma.orderFreightCalculation.updateMany;

        prisma.orderFreightCalculation.update = ((async (args: any) => {
            const id = args?.where?.id as string;
            const calc = calcById.get(id);
            if (!calc) return null as any;
            Object.assign(calc, args?.data ?? {});
            return calc;
        }) as unknown) as typeof prisma.orderFreightCalculation.update;

        const app = express();
        app.use(express.json());
        app.use('/api/orders', ordersRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;

        token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
    });

    after(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.order.findUnique = original.orderFindUnique;
        prisma.orderFreightCalculation.findFirst = original.calcFindFirst;
        prisma.orderFreightCalculation.updateMany = original.calcUpdateMany;
        prisma.orderFreightCalculation.update = original.calcUpdate;
        prisma.hub.findUnique = original.hubFindUnique;
        prisma.fiscalEmitter.update = original.fiscalEmitterUpdate;
        prisma.cteEmissionJob.create = original.cteJobCreate;
        for (const [key, value] of Object.entries(envSnapshot)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('GET /cte-preflight retorna resultado válido quando cálculo está pronto', async () => {
        const response = await httpJson<{
            success: boolean;
            data: { ok: boolean; canEmit: boolean; issues: string[]; tax: { cfop: { code: string } | null; cst: { code: string } | null } };
        }>(baseUrl, `/api/orders/${orderId}/freight-calculations/${calcValidId}/cte-preflight`, token);

        assert.equal(response.status, 200);
        assert.equal(response.body.success, true);
        assert.equal(response.body.data.ok, true);
        assert.equal(response.body.data.canEmit, true);
        assert.deepEqual(response.body.data.issues, []);
        assert.equal(response.body.data.tax.cfop?.code, '5352');
        assert.equal(response.body.data.tax.cst?.code, '00');
    });

    it('GET /cte-preflight retorna pendências para cálculo inválido', async () => {
        const response = await httpJson<{
            success: boolean;
            data: { ok: boolean; canEmit: boolean; issues: string[]; missingFields: string[] };
        }>(baseUrl, `/api/orders/${orderId}/freight-calculations/${calcInvalidId}/cte-preflight`, token);

        assert.equal(response.status, 200);
        assert.equal(response.body.success, true);
        assert.equal(response.body.data.ok, false);
        assert.equal(response.body.data.canEmit, false);
        assert.ok(response.body.data.issues.includes('CT-e precisa de CFOP.'));
        assert.ok(response.body.data.issues.includes('CST 99 não está habilitado para CT-e no MVP.'));
        assert.ok(response.body.data.issues.includes('CT-e precisa de origem e fim da prestação.'));
        assert.ok(response.body.data.issues.includes('CT-e precisa de valor de frete maior que zero.'));
        assert.ok(response.body.data.missingFields.includes('cfop'));
        assert.ok(response.body.data.missingFields.includes('originCity'));
        assert.ok(response.body.data.missingFields.includes('destCity'));
        assert.ok(response.body.data.missingFields.includes('freightTotal'));
    });

    it('POST /emit-cte retorna 400 com preflight e não marca CTE_REJECTED em pendência de preenchimento', async () => {
        const response = await httpJson<{
            success: boolean;
            error: string;
            preflight: { ok: boolean; canEmit: boolean; issues: string[]; missingFields: string[] };
        }>(
            baseUrl,
            `/api/orders/${orderId}/freight-calculations/${calcPendingId}/emit-cte`,
            token,
            { method: 'POST', body: '{}' },
        );

        assert.equal(response.status, 400);
        assert.equal(response.body.success, false);
        assert.match(response.body.error, /CT-e com pendências fiscais:/);
        assert.equal(response.body.preflight.ok, false);
        assert.equal(response.body.preflight.canEmit, false);
        assert.ok(response.body.preflight.issues.includes('CT-e precisa de CFOP.'));
        assert.ok(response.body.preflight.missingFields.includes('cfop'));
        assert.equal(calcById.get(calcPendingId)?.status, 'DRAFT');
    });

    it('POST /emit-cte bloqueia reconciliação antiga sem providerDocId e sem prova de guarda/worker', async () => {
        const response = await httpJson<{ success: boolean; error: string; preflight?: { ok: boolean } }>(
            baseUrl,
            `/api/orders/${orderId}/freight-calculations/${calcPendingReconciliationNoDocId}/emit-cte`,
            token,
            { method: 'POST', body: '{}' },
        );

        assert.equal(response.status, 400);
        assert.match(response.body.error, /reenvio está bloqueado/i);
        assert.equal(response.body.preflight, undefined);
    });

    it('(Onda 3) POST /emit-cte continua bloqueado quando CTE_PENDING_RECONCILIATION e o último job já tem providerDocId', async () => {
        const response = await httpJson<{ success: boolean; error: string; preflight?: unknown }>(
            baseUrl,
            `/api/orders/${orderId}/freight-calculations/${calcPendingReconciliationWithDocId}/emit-cte`,
            token,
            { method: 'POST', body: '{}' },
        );

        assert.equal(response.status, 400);
        assert.ok(!response.body.preflight, 'não deveria ter chegado ao preflight — bloqueado antes, no gate de status');
        assert.match(response.body.error, /reconciliação/i);
    });

    it('(Onda 3) POST /emit-cte/reconcile rejeita quando status não é CTE_PENDING_RECONCILIATION', async () => {
        const response = await httpJson<{ success: boolean; error: string }>(
            baseUrl,
            `/api/orders/${orderId}/freight-calculations/${calcValidId}/emit-cte/reconcile`,
            token,
            { method: 'POST', body: '{}' },
        );

        assert.equal(response.status, 400);
        assert.match(response.body.error, /Reconciliação só é permitida/);
    });

    it('POST /emit-cte/reconcile não presume que ausência de providerDocId significa ausência de envio', async () => {
        const response = await httpJson<{ success: boolean; error: string }>(
            baseUrl,
            `/api/orders/${orderId}/freight-calculations/${calcPendingReconciliationNoDocId}/emit-cte/reconcile`,
            token,
            { method: 'POST', body: '{}' },
        );

        assert.equal(response.status, 400);
        assert.match(response.body.error, /não comprova que o envio não ocorreu/i);
    });

    beforeEach(() => {
        calcById.set(calcRejectedId, {
            ...calcById.get(calcValidId), id: calcRejectedId, status: 'CTE_REJECTED', cfop: '6352',
            originCity: 'Imperatriz', cteStatusReason: '519 - CFOP inválido', cteRejectedAt: new Date('2026-10-27T10:00:00Z'),
            cteEmissionJobs: [{ phase: 'FAILED', lastError: '519 - CFOP inválido', providerDocId: 'documento-rejeitado' }],
        });
        prisma.fiscalEmitter.update = original.fiscalEmitterUpdate;
        prisma.cteEmissionJob.create = original.cteJobCreate;
    });

    it('rejeita CFOP inválido, estado não rejeitado e HUB de outro pedido', async () => {
        const retry = `/api/orders/${orderId}/freight-calculations/${calcRejectedId}/retry-cte-cfop`;
        const invalid = await httpJson<{ error: string }>(baseUrl, retry, token, { method: 'POST', body: JSON.stringify({ cfop: '53520' }) });
        assert.equal(invalid.status, 400);
        assert.match(invalid.body.error, /CFOP válido/);
        const forbidden = await httpJson<{ error: string }>(baseUrl, retry, jwt.sign({ userId: 'hub-outro' }, jwtSecret), { method: 'POST', body: JSON.stringify({ cfop: '5352' }) });
        assert.equal(forbidden.status, 403);
        for (const status of ['CTE_SENT', 'CTE_PROCESSING', 'CTE_AUTHORIZED', 'CTE_PENDING_RECONCILIATION']) {
            calcById.get(calcRejectedId)!.status = status;
            const response = await httpJson<{ error: string }>(baseUrl, retry, token, { method: 'POST', body: JSON.stringify({ cfop: '5352' }) });
            assert.equal(response.status, 409, status);
        }
    });

    it('valida o CFOP proposto antes de alterar o cálculo rejeitado', async () => {
        const calc = calcById.get(calcRejectedId)!;
        const response = await httpJson<{ error: string }>(baseUrl, `/api/orders/${orderId}/freight-calculations/${calcRejectedId}/retry-cte-cfop`, token, {
            method: 'POST', body: JSON.stringify({ cfop: '6352', deliveredDirectlyToHub: true }),
        });
        assert.equal(response.status, 400);
        assert.match(response.body.error, /SEFAZ 519/);
        assert.equal(calc.status, 'CTE_REJECTED');
        assert.equal(calc.cfop, '6352');
        assert.equal(calc.originCity, 'Imperatriz');
        assert.equal(calc.cteStatusReason, '519 - CFOP inválido');
    });

    it('reserva uma única correção concorrente e conserva frete, origem global e evidência', async () => {
        let entered!: () => void;
        let fail!: (error: Error) => void;
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const waiting = new Promise<never>((_resolve, reject) => { fail = reject; });
        prisma.fiscalEmitter.update = ((async () => { entered(); return waiting; }) as unknown) as typeof prisma.fiscalEmitter.update;
        const calc = calcById.get(calcRejectedId)!;
        const rejectionDate = calc.cteRejectedAt;
        const retry = `/api/orders/${orderId}/freight-calculations/${calcRejectedId}/retry-cte-cfop`;
        const request = { method: 'POST', body: JSON.stringify({ cfop: '5352', deliveredDirectlyToHub: true }) };
        const first = httpJson(baseUrl, retry, token, request);
        await started;
        assert.equal(calc.status, 'CTE_READY');
        assert.equal(calc.cfop, '5352');
        assert.equal(calc.originCity, 'Imperatriz, MA');
        assert.equal(calc.freightTotal, 320);
        assert.equal(calc.cteStatusReason, '519 - CFOP inválido');
        assert.equal(calc.cteRejectedAt, rejectionDate);
        assert.equal(calc.cteEmissionJobs[0].lastError, '519 - CFOP inválido');
        assert.equal((mockOrder as any).origemPrestacao, undefined);
        const second = await httpJson(baseUrl, retry, token, request);
        assert.equal(second.status, 409);
        fail(new Error('teste interrompido antes de criar job ou chamar provedor'));
        assert.equal((await first).status, 500);
        assert.equal(calc.status, 'CTE_REJECTED');
    });

    it('cria job com guarda e snapshot da tentativa corrigida sem certificado ou envio real', async () => {
        let jobData: any;
        prisma.fiscalEmitter.update = ((async () => ({ lastCteNumber: 55 })) as unknown) as typeof prisma.fiscalEmitter.update;
        prisma.cteEmissionJob.create = ((async (args: any) => {
            jobData = args.data;
            throw new Error('teste interrompido antes de enfileirar');
        }) as unknown) as typeof prisma.cteEmissionJob.create;
        const response = await httpJson(baseUrl, `/api/orders/${orderId}/freight-calculations/${calcRejectedId}/retry-cte-cfop`, token, {
            method: 'POST', body: JSON.stringify({ cfop: '5352', deliveredDirectlyToHub: true }),
        });
        assert.equal(response.status, 500);
        assert.equal(jobData.submissionGuardVersion, 1);
        assert.equal(jobData.inputSnapshot.calc.cfop, '5352');
        assert.equal(jobData.inputSnapshot.calc.originCity, 'Imperatriz, MA');
        assert.equal(jobData.inputSnapshot.order.serviceStart.city, 'Imperatriz');
        assert.equal(jobData.inputSnapshot.numero, 55);
        assert.doesNotMatch(JSON.stringify(jobData.inputSnapshot), /certificate|certificado|password|senha/i);
        assert.equal(calcById.get(calcRejectedId)!.cteEmissionJobs[0].lastError, '519 - CFOP inválido');
        assert.match(calcById.get(calcRejectedId)!.cteStatusReason, /519 - CFOP inválido/);
    });
});

describe('freightCalculations /prepare: seleção de tabela aplicável', () => {
    const hubId = 'gru';
    const orderId = 'order-pricing';
    let baseUrl = '';
    let token = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let ambiguousRoutes = false;
    let transactions = 0;
    const calcs = new Map<string, any>();
    const restores: (() => void)[] = [];
    const originalJwtSecret = process.env.JWT_SECRET;

    const routes = [
        { id: 'route-imp', name: 'GRU → Imperatriz', originCode: 'SP-GRU', destCode: 'IMP-MA', active: true },
        { id: 'route-slz', name: 'GRU → São Luís', originCode: 'SP-GRU', destCode: 'SLZ-MA', active: true },
    ];
    const hub = {
        id: hubId, name: 'Guarulhos', code: 'SP-GRU', state: 'SP', cityIbgeCode: '3518800', active: true,
        personId: 'person-gru', person: { id: 'person-gru', legalName: 'TSM EX LTDA', document: '11222333000144' },
    };
    const order = {
        id: orderId, currentHubId: hubId, freightTerm: 'CIF', routeId: 'route-imp', nfNumber: null,
        origemPrestacao: 'Guarulhos, SP', fimPrestacao: 'Viana, MA', fimIbgeCode: '2112803',
        remetentePerson: { id: 'payer', legalName: 'Pagador', document: '11222333000144', clients: [{ id: 'client-payer', accountId: null }] },
        destinatarioPerson: { id: 'dest', legalName: 'Destino', document: '45568955000188', state: 'MA', cityIbgeCode: '2112803', clients: [] },
        consignatarioPerson: null, expedidorPerson: null, invoicesRel: [], freightCalculations: [], invoices: [], invoiceItems: [], demand: null,
        collectionData: { volumes: 1, weight: 10 },
    };
    const makeTable = (id: string, type: 'SPECIAL' | 'GENERAL', routeId: string | null, freightValue: number, priority = 0) => ({
        id, type, routeId, freightValue, priority, description: id, active: true,
        clientId: type === 'SPECIAL' ? 'client-payer' : null, accountId: null,
        freightUnit: 'RS_KG', minFreightValue: 0, minFreightRanges: [], adValoremPercent: 0, grisPercent: 0,
        tollValue: 0, tollUnit: 'RS_KG', dispatchFee: 0, otherFees: 0, icmsIncluded: false, icmsPercent: 0, cubeFactor: 300,
    });
    const allTables = [
        makeTable('special-payer', 'SPECIAL', null, 1),
        makeTable('general-imp', 'GENERAL', 'route-imp', 2, 10),
        makeTable('general-slz', 'GENERAL', 'route-slz', 3),
        makeTable('general-routeless', 'GENERAL', null, 4),
    ];
    const tables = () => ambiguousRoutes ? allTables.filter((t) => t.routeId !== null) : allTables;
    const availableRoutes = () => ambiguousRoutes ? routes : routes.slice(0, 1);

    function replace(target: object, method: string, replacement: (...args: any[]) => any): void {
        const delegate = target as Record<string, unknown>;
        const original = delegate[method];
        delegate[method] = replacement;
        restores.push(() => { delegate[method] = original; });
    }

    before(async () => {
        process.env.JWT_SECRET = 'pricing-prepare-test-secret';
        const { freightCalculationsRouter } = await import('./freightCalculations.js');
        replace(prisma.user, 'findUnique', async () => ({ id: 'admin-pricing', roles: ['ADMIN'], active: true, hubId: null, permissions: [] }));
        replace(prisma.order, 'findUnique', async () => ({ ...order, routeId: ambiguousRoutes ? null : order.routeId }));
        replace(prisma.order, 'findUniqueOrThrow', async () => ({ ...order, routeId: ambiguousRoutes ? null : order.routeId }));
        replace(prisma.hub, 'findUnique', async () => hub);
        replace(prisma.hub, 'findUniqueOrThrow', async () => hub);
        replace(prisma.hub, 'findMany', async () => [
            hub,
            { id: 'imp', name: 'Imperatriz', code: 'IMP-MA', state: 'MA', cityIbgeCode: '2105302', active: true },
            { id: 'slz', name: 'São Luís', code: 'SLZ-MA', state: 'MA', cityIbgeCode: '2111300', active: true },
        ]);
        replace(prisma.city, 'findMany', async () => [{ ibgeCode: '2112803', name: 'Viana', state: { code: 'MA' } }]);
        replace(prisma.fiscalEmitter, 'findMany', async () => []);
        replace(prisma.hubCoverage, 'findMany', async () => []);
        replace(prisma.pricingRoute, 'findMany', async () => availableRoutes());
        replace(prisma.pricingRoute, 'findUnique', async (args) => routes.find((r) => r.id === args.where.id) ?? null);
        replace(prisma.pricingTable, 'findMany', async () => tables());
        replace(prisma.pricingTable, 'findFirst', async (args) => tables().find((table) => Object.entries(args.where).every(([key, value]) => table[key as keyof typeof table] === value)) ?? null);
        replace(prisma.orderFreightCalculation, 'findFirst', async (args) => {
            const calc = calcs.get(args.where.id);
            return calc ? { ...calc, pricingTable: tables().find((t) => t.id === calc.pricingTableId) ?? null } : null;
        });
        replace(prisma.orderFreightCalculation, 'update', async (args) => {
            const calc = calcs.get(args.where.id);
            Object.assign(calc, args.data);
            return calc;
        });
        replace(prisma.orderFreightCalculation, 'findUniqueOrThrow', async (args) => calcs.get(args.where.id));
        replace(prisma, '$transaction', async (callback) => {
            transactions++;
            return callback({
                $executeRaw: async () => 1,
                orderFreightCalculation: {
                    findMany: async () => [],
                    create: async (args: any) => {
                        const calc = { id: `calc-${calcs.size}`, status: 'DRAFT', ...args.data };
                        calcs.set(calc.id, calc);
                        return calc;
                    },
                },
            });
        });

        const app = express();
        app.use(express.json());
        app.use('/api/orders/:orderId/freight-calculations', freightCalculationsRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', resolve));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;
        token = jwt.sign({ userId: 'admin-pricing' }, process.env.JWT_SECRET);
    });

    beforeEach(() => {
        ambiguousRoutes = false;
        transactions = 0;
        calcs.clear();
    });

    after(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
        restores.reverse().forEach((restore) => restore());
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
    });

    const prepare = (body: object) => httpJson<{ success: boolean; error?: string; data: { calc: any } }>(
        baseUrl, `/api/orders/${orderId}/freight-calculations/prepare`, token,
        { method: 'POST', body: JSON.stringify({ documentType: 'MINUTA', ...body }) },
    );

    it('mantém a recomendação quando nenhuma tabela é escolhida', async () => {
        const response = await prepare({});
        assert.equal(response.status, 201);
        assert.equal(response.body.data.calc.pricingTableId, 'special-payer');
        assert.equal(response.body.data.calc.calculationMethod, 'ESPECIAL');
        assert.equal(response.body.data.calc.freightTotal, 10);
    });

    it('usa método, rota e valor da tabela alternativa em vez da especial recomendada', async () => {
        const response = await prepare({ pricingTableId: 'general-imp', routeId: 'route-forged', calculationMethod: 'ESPECIAL' });
        assert.equal(response.status, 201);
        assert.equal(response.body.data.calc.pricingTableId, 'general-imp');
        assert.equal(response.body.data.calc.calculationMethod, 'TARIFA_GERAL');
        assert.equal(response.body.data.calc.routeId, 'route-imp');
        assert.equal(response.body.data.calc.freightTotal, 20);
    });

    it('preserva rota nula da tarifa geral sem rota mesmo quando o pedido tem rota', async () => {
        const response = await prepare({ pricingTableId: 'general-routeless' });
        assert.equal(response.status, 201);
        assert.equal(response.body.data.calc.pricingTableId, 'general-routeless');
        assert.equal(response.body.data.calc.routeId, null);
        assert.equal(response.body.data.calc.freightTotal, 40);
    });

    it('permite escolher tabela quando várias rotas por UF deixam a recomendação vazia', async () => {
        ambiguousRoutes = true;
        const response = await prepare({ pricingTableId: 'general-slz' });
        assert.equal(response.status, 201);
        assert.equal(response.body.data.calc.pricingTableId, 'general-slz');
        assert.equal(response.body.data.calc.routeId, 'route-slz');
        assert.equal(response.body.data.calc.freightTotal, 30);
    });

    it('rejeita tabela que não pertence às opções sem persistir um cálculo', async () => {
        const response = await prepare({ pricingTableId: 'table-of-another-payer' });
        assert.equal(response.status, 400);
        assert.match(response.body.error ?? '', /tabela escolhida não está disponível/);
        assert.equal(transactions, 0);
        assert.equal(calcs.size, 0);
    });

    it('exige motivo para valor informado quando há opções e nenhuma recomendação', async () => {
        ambiguousRoutes = true;
        const response = await prepare({ informed: { freightBase: 25 } });
        assert.equal(response.status, 400);
        assert.match(response.body.error ?? '', /Diga o motivo/);
        assert.equal(transactions, 0);
    });
});
