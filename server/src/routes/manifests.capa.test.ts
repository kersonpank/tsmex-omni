import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

const manifestId = '11111111-1111-4111-8111-111111111111';
const secret = 'isolated-manifest-capa-test';
const original = { user: prisma.user.findUnique, findFirst: prisma.manifest.findFirst, findUnique: prisma.manifest.findUnique, update: prisma.manifest.update };
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let updates: any[];

before(async () => {
    process.env.JWT_SECRET = secret;
    prisma.user.findUnique = (async () => ({ id: 'admin-id', active: true, roles: ['ADMIN'], hubId: null })) as any;
    prisma.manifest.findFirst = (async () => ({ id: manifestId })) as any;
    prisma.manifest.findUnique = (async () => ({ hubId: 'hub-1', status: 'DRAFT' })) as any;
    prisma.manifest.update = (async (args: any) => { updates.push(args); return { id: manifestId, ...args.data }; }) as any;
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

beforeEach(() => { updates = []; });

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    prisma.user.findUnique = original.user;
    prisma.manifest.findFirst = original.findFirst;
    prisma.manifest.findUnique = original.findUnique;
    prisma.manifest.update = original.update;
});

const patch = async (body: object) => {
    const response = await fetch(`${baseUrl}/api/manifests/${manifestId}/capa`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId: 'admin-id' }, secret)}` }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
};

it('capa grava a averbação do seguro com trim e devolve o valor', async () => {
    const res = await patch({ cargoInsuranceAverbacao: '  AV-1; AV-2  ' });
    assert.equal(res.status, 200);
    assert.equal(updates[0].data.cargoInsuranceAverbacao, 'AV-1; AV-2');
    assert.equal(res.body.data.cargoInsuranceAverbacao, 'AV-1; AV-2');
});

it('capa limpa a averbação quando vazia e não mexe nela quando ausente', async () => {
    assert.equal((await patch({ cargoInsuranceAverbacao: '' })).status, 200);
    assert.equal(updates[0].data.cargoInsuranceAverbacao, null);
    assert.equal((await patch({ notes: 'x' })).status, 200);
    assert.equal(updates[1].data.cargoInsuranceAverbacao, undefined);
});

it('capa recusa averbação acima de 500 caracteres', async () => {
    const res = await patch({ cargoInsuranceAverbacao: 'x'.repeat(501) });
    assert.equal(res.status, 400);
    assert.equal(updates.length, 0);
});
