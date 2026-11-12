import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type prisma from '../../lib/prisma.js';
import { sweepPendingCteReconciliation } from './cteReconciliationSweep.js';

const NOW = new Date('2026-11-11T12:00:00Z');
type Row = Record<string, any>;

function calc(id: string, job: Row | null, extra: Row = {}): Row {
    return {
        id, orderId: `order-${id}-xxxxxxxx`, emissorId: 'hub-emissor',
        updatedAt: new Date('2026-11-11T11:00:00Z'),
        cteEmissionJobs: job ? [{ nextPollAt: null, attemptCount: 0, ...job }] : [],
        order: { currentHubId: 'hub-pedido', demand: { orderNumber: 42 } },
        ...extra,
    };
}

function fakeDb(calcs: Row[], alerts: Row[] = [], stillPending: string[] = []) {
    const jobUpdates: Row[] = [];
    const calcUpdates: Row[] = [];
    const created: Row[] = [];
    const resolved: Row[] = [];
    const claimed = new Set<string>();
    const deadlines: Row[] = [];
    const db = {
        orderFreightCalculation: {
            findMany: async (args: Row) => (args.where.id ? stillPending.map((id) => ({ id })) : calcs),
            updateMany: async (args: Row) => { calcUpdates.push(args); return { count: 1 }; },
        },
        cteEmissionJob: {
            updateMany: async (args: Row) => {
                if ('nextPollAt' in args.where) { deadlines.push(args); return { count: 1 }; }
                if (claimed.has(args.where.id)) return { count: 0 };
                const row = calcs.flatMap((c) => c.cteEmissionJobs).find((j: Row) => j.id === args.where.id);
                const ors: Row[] = args.where.OR ?? [];
                if (row && ors.length && !ors.some((o) => ('lastPolledAt' in o && o.lastPolledAt === null ? row.lastPolledAt === null : o.lastPolledAt?.lt && row.lastPolledAt && row.lastPolledAt < o.lastPolledAt.lt))) return { count: 0 };
                claimed.add(args.where.id);
                jobUpdates.push(args);
                return { count: 1 };
            },
            update: async (args: Row) => { jobUpdates.push(args); return {}; },
        },
        systemAlert: {
            findMany: async () => alerts,
            create: async (args: Row) => { created.push(args.data); return args.data; },
            updateMany: async (args: Row) => { resolved.push(args); return { count: args.where.id.in.length }; },
        },
    };
    return { db: db as unknown as typeof prisma, jobUpdates, calcUpdates, created, resolved, deadlines };
}

