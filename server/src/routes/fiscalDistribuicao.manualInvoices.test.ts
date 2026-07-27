import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpGet<T>(baseUrl: string, path: string, token: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}` },
    });
    return {
        status: response.status,
        body: (await response.json()) as T,
    };
}

describe('GET /fiscal/distribuicao-nfe/manual-invoices — OrderInvoice unificado na tela NF-e', () => {
    const jwtSecret = `it-secret-fiscal-manual-invoices-${Date.now()}`;
    let adminToken = '';
    let hubToken = '';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let lastFindManyArgs: any = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        orderInvoiceFindMany: prisma.orderInvoice.findMany,
    };

    const mockedInvoices = [
        {
            id: 'oi-1',
            type: 'NFE',
            nfNumber: '000123',
            nfKey: '35240100000000000000550010000001231000000012',
            emissionDate: '2026-07-20T00:00:00.000Z',
            weight: 100,
            volumes: 2,
            cubedVolume: null,
            value: 500,
            createdAt: '2026-07-21T10:00:00.000Z',
            order: {
                id: 'order-1',
                status: 'AT_HUB',
                currentHub: { id: 'hub-1', name: 'Hub Central', code: 'HUB01' },
                demand: { client: { companyName: 'Cliente Exemplo Ltda' } },
            },
        },
        {
            id: 'oi-2',
            type: 'OUTRAS',
            nfNumber: '000124',
            nfKey: null,
            emissionDate: null,
            weight: 50,
            volumes: 1,
            cubedVolume: null,
            value: 100,
            createdAt: '2026-07-22T10:00:00.000Z',
            order: {
                id: 'order-2',
                status: 'PENDING',
                currentHub: null,
                demand: { client: { companyName: 'Outro Cliente' } },
            },
        },
    ];

    function resetMocksToDefault() {
        lastFindManyArgs = null;
        prisma.orderInvoice.findMany = (async (args: any) => {
            lastFindManyArgs = args;
            return mockedInvoices;
        }) as any;
    }

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = (async ({ where }: any) => {
            if (where.id === 'admin-user-1') {
                return {
                    id: 'admin-user-1',
                    email: 'admin@tsmex.com',
                    roles: ['ADMIN'],
                    active: true,
                    hubId: null,
                    permissions: [],
                    admin: { id: 'adm-1' },
                    client: null,
                    link: null,
                };
            }
            return {
                id: 'hub-user-1',
                email: 'hub@tsmex.com',
                roles: ['HUB'],
                active: true,
                hubId: 'hub-1',
                permissions: [],
                admin: null,
                client: null,
                link: null,
            };
        }) as any;

        resetMocksToDefault();

        const { fiscalDistribuicaoRouter } = await import('./fiscalDistribuicao.js');
        const app = express();
        app.use(express.json());
        app.use('/api/fiscal', fiscalDistribuicaoRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;

        adminToken = jwt.sign({ userId: 'admin-user-1' }, jwtSecret);
        hubToken = jwt.sign({ userId: 'hub-user-1' }, jwtSecret);
    });

    after(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.orderInvoice.findMany = original.orderInvoiceFindMany;
    });

    it('retorna as OrderInvoice com contexto do pedido (caminho feliz)', async () => {
        resetMocksToDefault();

        const res = await httpGet<{ success: boolean; data: { invoices: typeof mockedInvoices } }>(
            baseUrl,
            '/api/fiscal/distribuicao-nfe/manual-invoices',
            adminToken,
        );

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.invoices.length, 2);
        assert.equal(res.body.data.invoices[0].order.demand.client.companyName, 'Cliente Exemplo Ltda');
        assert.equal(res.body.data.invoices[0].order.currentHub?.code, 'HUB01');
        assert.equal(res.body.data.invoices[1].nfKey, null);
    });

    it('sem `q`, o where repassado ao prisma é undefined (sem filtro)', async () => {
        resetMocksToDefault();

        const res = await httpGet<{ success: boolean }>(baseUrl, '/api/fiscal/distribuicao-nfe/manual-invoices', adminToken);

        assert.equal(res.status, 200);
        assert.ok(lastFindManyArgs, 'esperava que prisma.orderInvoice.findMany tivesse sido chamado');
        assert.equal(lastFindManyArgs.where, undefined);
        assert.equal(lastFindManyArgs.orderBy?.createdAt, 'desc');
        assert.equal(lastFindManyArgs.take, 200);
    });

    it('com `q`, monta where.OR cobrindo nfNumber, nfKey e nome do cliente', async () => {
        resetMocksToDefault();

        const res = await httpGet<{ success: boolean }>(
            baseUrl,
            '/api/fiscal/distribuicao-nfe/manual-invoices?q=exemplo',
            adminToken,
        );

        assert.equal(res.status, 200);
        assert.ok(lastFindManyArgs, 'esperava que prisma.orderInvoice.findMany tivesse sido chamado');
        const or = lastFindManyArgs.where?.OR;
        assert.ok(Array.isArray(or), 'esperava where.OR como array');
        assert.equal(or.length, 3);
        assert.deepEqual(or[0], { nfNumber: { contains: 'exemplo', mode: 'insensitive' } });
        assert.deepEqual(or[1], { nfKey: { contains: 'exemplo', mode: 'insensitive' } });
        assert.deepEqual(or[2], { order: { demand: { client: { companyName: { contains: 'exemplo', mode: 'insensitive' } } } } });
    });

    it('bloqueia HUB (rota ADMIN-only, cross-hub por natureza — mesma guarda do /monitor)', async () => {
        resetMocksToDefault();

        const res = await httpGet<{ success: boolean }>(baseUrl, '/api/fiscal/distribuicao-nfe/manual-invoices', hubToken);
        assert.equal(res.status, 403);
        assert.equal(res.body.success, false);
    });
});
