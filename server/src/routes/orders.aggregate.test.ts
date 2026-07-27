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

describe('GET /orders/aggregate — somatórias de peso/volume/valor/quantidade', () => {
    const jwtSecret = `it-secret-orders-aggregate-${Date.now()}`;

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
        demandAggregate: prisma.demand.aggregate,
    };

    let lastAggregateArgs: any = null;

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
        lastAggregateArgs = null;
        prisma.demand.aggregate = (async (args: any) => {
            lastAggregateArgs = args;
            return {
                _sum: { weight: 123.5, volume: 4.2, nfValue: 987.65, units: 7 },
                _count: { _all: 3 },
            };
        }) as any;
    }

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = ((async (args: any) => usersById[args.where.id] ?? null) as unknown) as typeof prisma.user.findUnique;

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
        prisma.demand.aggregate = original.demandAggregate;
    });

    it('retorna a agregação básica sem filtros (ADMIN)', async () => {
        resetMocksToDefault();

        const res = await httpJson<{
            success: boolean;
            data: {
                totalOrders: number;
                totalWeightKg: number;
                totalVolumeM3: number;
                totalValueBRL: number;
                totalUnits: number;
            };
        }>(baseUrl, '/api/orders/aggregate', adminToken);

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.deepEqual(res.body.data, {
            totalOrders: 3,
            totalWeightKg: 123.5,
            totalVolumeM3: 4.2,
            totalValueBRL: 987.65,
            totalUnits: 7,
        });
    });

    it('retorna 403 quando usuário HUB não tem hubId atribuído', async () => {
        resetMocksToDefault();

        const res = await httpJson<{ success: boolean }>(
            baseUrl,
            '/api/orders/aggregate',
            hubNoHubToken,
        );

        assert.equal(res.status, 403);
        assert.equal(res.body.success, false);
    });

    it('escopa o where por hub quando usuário HUB tem hubId atribuído', async () => {
        resetMocksToDefault();

        const res = await httpJson<{ success: boolean; data: { totalOrders: number } }>(
            baseUrl,
            '/api/orders/aggregate',
            hubToken,
        );

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.totalOrders, 3);

        // Confirma que o where repassado ao prisma.demand.aggregate() carrega o escopo por hub
        // (aninhado em `order`, já que agregamos em Demand mas filtramos por Order).
        assert.ok(lastAggregateArgs, 'esperava que prisma.demand.aggregate tivesse sido chamado');
        const orderWhere = lastAggregateArgs.where.order;
        assert.ok(orderWhere, 'esperava where.order presente para escopar por Order');
        assert.ok(orderWhere.AND, 'esperava filtros AND (buildHubOrderVisibilityWhere) presentes no where do Order');
    });

    it('coalesce _sum nulos (zero pedidos casando o filtro) para 0 na resposta', async () => {
        prisma.demand.aggregate = (async (args: any) => {
            lastAggregateArgs = args;
            return {
                _sum: { weight: null, volume: null, nfValue: null, units: null },
                _count: { _all: 0 },
            };
        }) as any;

        const res = await httpJson<{
            success: boolean;
            data: {
                totalOrders: number;
                totalWeightKg: number;
                totalVolumeM3: number;
                totalValueBRL: number;
                totalUnits: number;
            };
        }>(baseUrl, '/api/orders/aggregate', adminToken);

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.deepEqual(res.body.data, {
            totalOrders: 0,
            totalWeightKg: 0,
            totalVolumeM3: 0,
            totalValueBRL: 0,
            totalUnits: 0,
        });
    });
});
