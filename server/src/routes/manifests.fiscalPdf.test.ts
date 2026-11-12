import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

const manifestId = '11111111-1111-4111-8111-111111111111';
const secret = 'isolated-manifest-fiscal-pdf-test';
const original = {
    user: prisma.user.findUnique,
    manifest: prisma.manifest.findUnique,
    guard: prisma.manifest.findFirst,
    doc: prisma.manifestFiscalDocument.findFirst,
};
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let actor: any;
let manifest: any;
let doc: any;

before(async () => {
    process.env.JWT_SECRET = secret;
    process.env.S3_ENDPOINT = 'https://storage.example.com';
    process.env.S3_ACCESS_KEY = 'k';
    process.env.S3_SECRET_KEY = 's';
    prisma.user.findUnique = (async () => actor) as any;
    prisma.manifest.findUnique = (async () => manifest) as any;
    // Guarda de recurso (resourceGuard): a viagem só é "encontrada" para ADMIN ou hub de origem/destino/parada.
    prisma.manifest.findFirst = (async () => {
        const involved = actor.roles.includes('ADMIN') || [manifest.hubId, manifest.destHubId, ...manifest.tripStops.map((stop: any) => stop.destHubId)].includes(actor.hubId);
        return involved ? { id: manifestId } : null;
    }) as any;
    prisma.manifestFiscalDocument.findFirst = (async ({ where }: any) =>
        doc && where.documentType.in.includes(doc.documentType) && where.status.in.includes(doc.status) ? doc : null) as any;
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
    actor = { id: 'u1', active: true, roles: ['HUB'], hubId: 'dest-hub' };
    manifest = { hubId: 'origin-hub', destHubId: null, tripStops: [{ destHubId: 'dest-hub' }] };
    doc = { id: 'd1', documentType: 'MDFE', status: 'CLOSED', pdfUrl: 's3:fiscal/mdfe/d1/x.pdf' };
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    prisma.user.findUnique = original.user;
    prisma.manifest.findUnique = original.manifest;
    prisma.manifest.findFirst = original.guard;
    prisma.manifestFiscalDocument.findFirst = original.doc;
});

const get = () => fetch(`${baseUrl}/api/manifests/${manifestId}/fiscal-documents/d1/pdf`, {
    headers: { authorization: `Bearer ${jwt.sign({ userId: actor.id }, secret)}` },
});

it('hub de destino de uma parada baixa o PDF do MDF-e, inclusive depois de encerrado', async () => {
    const res = await get();
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json() as any;
    assert.match(body.downloadUrl, /fiscal\/mdfe\/d1\/x\.pdf/);
});

it('hub de origem e ADMIN também; hub sem relação com a viagem não', async () => {
    actor = { ...actor, hubId: 'origin-hub' };
    assert.equal((await get()).status, 200);
    actor = { ...actor, roles: ['ADMIN'], hubId: null };
    assert.equal((await get()).status, 200);
    actor = { ...actor, roles: ['HUB'], hubId: 'other-hub' };
    assert.equal((await get()).status, 404);
});

it('CIOT continua servido; documento recusado ou de outro tipo não', async () => {
    doc = { id: 'd1', documentType: 'CIOT', status: 'AUTHORIZED', pdfUrl: 's3:ciot/x.pdf' };
    assert.equal((await get()).status, 200);
    doc = { id: 'd1', documentType: 'MDFE', status: 'REJECTED', pdfUrl: null };
    assert.equal((await get()).status, 404);
});
