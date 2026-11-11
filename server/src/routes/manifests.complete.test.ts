import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

const manifestId = '11111111-1111-4111-8111-111111111111';
const secret = 'isolated-manifest-complete-test';
const original = {
    user: prisma.user.findUnique, manifest: prisma.manifest.findUnique, stop: prisma.manifestStop.findUnique,
    stopMany: prisma.manifestStop.findMany, admin: prisma.admin.findUnique, first: prisma.manifest.findFirst,
};
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let user: { id: string; active: boolean; roles: string[]; hubId: string | null };
let manifest: Record<string, unknown> | null;
let stop: Record<string, unknown> | null;

before(async () => {
    process.env.JWT_SECRET = secret;
    prisma.user.findUnique = (async () => user) as any;
    // Manifesto já concluído: quem passa na autorização esbarra em 400 do serviço, sem tocar no banco.
    prisma.manifest.findUnique = (async () => manifest) as any;
    prisma.manifestStop.findUnique = (async () => stop) as any;
    prisma.manifestStop.findMany = (async () => []) as any;
    prisma.admin.findUnique = (async () => null) as any;
    prisma.manifest.findFirst = (async () => ({ id: manifestId })) as any;
    const { manifestsRouter } = await import('./manifests.js');
    const app = express();
    app.use(express.json());
    app.use('/api/manifests', manifestsRouter);
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
    prisma.manifest.findUnique = original.manifest;
    prisma.manifestStop.findUnique = original.stop;
    prisma.manifestStop.findMany = original.stopMany;
    prisma.admin.findUnique = original.admin;
    prisma.manifest.findFirst = original.first;
});

beforeEach(() => {
    user = { id: 'hub-user', active: true, roles: ['HUB'], hubId: 'hub-a' };
    manifest = { status: 'COMPLETED', tripType: 'DELIVERY', hubId: 'hub-a', destHubId: null };
    stop = { manifestId, purpose: 'DELIVERY', destHubId: null, manifest: { hubId: 'hub-a' } };
});

const call = async (path: string, body: object = {}) => {
    const response = await fetch(`${baseUrl}/api/manifests/${manifestId}${path}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId: 'hub-user' }, secret)}` },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
};

describe('autorização de conclusão pelo HUB', () => {
    it('hub de ORIGEM conclui viagem de entrega (passa da autorização; serviço recusa manifesto já concluído)', async () => {
        assert.equal((await call('/complete')).status, 400);
    });
    it('hub que NÃO é a origem da entrega recebe 403', async () => {
        manifest = { status: 'IN_PROGRESS', tripType: 'DELIVERY', hubId: 'hub-b', destHubId: null };
        assert.equal((await call('/complete')).status, 403);
    });
    it('transferência continua só para o hub destino', async () => {
        manifest = { status: 'COMPLETED', tripType: 'TRANSFER', hubId: 'hub-b', destHubId: 'hub-a' };
        assert.equal((await call('/complete')).status, 400);
        manifest = { status: 'COMPLETED', tripType: 'TRANSFER', hubId: 'hub-a', destHubId: 'hub-b' };
        assert.equal((await call('/complete')).status, 403);
    });
    it('parada de entrega: hub de origem passa, outro hub recebe 403', async () => {
        manifest = { status: 'COMPLETED', id: manifestId };
        assert.equal((await call('/stops/s1/complete')).status, 400);
        stop = { manifestId, purpose: 'DELIVERY', destHubId: null, manifest: { hubId: 'hub-b' } };
        assert.equal((await call('/stops/s1/complete')).status, 403);
    });
    it('parada de transferência: só o hub destino', async () => {
        manifest = { status: 'COMPLETED', id: manifestId };
        stop = { manifestId, purpose: 'TRANSFER', destHubId: 'hub-a', manifest: { hubId: 'hub-b' } };
        assert.equal((await call('/stops/s1/complete')).status, 400);
        stop = { manifestId, purpose: 'TRANSFER', destHubId: 'hub-b', manifest: { hubId: 'hub-a' } };
        assert.equal((await call('/stops/s1/complete')).status, 403);
    });
});

describe('conferência de chegada no corpo da conclusão', () => {
    const orderId = '22222222-2222-4222-8222-222222222222';
    beforeEach(() => {
        manifest = { status: 'COMPLETED', tripType: 'TRANSFER', hubId: 'hub-b', destHubId: 'hub-a' };
        stop = { manifestId, purpose: 'TRANSFER', destHubId: 'hub-a', manifest: { hubId: 'hub-b' } };
    });

    it('arrivals inválido é recusado com 400 antes de tocar a viagem (resultado desconhecido)', async () => {
        const res = await call('/complete', { arrivals: [{ orderId, result: 'LOST' }] });
        assert.equal(res.status, 400);
        assert.doesNotMatch(res.body.error, /not in progress/);
        const stopRes = await call('/stops/s1/complete', { arrivals: [{ orderId: 'nao-uuid', result: 'OK' }] });
        assert.equal(stopRes.status, 400);
        assert.doesNotMatch(stopRes.body.error, /not in progress/);
    });

    it('arrivals válido chega ao serviço (hub destino autorizado); sem arrivals continua aceito', async () => {
        const withArrivals = await call('/complete', { arrivals: [{ orderId, result: 'MISSING', note: 'não veio' }] });
        assert.equal(withArrivals.status, 400);
        assert.match(withArrivals.body.error, /not in progress/);
        const legacy = await call('/complete', {});
        assert.match(legacy.body.error, /not in progress/);
    });

    it('hub que não é destino não consegue concluir nem com arrivals', async () => {
        manifest = { status: 'IN_PROGRESS', tripType: 'TRANSFER', hubId: 'hub-b', destHubId: 'hub-c' };
        assert.equal((await call('/complete', { arrivals: [{ orderId, result: 'OK' }] })).status, 403);
    });
});
