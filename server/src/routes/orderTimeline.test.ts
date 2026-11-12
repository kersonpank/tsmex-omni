import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { actorLabel } from '../services/orderTimeline.js';

const orderId = '11111111-1111-4111-8111-111111111111';
const secret = 'isolated-order-timeline-test';
const original = { user: prisma.user.findUnique, users: prisma.user.findMany, first: prisma.order.findFirst, order: prisma.order.findUnique };
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let user: { id: string; active: boolean; roles: string[]; hubId: string | null };
let visible = true;

before(async () => {
    process.env.JWT_SECRET = secret;
    prisma.user.findUnique = (async () => user) as any;
    prisma.user.findMany = (async () => [{ id: 'u1', email: 'maria@tsm.com', person: null }]) as any;
    prisma.order.findFirst = (async () => (visible ? { id: orderId } : null)) as any;
    prisma.order.findUnique = (async () => ({
        id: orderId, status: 'AT_HUB', enteredAtHubAt: new Date(), currentHub: { id: 'h', name: 'Hub A' }, demand: { orderNumber: 7, origin: 'A', destination: 'B' },
        history: [{ id: 'x', eventType: 'AT_HUB', description: 'Recebido', location: 'Hub A', photoUrl: null, createdAt: new Date(), actorUserId: 'u1' }],
        legs: [], deliveryAttempts: [],
    })) as any;
    const { orderTimelineRouter } = await import('./orderTimeline.js');
    const app = express();
    app.use('/api/orders/:id/timeline', orderTimelineRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    prisma.user.findUnique = original.user;
    prisma.user.findMany = original.users;
    prisma.order.findFirst = original.first;
    prisma.order.findUnique = original.order;
});

beforeEach(() => {
    user = { id: 'u1', active: true, roles: ['HUB'], hubId: 'hub-a' };
    visible = true;
});

const get = async (roleToken = 'u1') => {
    const response = await fetch(`${baseUrl}/api/orders/${orderId}/timeline`, { headers: { authorization: `Bearer ${jwt.sign({ userId: roleToken }, secret)}` } });
    return { status: response.status, body: await response.json() as any };
};

describe('GET /orders/:id/timeline', () => {
    it('HUB com acesso ao pedido recebe a linha do tempo com o nome de quem fez', async () => {
        const res = await get();
        assert.equal(res.status, 200);
        assert.equal(res.body.data.history[0].actorName, 'maria');
        assert.equal(res.body.data.order.orderNumber, 7);
    });
    it('HUB sem acesso ao pedido recebe 403', async () => {
        visible = false;
        assert.equal((await get()).status, 403);
    });
    it('CLIENT não acessa', async () => {
        user = { id: 'u1', active: true, roles: ['CLIENT'], hubId: null };
        assert.equal((await get()).status, 403);
    });
    it('ADMIN acessa sem checagem de hub', async () => {
        user = { id: 'u1', active: true, roles: ['ADMIN'], hubId: null };
        visible = false;
        assert.equal((await get()).status, 200);
    });
});

describe('actorLabel', () => {
    it('prefere a razão social/nome da Pessoa e cai para o início do e-mail', () => {
        assert.equal(actorLabel({ email: 'a@b.com', person: { legalName: 'Ana Souza' } }), 'Ana Souza');
        assert.equal(actorLabel({ email: 'joao@b.com', person: null }), 'joao');
        assert.equal(actorLabel(null), null);
    });
});
