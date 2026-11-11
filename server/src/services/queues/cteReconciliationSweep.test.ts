import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type prisma from '../../lib/prisma.js';
import { sweepPendingCteReconciliation } from './cteReconciliationSweep.js';

const NOW = new Date('2026-11-11T12:00:00Z');
type Row = Record<string, any>;

function calc(id: string, job: Row | null, extra: Row = {}): Row {
    return {
        id, orderId: `order-${id}-xxxxxxxx`, emissorId: 'hub-emissor',
        cteEmissionJobs: job ? [job] : [],
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
    const db = {
        orderFreightCalculation: {
            findMany: async (args: Row) => (args.where.id ? stillPending.map((id) => ({ id })) : calcs),
            updateMany: async (args: Row) => { calcUpdates.push(args); return { count: 1 }; },
        },
        cteEmissionJob: {
            updateMany: async (args: Row) => {
                if (claimed.has(args.where.id)) return { count: 0 };
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
    return { db: db as unknown as typeof prisma, jobUpdates, calcUpdates, created, resolved };
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

    it('sem providerDocId nunca enfileira: abre excecao para o hub do pedido, sem duplicar', async () => {
        const { db, created } = fakeDb([calc('c1', { id: 'j1', providerDocId: null, lastPolledAt: null }), calc('c2', null)],
            [{ id: 'a-old', context: { kind: 'CTE_SEM_CONFIRMACAO', calcId: 'c2' } }], ['c2']);
        const r = await sweepPendingCteReconciliation({ db, now: NOW, enqueue: async () => { throw new Error('nao deveria enfileirar'); } });
        assert.equal(r.alerted, 1);
        assert.equal(created.length, 1);
        assert.equal(created[0].category, 'FISCAL_PROVIDER_ERROR');
        assert.equal(created[0].hubId, 'hub-pedido');
        assert.match(created[0].message, /CT-e do pedido #42 sem confirmação do provedor: confira no painel do emissor antes de reemitir/);
    });

    it('resolve a excecao quando o calculo saiu da conciliacao', async () => {
        const { db, resolved } = fakeDb([], [{ id: 'a1', context: { kind: 'CTE_SEM_CONFIRMACAO', calcId: 'gone' } }], []);
        const r = await sweepPendingCteReconciliation({ db, now: NOW });
        assert.equal(r.resolved, 1);
        assert.deepEqual(resolved[0].where.id.in, ['a1']);
    });
});
