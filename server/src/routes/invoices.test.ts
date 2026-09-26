import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpPost<T>(baseUrl: string, path: string, body: object, token: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    return {
        status: response.status,
        body: await response.json() as T,
    };
}

describe('invoices routes — validação de frete oficial (Brief 5)', () => {
    const jwtSecret = `it-secret-invoice-${Date.now()}`;
    const accountId = 'a0000000-0000-0000-0000-000000000001';
    const orderId = 'b0000000-0000-0000-0000-000000000002';
    let token = '';
    let currentRoles: Array<'ADMIN' | 'HUB'> = ['ADMIN'];
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        accountFindUnique: prisma.account.findUnique,
        orderFindUnique: prisma.order.findUnique,
        orderFreightCalculationFindFirst: prisma.orderFreightCalculation.findFirst,
        invoiceFindFirst: prisma.invoice.findFirst,
        invoiceItemFindFirst: prisma.invoiceItem.findFirst,
        invoiceCreate: prisma.invoice.create,
        queryRaw: prisma.$queryRaw,
        transaction: prisma.$transaction,
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        // Mock User as ADMIN
        prisma.user.findUnique = ((async () => ({
            id: 'admin-user-1',
            email: 'admin@tsmex.com',
            roles: currentRoles,
            active: true,
            permissions: [],
            admin: { id: 'adm-1' },
            client: null,
            link: null,
        })) as any);

        prisma.account.findUnique = ((async () => ({
            id: accountId,
            name: 'Conta Cliente'
        })) as any);
        prisma.order.findUnique = (async () => ({ demand: { client: { accountId } } })) as any;

        prisma.invoice.findFirst = (async () => null) as any;
        prisma.invoiceItem.findFirst = (async () => null) as any;

        prisma.invoice.create = (async ({ data }: any) => {
            return {
                id: 'inv-123',
                invoiceNumber: 'FAT-2026-001',
                ...data
            };
        }) as any;

        prisma.$transaction = (async (fn: any) => {
            return fn(prisma);
        }) as any;
        prisma.$queryRaw = (async () => []) as any;

        const { invoicesRouter } = await import('./invoices.js');
        const app = express();
        app.use(express.json());
        app.use('/api/invoices', invoicesRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;

        token = jwt.sign({ userId: 'admin-user-1' }, jwtSecret);
    });

    after(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.account.findUnique = original.accountFindUnique;
        prisma.order.findUnique = original.orderFindUnique;
        prisma.orderFreightCalculation.findFirst = original.orderFreightCalculationFindFirst;
        prisma.invoice.findFirst = original.invoiceFindFirst;
        prisma.invoiceItem.findFirst = original.invoiceItemFindFirst;
        prisma.invoice.create = original.invoiceCreate;
        prisma.$transaction = original.transaction;
        prisma.$queryRaw = original.queryRaw;
    });

    it('POST /invoices deve retornar 400 se o pedido não tiver cálculo de frete oficial', async () => {
        // Mock que não encontra nenhum cálculo oficial
        prisma.orderFreightCalculation.findFirst = (async () => null) as any;

        const res = await httpPost<{ success: boolean; error: string }>(
            baseUrl,
            '/api/invoices',
            {
                orderId,
                accountId,
                taxes: 10,
                discounts: 5,
            },
            token
        );

        assert.equal(res.status, 400);
        assert.equal(res.body.success, false);
        assert.match(res.body.error, /Pedido sem cálculo de frete oficial/);
    });

    it('POST /invoices deve herdar o frete oficial e ter sucesso se existir cálculo de frete', async () => {
        // Mock com cálculo oficial de 750.00
        prisma.orderFreightCalculation.findFirst = (async () => ({
            freightTotal: 750.00,
            status: 'CTE_AUTHORIZED',
        })) as any;

        const res = await httpPost<{ success: boolean; data: { subtotal: number; total: number } }>(
            baseUrl,
            '/api/invoices',
            {
                orderId,
                accountId,
                taxes: 50,
                discounts: 20,
            },
            token
        );

        assert.equal(res.status, 201);
        assert.equal(res.body.success, true);
        assert.equal(Number(res.body.data.subtotal), 750.00);
        assert.equal(Number(res.body.data.total), 780.00); // 750 + 50 - 20
    });

    it('denies invoice lists to a hub-only user', async () => {
        currentRoles = ['HUB'];
        try {
            const response = await fetch(`${baseUrl}/api/invoices`, { headers: { authorization: `Bearer ${token}` } });
            assert.equal(response.status, 403);
        } finally {
            currentRoles = ['ADMIN'];
        }
    });

    it('increments invoice numbers numerically after 999', async () => {
        prisma.$queryRaw = (async () => [{ lastNumber: 999n }]) as any;
        prisma.orderFreightCalculation.findFirst = (async () => ({ freightTotal: 750, status: 'CTE_AUTHORIZED' })) as any;
        try {
            const response = await httpPost<{ data: { invoiceNumber: string } }>(baseUrl, '/api/invoices', { orderId, accountId }, token);
            assert.equal(response.status, 201);
            assert.equal(response.body.data.invoiceNumber, `FAT-${new Date().getFullYear()}-1000`);
        } finally {
            prisma.$queryRaw = (async () => []) as any;
        }
    });
});
