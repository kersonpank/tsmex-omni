import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type prisma from '../../lib/prisma.js';
import type { CteLookupOutcome, CteLookupQuery } from '../acbr/acbrCteLookup.js';
import { reconcileCteWithoutProviderId, PROVIDER_DOWN_AFTER_FAILURES, type CteReconcileDeps } from './cteReconcileWithoutId.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const OLD = new Date('2026-11-11T11:30:00Z'); // 30 min antes
const RECENT = new Date('2026-11-11T11:55:00Z'); // 5 min antes
type Row = Record<string, any>;

function setup(opts: { job?: Row; calc?: Row; outcome: CteLookupOutcome }) {
    const job: Row = {
        id: 'job-1', providerDocId: null, phase: 'PENDING_RECONCILIATION', submitStartedAt: OLD, createdAt: OLD, attemptCount: 0,
        ...opts.job,
    };
    const calc: Row = { id: 'calc-1', orderId: 'order-1', status: 'CTE_PENDING_RECONCILIATION', cteNumber: '21815', cteSeries: 1, cteAccessKey: null, ...opts.calc };
    const jobUpdates: Row[] = [];
    const calcUpdates: Row[] = [];
    const histories: Row[] = [];
    const enqueued: Row[] = [];
    const queries: CteLookupQuery[] = [];
    const db = {
        orderFreightCalculation: {
            findUnique: async () => ({ ...calc, cteEmissionJobs: [job] }),
            updateMany: async (a: Row) => { calcUpdates.push(a); return { count: 1 }; },
        },
        cteEmissionJob: {
            updateMany: async (a: Row) => {
                jobUpdates.push(a);
                const w = a.where;
                if ((w.providerDocId === null && job.providerDocId) || (w.phase && w.phase !== job.phase)) return { count: 0 };
                Object.assign(job, a.data);
                return { count: 1 };
            },
            update: async (a: Row) => { jobUpdates.push(a); Object.assign(job, a.data); return job; },
        },
        orderHistory: { create: async (a: Row) => { histories.push(a.data); return a.data; } },
    } as unknown as typeof prisma;
    const deps: Partial<CteReconcileDeps> = {
        db, now: () => NOW,
        lookup: async (q) => { queries.push(q); return opts.outcome; },
        enqueue: (async (d: Row) => { enqueued.push(d); return 'queue-id'; }) as CteReconcileDeps['enqueue'],
        loadInput: (async () => ({ input: { numero: 21815, serie: 1, ambiente: 'HOMOLOGACAO', person: { document: '12.345.678/0001-90' } }, fiscalEmitterContext: null })) as unknown as CteReconcileDeps['loadInput'],
    };
    return { job, deps, jobUpdates, calcUpdates, histories, enqueued, queries };
}

