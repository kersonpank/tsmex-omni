import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';

import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpJson<T>(baseUrl: string, path: string, token: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        headers: {
            authorization: `Bearer ${token}`,
        },
    });
    return {
        status: response.status,
        body: await response.json() as T,
    };
}

describe('GET /orders/resolve — auth/hub scoping do handler', () => {
    const jwtSecret = `it-secret-orders-resolve-${Date.now()}`;

    const adminUserId = 'admin-user-1';
    const hubUserId = 'hub-user-1'; // hubId = 'hub-1'
    const hubNoHubUserId = 'hub-user-2'; // sem hubId

    let adminToken = '';
    let hubToken = '';
    let hubNoHubToken = '';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        manifestFindUnique: prisma.manifest.findUnique,
        orderInvoiceFindMany: prisma.orderInvoice.findMany,
        orderFreightCalculationFindMany: prisma.orderFreightCalculation.findMany,
        orderFindMany: prisma.order.findMany,
    };

    const usersById: Record<string, any> = {
        [adminUserId]: {
            id: adminUserId,
            email: 'admin@tsmex.com',
            roles: ['ADMIN'],
            active: true,
            hubId: null,
            permissions: [],
            admin: { id: 'admin-1' },
            client: null,
            link: null,
        },
        [hubUserId]: {
            id: hubUserId,
            email: 'hub@tsmex.com',
            roles: ['HUB'],
            active: true,
            hubId: 'hub-1',
            permissions: [],
            admin: null,
            client: null,
            link: null,
        },
        [hubNoHubUserId]: {
            id: hubNoHubUserId,
            email: 'hub-sem-hub@tsmex.com',
            roles: ['HUB'],
            active: true,
            hubId: null,
            permissions: [],
            admin: null,
            client: null,
            link: null,
        },
    };

    function resetMocksToDefault() {
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async () => []) as any;
        prisma.order.findMany = (async () => []) as any;
    }

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = ((async (args: any) => usersById[args.where.id] ?? null) as unknown) as typeof prisma.user.findUnique;

        prisma.manifest.findUnique = ((async (args: any) => {
            if (args.where.id === 'manifest-hub-1') return { hubId: 'hub-1' };
            if (args.where.id === 'manifest-hub-2') return { hubId: 'hub-2' };
            if (args.where.id === 'manifest-no-hub') return { hubId: null };
            return null;
        }) as unknown) as typeof prisma.manifest.findUnique;

        resetMocksToDefault();

        const { ordersRouter } = await import('./orders.js');
        const app = express();
        app.use(express.json());
        app.use('/api/orders', ordersRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;

        adminToken = jwt.sign({ userId: adminUserId }, jwtSecret);
        hubToken = jwt.sign({ userId: hubUserId }, jwtSecret);
        hubNoHubToken = jwt.sign({ userId: hubNoHubUserId }, jwtSecret);
    });

    after(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.manifest.findUnique = original.manifestFindUnique;
        prisma.orderInvoice.findMany = original.orderInvoiceFindMany;
        prisma.orderFreightCalculation.findMany = original.orderFreightCalculationFindMany;
        prisma.order.findMany = original.orderFindMany;
    });

    it('retorna 400 quando o código vem vazio', async () => {
        resetMocksToDefault();

        const res = await httpJson<{ success: boolean; error?: string }>(
            baseUrl,
            '/api/orders/resolve?code=',
            adminToken,
        );

        assert.equal(res.status, 400);
        assert.equal(res.body.success, false);
    });

    it('retorna 404 quando manifestId não existe', async () => {
        resetMocksToDefault();

        const res = await httpJson<{ success: boolean }>(
            baseUrl,
            '/api/orders/resolve?code=12345678&manifestId=manifest-inexistente',
            adminToken,
        );

        assert.equal(res.status, 404);
        assert.equal(res.body.success, false);
    });

    it('retorna 403 quando o hub do usuário HUB não bate com o hub do manifesto', async () => {
        resetMocksToDefault();

        const res = await httpJson<{ success: boolean }>(
            baseUrl,
            '/api/orders/resolve?code=12345678&manifestId=manifest-hub-2',
            hubToken,
        );

        assert.equal(res.status, 403);
        assert.equal(res.body.success, false);
    });

    it('retorna 403 quando usuário HUB não tem hubId atribuído e não passou manifestId (fail closed, não busca em todos os hubs)', async () => {
        resetMocksToDefault();

        const res = await httpJson<{ success: boolean }>(
            baseUrl,
            '/api/orders/resolve?code=12345678',
            hubNoHubToken,
        );

        assert.equal(res.status, 403);
        assert.equal(res.body.success, false);
    });

    it('retorna 403 quando usuário HUB sem hubId referencia manifesto sem hub de origem (ambos sem hub — fail closed)', async () => {
        resetMocksToDefault();

        const res = await httpJson<{ success: boolean }>(
            baseUrl,
            '/api/orders/resolve?code=12345678&manifestId=manifest-no-hub',
            hubNoHubToken,
        );

        assert.equal(res.status, 403);
        assert.equal(res.body.success, false);
    });

    it('retorna 200 com match "single" no caminho feliz (chave de 44 dígitos)', async () => {
        const key = '9'.repeat(44);
        const resolvedOrder = {
            id: 'order-happy-path',
            nfNumber: '555',
            status: 'AT_HUB',
            currentHubId: 'hub-1',
            demand: { origin: 'São Paulo', destination: 'Imperatriz' },
        };

        prisma.orderInvoice.findMany = (async () => [{ order: resolvedOrder }]) as any;
        prisma.orderFreightCalculation.findMany = (async () => []) as any;
        prisma.order.findMany = (async () => []) as any;

        const res = await httpJson<{ success: boolean; match: string; order?: { id: string } }>(
            baseUrl,
            `/api/orders/resolve?code=${key}`,
            adminToken,
        );

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.match, 'single');
        assert.equal(res.body.order?.id, 'order-happy-path');
    });
});
