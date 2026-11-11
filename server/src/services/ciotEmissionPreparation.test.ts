import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { prepareCiotEmission } from './ciotEmissionPreparation.js';
import { departureReadyManifest } from '../test/departureReadyFixture.js';

const original = prisma.$transaction;
const version = new Date('2026-10-05T12:00:00Z');
let manifest: any; let job: any; let writes: any[]; let authorized: boolean; let locked: boolean;
beforeEach(() => {
    manifest = departureReadyManifest({ id: 'trip', status: 'ACCEPTED', tripType: 'TRANSFER', hubId: 'origin', destHubId: 'dest', origin: 'São Paulo', destination: 'Imperatriz', updatedAt: version, legs: [{ id: 'leg' }] });
    manifest.fiscalEmitter = { active: true, efreteEnvironment: 'HOMOLOGACAO', person: { document: '11222333000181', legalName: 'Emitente', ...manifest.link.person } };
    job = null; writes = []; authorized = false; locked = false;
    prisma.$transaction = (async (fn: any) => fn({
        $queryRaw: async () => { locked = true; return []; },
        manifest: { findUnique: async () => manifest, findUniqueOrThrow: async () => manifest, update: async (args: any) => { writes.push(args); return {}; } },
        orderLeg: { findMany: async () => [] },
        ciotEmissionAttempt: { create: async () => ({ id: 'history' }) },
        manifestFiscalDocument: { findMany: async () => [], findFirst: async (args: any) => authorized && args.where.status === 'AUTHORIZED' ? { id: 'authorized' } : null },
        ciotEmissionJob: {
            findFirst: async () => job,
            count: async () => job ? 1 : 0,
            create: async (args: any) => { assert.equal(locked, true); writes.push(args); job = { id: 'new-job', ...args.data }; return job; },
            update: async (args: any) => { assert.equal(locked, true); writes.push(args); job = { ...job, ...args.data }; return job; },
        },
    })) as any;
});
afterEach(() => { prisma.$transaction = original; });
const input = () => ({ manifestId: 'trip', expectedUpdatedAt: version, tipoViagem: 'PADRAO' as const, requestData: { documentoViagem: 'corrigido' } as any });
it('reserva uma única emissão e bloqueia segundo clique enquanto processa', async () => {
    const result = await prepareCiotEmission(input());
    assert.equal(result.environment, 'HOMOLOGACAO');
    await assert.rejects(prepareCiotEmission(input()), /processamento/);
    assert.equal(writes.length, 1);
});
it('rejeição confirmada reutiliza o ID idempotente e aplica os dados corrigidos', async () => {
    job = { id: 'original-job', phase: 'FAILED', idOperacaoCliente: 'CIOT-original', environment: 'HOMOLOGACAO' };
    const result = await prepareCiotEmission(input());
    assert.equal(result.id, 'original-job');
    assert.equal(result.idOperacaoCliente, 'CIOT-original');
    assert.equal((result.requestData as any).documentoViagem, 'corrigido');
    assert.equal(result.phase, 'QUEUED');
});
it('timeout, documento autorizado e planejamento reaberto não são reenviados', async () => {
    job = { id: 'original-job', phase: 'PENDING_RECONCILIATION' };
    await assert.rejects(prepareCiotEmission(input()), /conciliação/);
    job = null; authorized = true;
    await assert.rejects(prepareCiotEmission(input()), /autorizado/);
    authorized = false; manifest.status = 'DRAFT';
    await assert.rejects(prepareCiotEmission(input()), /mudou/);
    assert.equal(writes.length, 0);
});
