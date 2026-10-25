import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

const origin = '11111111-1111-4111-8111-111111111111';
const destination = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const vehicleTypeId = '44444444-4444-4444-8444-444444444444';
const secret = 'isolated-hub-consolidate-test';
const originalSecret = process.env.JWT_SECRET;
const originals = {
    user: prisma.user.findUnique,
    admin: prisma.admin.findUnique,
    orders: prisma.order.findMany,
    hubs: prisma.hub.findMany,
    coverage: prisma.hubCoverage.findMany,
};
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let roles = ['HUB'];
let permissions = ['manifestos'];
let queriedHub: string | undefined;

before(async () => {
    process.env.JWT_SECRET = secret;
    prisma.user.findUnique = (async () => ({ id: 'operator', roles, permissions, active: true, hubId: origin })) as any;
    prisma.admin.findUnique = (async () => null) as any;
    prisma.order.findMany = (async ({ where }: any) => { queriedHub = where.currentHubId; return []; }) as any;
    prisma.hub.findMany = (async () => []) as any;
    prisma.hubCoverage.findMany = (async () => []) as any;
    const { hubCargoRouter } = await import('./hubCargo.js');
    const app = express();
    app.use(express.json());
    app.use('/api/hub/cargo', hubCargoRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
    roles = ['HUB'];
    permissions = ['manifestos'];
    queriedHub = undefined;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    prisma.user.findUnique = originals.user;
    prisma.admin.findUnique = originals.admin;
    prisma.order.findMany = originals.orders;
    prisma.hub.findMany = originals.hubs;
    prisma.hubCoverage.findMany = originals.coverage;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
});

async function consolidate(route: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/hub/cargo/queues/consolidate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt.sign({ userId: 'operator' }, secret)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ groupKey: 'UNROUTED', orderIds: [orderId], vehicleTypeId, ...route }),
    });
}

it('Zod aceita destHubId e entrega local, sem aceitar destino malformado', async () => {
    assert.equal((await consolidate({ destHubId: destination })).status, 409);
    assert.equal((await consolidate({ local: true })).status, 409);
    assert.equal((await consolidate({ destHubId: 'not-a-uuid' })).status, 400);
});

it('Zod rejeita escolhas ambíguas e local diferente de true', async () => {
    assert.equal((await consolidate({ destHubId: destination, local: true })).status, 400);
    assert.equal((await consolidate({ local: false })).status, 400);
    assert.equal((await consolidate({ local: 'true' })).status, 400);
    assert.equal(queriedHub, undefined);
});

it('HUB continua operando apenas o próprio hub, mesmo com hubId enviado no corpo', async () => {
    assert.equal((await consolidate({ groupKey: 'stock-selection', hubId: destination, local: true })).status, 409);
    assert.equal(queriedHub, origin);
});

it('papel sem acesso e HUB sem permissão de manifestos continuam impedidos', async () => {
    roles = ['CLIENT'];
    assert.equal((await consolidate({ local: true })).status, 403);
    roles = ['HUB'];
    permissions = ['pedidos'];
    assert.equal((await consolidate({ local: true })).status, 403);
    assert.equal(queriedHub, undefined);
});
