import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { releaseManifest } from './manifestReleaseService.js';
import { departureReadyManifest } from '../test/departureReadyFixture.js';

const original = prisma.$transaction;
let manifest: any;
let conflicts: any[];
let compareSucceeds: boolean;
let mutations: any[];
beforeEach(() => {
    manifest = departureReadyManifest({ id: 'trip', status: 'DRAFT', tripType: 'TRANSFER', hubId: 'origin', destHubId: 'dest', origin: 'São Paulo', destination: 'Imperatriz', updatedAt: new Date(), legs: [{ id: 'leg' }] });
    manifest.link.userId = null;
    conflicts = []; compareSucceeds = true; mutations = [];
    // O teste executa as mesmas validações com o cliente transacional, sem banco/API.
    prisma.$transaction = (async (fn: any) => fn({
        $queryRaw: async () => [{ id: 'trip' }],
        manifest: {
            findUnique: async () => manifest,
            findMany: async () => conflicts,
            findUniqueOrThrow: async () => manifest,
            updateMany: async ({ where, data }: any) => {
                mutations.push({ where, data });
                if (!compareSucceeds) return { count: 0 };
                manifest = { ...manifest, ...data }; return { count: 1 };
            },
        },
        link: { findFirst: async () => ({ id: manifest.linkId }) },
        orderLeg: { findMany: async () => [] },
        manifestFiscalDocument: { findMany: async () => [] },
    })) as any;
});
afterEach(() => { prisma.$transaction = original; });

it('operador libera sem usuário Link e registra autoria, data e composição', async () => {
    const result = await releaseManifest('trip', { source: 'OPERATOR', userId: 'operator', hubId: 'origin' });
    assert.equal(result.status, 'ACCEPTED');
    assert.equal(result.releaseSource, 'OPERATOR');
    assert.equal(result.releasedByUserId, 'operator');
    assert.ok(result.releasedAt instanceof Date);
    assert.equal(result.acceptedAt, result.releasedAt);
    assert.equal((result.compositionSnapshot as any).traction.plate, 'ABC1D23');
    assert.equal(mutations[0].where.status, 'DRAFT');
    assert.ok(mutations[0].where.updatedAt);
});

it('liberação da oferta preserva retrato existente e não inventa aceite do motorista', async () => {
    manifest.status = 'PENDING_ACCEPT';
    manifest.compositionSnapshot = { traction: { ...manifest.link.tractionUnit, source: 'UNIT' }, trailers: [], units: [{ ...manifest.link.tractionUnit, source: 'UNIT' }] };
    const snapshot = manifest.compositionSnapshot;
    const result = await releaseManifest('trip', { source: 'OPERATOR', userId: 'admin', admin: true });
    assert.deepEqual(result.compositionSnapshot, snapshot);
    assert.equal(result.releaseSource, 'OPERATOR');
});

it('nega Hub de outra origem e motorista com dados ausentes antes de gravar', async () => {
    await assert.rejects(releaseManifest('trip', { source: 'OPERATOR', userId: 'hub', hubId: 'other' }), /unidade de origem/);
    assert.equal(mutations.length, 0);
    manifest.driver.document = null;
    await assert.rejects(releaseManifest('trip', { source: 'OPERATOR', userId: 'admin', admin: true }), /CPF/);
    assert.equal(mutations.length, 0);
});

it('preserva aceite pelo Link somente para oferta pendente e identifica a origem', async () => {
    await assert.rejects(releaseManifest('trip', { source: 'LINK', userId: 'link-user' }), /mudou de estado/);
    manifest.status = 'PENDING_ACCEPT';
    const result = await releaseManifest('trip', { source: 'LINK', userId: 'link-user' });
    assert.equal(result.releaseSource, 'LINK');
    assert.equal(result.releasedByUserId, 'link-user');
});

it('duplo clique, edição concorrente e veículo reservado não produzem nova liberação', async () => {
    await releaseManifest('trip', { source: 'OPERATOR', userId: 'admin', admin: true });
    await assert.rejects(releaseManifest('trip', { source: 'OPERATOR', userId: 'admin', admin: true }), /mudou de estado/);
    manifest.status = 'DRAFT'; compareSucceeds = false;
    await assert.rejects(releaseManifest('trip', { source: 'OPERATOR', userId: 'admin', admin: true }), /alterada durante/);
    conflicts = [{ id: 'other-trip', status: 'IN_PROGRESS' }];
    await assert.rejects(releaseManifest('trip', { source: 'OPERATOR', userId: 'admin', admin: true }), /reservado/);
});
