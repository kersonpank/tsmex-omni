import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

const manifestId = '11111111-1111-4111-8111-111111111111';
const secret = 'isolated-manifest-fiscal-closure-test';
const original = {
    user: prisma.user.findUnique,
    manifestAccess: prisma.manifest.findFirst,
    manifest: prisma.manifest.findUnique,
    docCount: prisma.manifestFiscalDocument.count,
    taskUpdateMany: prisma.fiscalClosureTask.updateMany,
    taskFind: prisma.fiscalClosureTask.findUnique,
    taskCreate: prisma.fiscalClosureTask.create,
};
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let actor: any;
let manifest: any;
let openDocuments: number;
let requeuedCount: number;
let existingTask: any;
let requeueArgs: any;
let created: any[];

before(async () => {
    process.env.JWT_SECRET = secret;
    prisma.user.findUnique = (async () => actor) as any;
    prisma.manifest.findFirst = (async () => manifest && ({ id: manifest.id })) as any;
    prisma.manifest.findUnique = (async () => manifest) as any;
    prisma.manifestFiscalDocument.count = (async () => openDocuments) as any;
    prisma.fiscalClosureTask.updateMany = (async (args: any) => { requeueArgs = args; return { count: requeuedCount }; }) as any;
    prisma.fiscalClosureTask.findUnique = (async () => existingTask) as any;
    prisma.fiscalClosureTask.create = (async ({ data }: any) => { created.push(data); return data; }) as any;
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

beforeEach(() => {
    actor = { id: 'admin-id', active: true, roles: ['ADMIN'], hubId: null };
    manifest = { id: manifestId, hubId: 'origin-hub', status: 'COMPLETED' };
    openDocuments = 2;
    requeuedCount = 0;
    existingTask = null;
    requeueArgs = null;
    created = [];
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    prisma.user.findUnique = original.user;
    prisma.manifest.findFirst = original.manifestAccess;
    prisma.manifest.findUnique = original.manifest;
    prisma.manifestFiscalDocument.count = original.docCount;
    prisma.fiscalClosureTask.updateMany = original.taskUpdateMany;
    prisma.fiscalClosureTask.findUnique = original.taskFind;
    prisma.fiscalClosureTask.create = original.taskCreate;
});

const retry = () => fetch(`${baseUrl}/api/manifests/${manifestId}/fiscal-closure/retry`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt.sign({ userId: 'admin-id' }, secret)}`, 'content-type': 'application/json' },
});

it('ADMIN reenfileira uma tarefa que exigia conciliação (202)', async () => {
    requeuedCount = 1;
    const response = await retry();
    assert.equal(response.status, 202);
    assert.deepEqual(requeueArgs.where.OR, [{ status: 'RECONCILIATION_REQUIRED' }, { status: 'PENDING', nextAttemptAt: { not: null } }]);
    assert.equal(requeueArgs.data.status, 'PENDING');
    assert.equal(requeueArgs.data.attemptCount, 0, 'o botão zera a contagem das repetições automáticas');
    assert.equal(requeueArgs.data.nextAttemptAt, null);
    assert.equal(created.length, 0);
});

it('sem tarefa anterior cria uma nova (202)', async () => {
    const response = await retry();
    assert.equal(response.status, 202);
    assert.deepEqual(created, [{ manifestId }]);
});

it('tarefa já em andamento responde 409 e não cria outra', async () => {
    existingTask = { status: 'PENDING' };
    const response = await retry();
    assert.equal(response.status, 409);
    assert.match((await response.json() as any).error, /em andamento/);
    assert.equal(created.length, 0);
});

it('sem CIOT/MDF-e aberto responde 409', async () => {
    openDocuments = 0;
    const response = await retry();
    assert.equal(response.status, 409);
    assert.match((await response.json() as any).error, /aberto/);
});

it('viagem que não está concluída responde 409', async () => {
    manifest.status = 'IN_PROGRESS';
    assert.equal((await retry()).status, 409);
});

it('viagem inexistente responde 404', async () => {
    manifest = null;
    assert.equal((await retry()).status, 404);
});

it('HUB de outro hub não repete o encerramento (403); HUB de origem pode', async () => {
    actor = { id: 'admin-id', active: true, roles: ['HUB'], hubId: 'other-hub' };
    assert.equal((await retry()).status, 403);
    actor = { id: 'admin-id', active: true, roles: ['HUB'], hubId: 'origin-hub' };
    requeuedCount = 1;
    assert.equal((await retry()).status, 202);
});
