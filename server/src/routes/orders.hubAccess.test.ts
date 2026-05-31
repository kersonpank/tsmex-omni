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

describe('orders routes — acesso HUB alinhado à listagem', () => {
    const jwtSecret = `it-secret-hub-${Date.now()}`;
    const hubId = 'hub-sp-gru';
    const orderId = 'e3925f50-c5ba-4f6f-8324-fdd14ee876fe';
    let token = '';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        orderFindUnique: prisma.order.findUnique,
        orderFindFirst: prisma.order.findFirst,
        orderAttachmentFindMany: prisma.orderAttachment.findMany,
    };

    const hubVisibleOrder = {
        id: orderId,
        status: 'IN_TRANSIT',
        currentHubId: null,
        demandId: 'demand-1',
        demand: {
            id: 'demand-1',
            expectedHubId: hubId,
            client: { accountId: 'acc-1', companyName: 'Cliente Teste' },
            events: [],
        },
        opportunity: null,
        manifest: null,
        currentHub: null,
        remetentePerson: { id: 'p1', legalName: 'Remetente', document: '123', documentType: 'CNPJ' },
        destinatarioPerson: { id: 'p2', legalName: 'Destinatário', document: '456', documentType: 'CNPJ' },
        consignatarioPerson: null,
        expedidorPerson: null,
        redespachantePerson: null,
        route: null,
        history: [],
        invoices: [],
        invoicesRel: [],
        freightCalculations: [],
        attachments: [],
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = ((async () => ({
            id: 'hub-user-1',
            email: 'hub@tsmex.com',
            roles: ['HUB'],
            active: true,
            hubId,
            permissions: [],
            admin: null,
            client: null,
            link: null,
        })) as unknown) as typeof prisma.user.findUnique;

        prisma.order.findFirst = ((async (args: any) => {
            const idFilter = args?.where?.id;
            if (idFilter === orderId) {
                return { id: orderId };
            }
            return null;
        }) as unknown) as typeof prisma.order.findFirst;

        prisma.order.findUnique = ((async () => hubVisibleOrder) as unknown) as typeof prisma.order.findUnique;

        prisma.orderAttachment.findMany = ((async () => []) as unknown) as typeof prisma.orderAttachment.findMany;

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

        token = jwt.sign({ userId: 'hub-user-1' }, jwtSecret);
    });

    after(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.order.findUnique = original.orderFindUnique;
        prisma.order.findFirst = original.orderFindFirst;
        prisma.orderAttachment.findMany = original.orderAttachmentFindMany;
    });

    it('GET /orders/:id retorna 200 quando pedido é visível via expectedHubId (sem currentHubId)', async () => {
        const res = await httpJson<{ success: boolean; data: { id: string } }>(
            baseUrl,
            `/api/orders/${orderId}`,
            token,
        );
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.id, orderId);
    });

    it('GET /orders/:id/attachments retorna 200 no mesmo escopo HUB', async () => {
        const res = await httpJson<{ success: boolean; data: unknown[] }>(
            baseUrl,
            `/api/orders/${orderId}/attachments`,
            token,
        );
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.ok(Array.isArray(res.body.data));
    });
});