describe('sweepPendingCteReconciliation', () => {
    it('com providerDocId só consulta (poll-only) e move o calculo para PROCESSING', async () => {
        const { db, jobUpdates, calcUpdates } = fakeDb([calc('c1', { id: 'j1', providerDocId: 'doc-1', lastPolledAt: null })]);
        const calls: Row[] = [];
        const r = await sweepPendingCteReconciliation({ db, now: NOW, enqueue: async (d) => { calls.push(d); return 'q1'; } });
        assert.equal(r.requeued, 1);
        assert.deepEqual(calls, [{ calcId: 'c1', cteEmissionJobId: 'j1', phaseHint: 'poll-only' }]);
        assert.equal(jobUpdates[0].data.phase, 'POLLING');
        assert.equal(jobUpdates[0].data.lastPolledAt, NOW);
        assert.equal(calcUpdates[0].data.status, 'CTE_PROCESSING');
    });

    it('nao enfileira duas vezes o mesmo calculo (tentativa ja reivindicada)', async () => {
        const row = calc('c1', { id: 'j1', providerDocId: 'doc-1', lastPolledAt: null });
        const { db } = fakeDb([row, row]);
        let enqueued = 0;
        const r = await sweepPendingCteReconciliation({ db, now: NOW, enqueue: async () => { enqueued += 1; return 'q'; } });
        assert.equal(enqueued, 1);
        assert.equal(r.requeued, 1);
    });

    it('limita a 20 reenfileiramentos por rodada', async () => {
        const rows = Array.from({ length: 30 }, (_, i) => calc(`c${i}`, { id: `j${i}`, providerDocId: `d${i}`, lastPolledAt: null }));
        const { db } = fakeDb(rows);
        const r = await sweepPendingCteReconciliation({ db, now: NOW, enqueue: async () => 'q' });
        assert.equal(r.requeued, 20);
    });

    it('sem providerDocId: confere no provedor (reconcile) em vez de so abrir excecao; nao enfileira por conta propria', async () => {
        const { db, created, deadlines } = fakeDb([calc('c1', { id: 'j1', providerDocId: null, lastPolledAt: null })]);
        const asked: string[] = [];
        const r = await sweepPendingCteReconciliation({
            db, now: NOW, enqueue: async () => { throw new Error('nao deveria enfileirar'); },
            reconcile: async (id) => { asked.push(id); return { kind: 'RESUBMITTED' }; },
        });
        assert.deepEqual(asked, ['c1']);
        assert.equal(r.lookups, 1);
        assert.equal(r.resubmitted, 1);
        assert.equal(created.length, 0);
        // primeira vez que o varredor ve o caso: arma o teto de 48 h
        assert.equal(deadlines[0].data.nextPollAt.getTime(), NOW.getTime() + 48 * 3_600_000);
    });

    it('sem providerDocId: respeita o espacamento (2 min; 10 min depois de 3 falhas seguidas do provedor)', async () => {
        const threeMinAgo = new Date(NOW.getTime() - 3 * 60_000);
        const rows = [
            calc('ok2min', { id: 'a', providerDocId: null, lastPolledAt: threeMinAgo }),
            calc('recente', { id: 'b', providerDocId: null, lastPolledAt: new Date(NOW.getTime() - 60_000) }),
            calc('provedor-fora', { id: 'c', providerDocId: null, lastPolledAt: threeMinAgo, attemptCount: 3 }),
        ];
        const { db } = fakeDb(rows);
        const asked: string[] = [];
        await sweepPendingCteReconciliation({ db, now: NOW, reconcile: async (id) => { asked.push(id); return { kind: 'TOO_RECENT', retryAfterMs: 1 }; } });
        assert.deepEqual(asked, ['ok2min']);
    });

    it('um erro na conferencia de um calculo nao derruba os demais', async () => {
        const { db } = fakeDb([calc('c1', { id: 'j1', providerDocId: null, lastPolledAt: null }), calc('c2', { id: 'j2', providerDocId: null, lastPolledAt: null })]);
        const asked: string[] = [];
        const r = await sweepPendingCteReconciliation({ db, now: NOW, reconcile: async (id) => { asked.push(id); if (id === 'c1') throw new Error('boom'); return { kind: 'RESUBMITTED' }; } });
        assert.deepEqual(asked, ['c1', 'c2']);
        assert.equal(r.resubmitted, 1);
    });

    it('apos 48 h sem solucao: para de reconsultar e deixa UMA excecao para o hub do pedido, sem duplicar', async () => {
        const expired = new Date(NOW.getTime() - 1000);
        const rows = [
            calc('velho-sem-id', { id: 'j1', providerDocId: null, lastPolledAt: null, nextPollAt: expired }),
            calc('velho-com-id', { id: 'j2', providerDocId: 'doc', lastPolledAt: null, nextPollAt: expired }),
            calc('ja-alertado', { id: 'j3', providerDocId: null, lastPolledAt: null, nextPollAt: expired }),
        ];
        const { db, created } = fakeDb(rows, [{ id: 'a-old', context: { kind: 'CTE_SEM_CONFIRMACAO', calcId: 'ja-alertado' } }], ['ja-alertado', 'velho-sem-id', 'velho-com-id']);
        const r = await sweepPendingCteReconciliation({
            db, now: NOW, enqueue: async () => { throw new Error('nao deveria enfileirar'); },
            reconcile: async () => { throw new Error('nao deveria conferir'); },
        });
        assert.equal(r.alerted, 2);
        assert.equal(r.lookups + r.requeued, 0);
        assert.equal(created.length, 2);
        assert.equal(created[0].category, 'FISCAL_PROVIDER_ERROR');
        assert.equal(created[0].hubId, 'hub-pedido');
        assert.match(created[0].title, /sem solução há 48 h/);
        assert.ok(created[0].dueAt instanceof Date);
    });

    it('calculo sem nenhuma tentativa registrada abre excecao (nao ha o que consultar)', async () => {
        const { db, created } = fakeDb([calc('c2', null)], [], ['c2']);
        const r = await sweepPendingCteReconciliation({ db, now: NOW });
        assert.equal(r.alerted, 1);
        assert.match(created[0].message, /CT-e do pedido #42 sem confirmação do provedor: confira no painel do emissor antes de reemitir/);
    });

    it('resolve a excecao quando o calculo saiu da conciliacao', async () => {
        const { db, resolved } = fakeDb([], [{ id: 'a1', context: { kind: 'CTE_SEM_CONFIRMACAO', calcId: 'gone' } }], []);
        const r = await sweepPendingCteReconciliation({ db, now: NOW });
        assert.equal(r.resolved, 1);
        assert.deepEqual(resolved[0].where.id.in, ['a1']);
    });
});
