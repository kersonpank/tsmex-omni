import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
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

        prisma.user.findUnique = ((async () => ({
            id: 'admin-1',
            email: 'admin@tsmex.com',
            roles: ['ADMIN'],
            active: true,
            hubId: null,
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
            calc.status = args?.data?.status ?? calc.status;
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
        assert.equal(response.body.data.tax.cfop?.code, '6352');
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
});
