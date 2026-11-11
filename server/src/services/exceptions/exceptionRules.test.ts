import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type prisma from '../../lib/prisma.js';
import { runExceptionRules, SYSTEM_RESOLUTION_NOTE, type ExceptionThresholds } from './exceptionRules.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const T: ExceptionThresholds = { stockAgingDays: 5, tripLateHours: 12, unroutedHours: 24 };
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

type Row = Record<string, any>;

function fakeDb(data: { orders?: Row[]; manifests?: Row[]; alerts?: Row[] }) {
    const alerts = [...(data.alerts ?? [])];
    const created: Row[] = [];
    const resolved: Row[] = [];
    const db = {
        hub: { findMany: async () => [
            { id: 'hub-a', name: 'Hub A', code: 'A', cityIbgeCode: '1111111', active: true, gatewayHubId: null },
        ] },
        hubCoverage: { findMany: async () => [] },
        order: {
            findMany: async (args: any) => {
                const lt: Date = args.where.enteredAtHubAt.lt;
                return (data.orders ?? []).filter((o) => o.enteredAtHubAt < lt);
            },
        },
        manifest: { findMany: async () => data.manifests ?? [] },
        systemAlert: {
            findMany: async () => alerts.filter((a) => a.status !== 'RESOLVED'),
            create: async (args: any) => { created.push(args.data); alerts.push({ id: `n${created.length}`, status: 'OPEN', ...args.data }); return args.data; },
            updateMany: async (args: any) => { resolved.push({ ids: args.where.id.in, ...args.data }); return { count: args.where.id.in.length }; },
        },
    };
    return { db: db as unknown as typeof prisma, created, resolved };
}

const order = (id: string, hoursInStock: number, fimIbgeCode: string | null): Row => ({
    id, currentHubId: 'hub-a', enteredAtHubAt: hoursAgo(hoursInStock), fimIbgeCode, demand: { orderNumber: 77 },
});

describe('runExceptionRules', () => {
    it('gera estoque parado > 5 dias e sem rota > 24 h, com dono e prazo', async () => {
        const { db, created } = fakeDb({
            orders: [order('o-old', 24 * 6, '1111111'), order('o-fresh', 24 * 2, '1111111'), order('o-unrouted', 30, null)],
        });
        const r = await runExceptionRules({ db, now: NOW, thresholds: T });
        assert.equal(r.created, 2);
        const aging = created.find((c) => c.category === 'OPERATIONAL_STOCK_AGING')!;
        assert.equal(aging.context.orderId, 'o-old');
        assert.equal(aging.hubId, 'hub-a');
        assert.equal(aging.dueAt.getTime(), NOW.getTime() + 24 * 3_600_000);
        const unrouted = created.find((c) => c.category === 'OPERATIONAL_UNROUTED')!;
        assert.equal(unrouted.context.orderId, 'o-unrouted');
    });

    it('viagem atrasada: dono é o hub de destino, senão o de origem', async () => {
        const base = { origin: 'A', destination: 'B', plannedArrivalAt: hoursAgo(13) };
        const { db, created } = fakeDb({ manifests: [
            { id: 'm1-aaaaaaaa', hubId: 'hub-o', destHubId: 'hub-d', ...base },
            { id: 'm2-bbbbbbbb', hubId: 'hub-o', destHubId: null, ...base },
        ] });
        await runExceptionRules({ db, now: NOW, thresholds: T });
        assert.deepEqual(created.map((c) => c.hubId), ['hub-d', 'hub-o']);
        assert.ok(created.every((c) => c.category === 'OPERATIONAL_TRIP_LATE' && c.severity === 'CRITICAL'));
    });

    it('é idempotente: alerta aberto do mesmo objeto não duplica', async () => {
        const { db, created } = fakeDb({
            orders: [order('o-old', 24 * 6, '1111111')],
            alerts: [{ id: 'x', category: 'OPERATIONAL_STOCK_AGING', status: 'ACKNOWLEDGED', context: { subjectKey: 'o-old' } }],
        });
        const r = await runExceptionRules({ db, now: NOW, thresholds: T });
        assert.equal(r.created, 0);
        assert.equal(created.length, 0);
        assert.equal(r.resolved, 0);
    });

    it('resolve sozinho quando a condição some, com nota do sistema', async () => {
        const { db, resolved } = fakeDb({
            alerts: [{ id: 'gone', category: 'OPERATIONAL_TRIP_LATE', status: 'OPEN', context: { subjectKey: 'm9' } }],
        });
        const r = await runExceptionRules({ db, now: NOW, thresholds: T });
        assert.equal(r.resolved, 1);
        assert.deepEqual(resolved[0].ids, ['gone']);
        assert.equal(resolved[0].resolvedByUserId, null);
        assert.equal(resolved[0].resolutionNote, SYSTEM_RESOLUTION_NOTE);
    });
});
