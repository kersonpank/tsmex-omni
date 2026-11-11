import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { departureReadyManifest, authorizedCiotFixture, authorizedMdfeFixture } from '../test/departureReadyFixture.js';

const id = '11111111-1111-4111-8111-111111111111';
const original = { user: prisma.user.findUnique, manifest: prisma.manifest.findUnique, scope: prisma.manifest.findFirst, legs: prisma.orderLeg.findMany, activeLeg: prisma.orderLeg.findFirst, fiscal: prisma.manifestFiscalDocument.findMany, transaction: prisma.$transaction, link: prisma.link.findFirst };
let server: ReturnType<express.Express['listen']>; let baseUrl: string;
let role: string; let hubId: string; let manifest: any; let mutations: any[]; let fiscalReady: boolean;
const secret = 'isolated-operator-release-tests';
before(async () => {
    process.env.JWT_SECRET = secret;
    prisma.user.findUnique = (async () => ({ id: 'operator', roles: [role], active: true, hubId })) as any;
    prisma.manifest.findUnique = (async () => manifest) as any;
    prisma.manifest.findFirst = (async () => ({ id })) as any;
    prisma.link.findFirst = (async () => ({ id: manifest.linkId })) as any;
    prisma.orderLeg.findMany = (async () => []) as any;
    prisma.orderLeg.findFirst = (async () => null) as any;
    prisma.manifestFiscalDocument.findMany = (async () => fiscalReady ? [authorizedCiotFixture, authorizedMdfeFixture] : []) as any;
    const tx = {
        $queryRaw: async () => [{ id }],
        manifest: { findUnique: async () => manifest, findUniqueOrThrow: async () => manifest, findMany: async () => [], updateMany: async ({ where, data }: any) => { mutations.push({ where, data }); if (manifest.status !== where.status) return { count: 0 }; manifest = { ...manifest, ...data }; return { count: 1 }; } },
        link: prisma.link,
        orderLeg: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
        manifestFiscalDocument: { findMany: async () => fiscalReady ? [authorizedCiotFixture, authorizedMdfeFixture] : [] },
        manifestStop: { updateMany: async () => ({ count: 0 }) },
    };
    prisma.$transaction = (async (fn: any) => fn(tx)) as any;
    const { manifestsRouter } = await import('./manifests.js');
    const app = express(); app.use(express.json()); app.use('/api/manifests', manifestsRouter); app.use(errorHandler);
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
    baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
    role = 'ADMIN'; hubId = 'origin'; mutations = []; fiscalReady = false;
    manifest = departureReadyManifest({ id, status: 'DRAFT', tripType: 'TRANSFER', hubId: 'origin', destHubId: 'dest', origin: 'São Paulo', destination: 'Imperatriz', updatedAt: new Date(), legs: [] });
    manifest._count.legs = 1;
    manifest.link.userId = null;
});
after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    prisma.user.findUnique = original.user; prisma.manifest.findUnique = original.manifest; prisma.manifest.findFirst = original.scope;
    prisma.orderLeg.findMany = original.legs; prisma.orderLeg.findFirst = original.activeLeg; prisma.manifestFiscalDocument.findMany = original.fiscal;
    prisma.$transaction = original.transaction; prisma.link.findFirst = original.link;
});
async function request(action: string, method = 'POST') {
    return fetch(`${baseUrl}/api/manifests/${id}/${action}`, { method, headers: { authorization: `Bearer ${jwt.sign({ userId: 'operator' }, secret)}`, 'content-type': 'application/json' }, body: '{}' });
}
it('ADMIN libera transportador sem conta e registra saída somente após evidência fiscal', async () => {
    assert.equal((await request('release')).status, 200);
    assert.equal(manifest.releaseSource, 'OPERATOR');
    assert.equal((await request('start', 'PATCH')).status, 422);
    fiscalReady = true;
    assert.equal((await request('start', 'PATCH')).status, 200);
    assert.equal(manifest.startedByUserId, 'operator');
    assert.equal(manifest.status, 'IN_PROGRESS');
    assert.equal((await request('start', 'PATCH')).status, 400);
});
it('HUB de origem libera oferta pendente e inicia; destino não pode realizar essas ações', async () => {
    role = 'HUB'; hubId = 'dest'; manifest.status = 'PENDING_ACCEPT';
    assert.equal((await request('release')).status, 403);
    manifest.status = 'ACCEPTED'; fiscalReady = true;
    assert.equal((await request('start', 'PATCH')).status, 403);
    assert.equal(mutations.length, 0);
    hubId = 'origin'; manifest.status = 'PENDING_ACCEPT';
    assert.equal((await request('release')).status, 200);
    assert.equal((await request('start', 'PATCH')).status, 200);
});
it('LINK mantém aceite de oferta mas não recebe poder de liberação operacional', async () => {
    role = 'LINK'; manifest.status = 'PENDING_ACCEPT';
    assert.equal((await request('release')).status, 403);
    assert.equal((await request('accept', 'PATCH')).status, 200);
    assert.equal(manifest.releaseSource, 'LINK');
    assert.equal((await request('accept', 'PATCH')).status, 409);
});