describe('reconcileCteWithoutProviderId', () => {
    it('(i) achou: grava providerDocId, segue para consulta poll-only e NAO reenvia', async () => {
        const t = setup({ outcome: { kind: 'FOUND', providerDocId: 'doc-7', matchedBy: 'referencia' } });
        const r = await reconcileCteWithoutProviderId('calc-1', t.deps);
        assert.deepEqual(r, { kind: 'FOUND_POLLING', providerDocId: 'doc-7' });
        assert.equal(t.job.providerDocId, 'doc-7');
        assert.equal(t.job.phase, 'POLLING');
        assert.deepEqual(t.enqueued, [{ calcId: 'calc-1', cteEmissionJobId: 'job-1', phaseHint: 'poll-only' }]);
        assert.equal(t.calcUpdates[0].data.status, 'CTE_PROCESSING');
        assert.deepEqual(t.queries[0].referencias, ['job-1']);
        assert.deepEqual(t.queries[0].legacyReferencias, ['calc-1']);
        assert.equal(t.queries[0].numero, 21815);
        assert.equal(t.queries[0].cpfCnpj, '12345678000190');
    });

    it('(ii) nao existe no provedor e envio > 10 min: reenfileira o MESMO job com a MESMA numeracao e registra no historico', async () => {
        const t = setup({ outcome: { kind: 'NOT_FOUND' } });
        const r = await reconcileCteWithoutProviderId('calc-1', t.deps);
        assert.deepEqual(r, { kind: 'RESUBMITTED' });
        assert.equal(t.job.phase, 'QUEUED');
        assert.equal(t.job.submitStartedAt, null);
        assert.equal(t.job.submissionGuardVersion, 1);
        assert.equal(t.job.queueJobId, 'queue-id');
        assert.equal(t.enqueued.length, 1);
        assert.equal(t.enqueued[0].cteEmissionJobId, 'job-1');
        assert.equal(t.enqueued[0].phaseHint, 'submit');
        assert.ok(t.enqueued[0].resubmitRunId);
        const calcStatus = t.calcUpdates.find((u) => u.data.status);
        assert.equal(calcStatus?.data.status, 'CTE_SENT');
        // numeracao: nada de cteNumber/cteSeries sendo reescrito
        assert.ok(t.calcUpdates.every((u) => !('cteNumber' in u.data)));
        assert.match(t.histories[0].description, /reenviado após conferência/);
        assert.match(t.histories[0].description, /21815/);
    });

    it('(ii) nao existe mas o envio tem menos de 10 min: NAO reenvia', async () => {
        const t = setup({ job: { submitStartedAt: RECENT, createdAt: RECENT }, outcome: { kind: 'NOT_FOUND' } });
        const r = await reconcileCteWithoutProviderId('calc-1', t.deps);
        assert.equal(r.kind, 'TOO_RECENT');
        assert.equal(t.enqueued.length, 0);
        assert.equal(t.job.phase, 'PENDING_RECONCILIATION');
    });

    it('(iii) busca falhou: continua pendente, conta a falha e NUNCA reenvia', async () => {
        const t = setup({ job: { attemptCount: 1 }, outcome: { kind: 'LOOKUP_FAILED', error: 'HTTP 503' } });
        const r = await reconcileCteWithoutProviderId('calc-1', t.deps);
        assert.deepEqual(r, { kind: 'PROVIDER_UNAVAILABLE', failedChecks: 2, error: 'HTTP 503' });
        assert.equal(t.job.attemptCount, 2);
        assert.equal(t.job.phase, 'PENDING_RECONCILIATION');
        assert.equal(t.enqueued.length, 0);
        assert.equal(t.calcUpdates.length, 0);
        assert.equal(PROVIDER_DOWN_AFTER_FAILURES, 3);
    });

    it('resposta do provedor zera a contagem de falhas seguidas', async () => {
        const t = setup({ job: { attemptCount: 2, submitStartedAt: RECENT, createdAt: RECENT }, outcome: { kind: 'NOT_FOUND' } });
        await reconcileCteWithoutProviderId('calc-1', t.deps);
        assert.equal(t.job.attemptCount, 0);
    });

    it('ambiguo: nao reenvia nem escolhe', async () => {
        const t = setup({ outcome: { kind: 'AMBIGUOUS', ids: ['a', 'b'] } });
        assert.deepEqual(await reconcileCteWithoutProviderId('calc-1', t.deps), { kind: 'AMBIGUOUS', ids: ['a', 'b'] });
        assert.equal(t.enqueued.length, 0);
    });

    it('com providerDocId ou fora da conciliacao: nao busca nada', async () => {
        const a = setup({ job: { providerDocId: 'x' }, outcome: { kind: 'NOT_FOUND' } });
        assert.deepEqual(await reconcileCteWithoutProviderId('calc-1', a.deps), { kind: 'HAS_PROVIDER_ID' });
        const b = setup({ calc: { status: 'CTE_AUTHORIZED' }, outcome: { kind: 'NOT_FOUND' } });
        assert.deepEqual(await reconcileCteWithoutProviderId('calc-1', b.deps), { kind: 'NOT_PENDING' });
        assert.equal(a.queries.length + b.queries.length, 0);
    });

    it('duas conferencias simultaneas: so uma consegue reenviar', async () => {
        const t = setup({ outcome: { kind: 'NOT_FOUND' } });
        const [a, b] = await Promise.all([reconcileCteWithoutProviderId('calc-1', t.deps), reconcileCteWithoutProviderId('calc-1', t.deps)]);
        assert.equal([a, b].filter((r) => r.kind === 'RESUBMITTED').length, 1);
        assert.equal(t.enqueued.length, 1);
    });

    it('falha ao enfileirar o reenvio devolve o job ao estado pendente', async () => {
        const t = setup({ outcome: { kind: 'NOT_FOUND' } });
        t.deps.enqueue = (async () => { throw new Error('redis fora'); }) as CteReconcileDeps['enqueue'];
        await assert.rejects(reconcileCteWithoutProviderId('calc-1', t.deps), /redis fora/);
        assert.equal(t.job.phase, 'PENDING_RECONCILIATION');
        assert.equal(t.calcUpdates.at(-1)?.data.status, 'CTE_PENDING_RECONCILIATION');
    });
});
