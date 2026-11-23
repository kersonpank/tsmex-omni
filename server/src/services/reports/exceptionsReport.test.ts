import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateExceptions, loadExceptionsReport, type AlertInput } from './exceptionsReport.js';

const period = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-30T23:59:59Z') };
const d = (s: string) => new Date(s);

const alert = (over: Partial<AlertInput> = {}): AlertInput => ({
    category: 'OPERATIONAL_TRIP_LATE', hubId: 'h1', createdAt: d('2026-11-05T00:00:00Z'), dueAt: null,
    resolvedAt: null, resolvedByUserId: null, resolutionNote: null, ...over,
});

describe('aggregateExceptions', () => {
    it('conta abertas e resolvidas no período por categoria e hub, sem teto fixo', () => {
        const alerts: AlertInput[] = [
            // aberta no período, ainda aberta
            alert(),
            // aberta e resolvida por pessoa em 10h, dentro do prazo
            alert({ createdAt: d('2026-11-06T00:00:00Z'), dueAt: d('2026-11-07T00:00:00Z'), resolvedAt: d('2026-11-06T10:00:00Z'), resolvedByUserId: 'u1' }),
            // aberta antes do período, resolvida pelo sistema no período em 54h, fora do prazo
            alert({
                category: 'OPERATIONAL_UNROUTED', hubId: null, createdAt: d('2026-10-30T00:00:00Z'), dueAt: d('2026-11-01T00:00:00Z'),
                resolvedAt: d('2026-11-01T06:00:00Z'), resolutionNote: 'Resolvida automaticamente pelo sistema.',
            }),
            // resolvida sem responsável nem nota, sem prazo
            alert({ createdAt: d('2026-11-08T00:00:00Z'), resolvedAt: d('2026-11-08T02:00:00Z') }),
        ];
        const r = aggregateExceptions(alerts, new Map([['h1', 'Hub Um']]), { total: 7, overdue: 2 }, period, { fetched: 4, limit: 20000, matching: 4 });

        assert.equal(r.opened, 3);
        assert.equal(r.resolved, 3);
        assert.deepEqual(r.resolvedBy, { system: 1, person: 1, unattributed: 1 });
        assert.deepEqual(r.timeToResolve, { measured: 3, avgHours: 22, medianHours: 10, p90Hours: 54 });
        assert.deepEqual(r.withinDue, { measured: 2, within: 1, percent: 50 });
        assert.deepEqual(r.backlogNow, { total: 7, overdue: 2 });
        assert.deepEqual(r.byCategory.map((c) => [c.category, c.opened, c.resolved, c.avgHoursToResolve]), [
            ['OPERATIONAL_TRIP_LATE', 3, 2, 6],
            ['OPERATIONAL_UNROUTED', 0, 1, 54],
        ]);
        assert.deepEqual(r.byHub.map((h) => [h.hubId, h.hubName, h.opened, h.resolved]), [
            ['h1', 'Hub Um', 3, 2],
            ['SEM_HUB', null, 0, 1],
        ]);
        assert.deepEqual(r.excluded.map((e) => e.count), [1, 1]);
        assert.equal(r.coverage.truncated, false);
    });
});

describe('loadExceptionsReport', () => {
    it('consulta sem take de 50 e devolve o backlog atual', async () => {
        let findManyArgs: any = null;
        const db = {
            systemAlert: {
                count: async (args: any) => (args.where.OR ? 1 : args.where.dueAt ? 1 : 3),
                findMany: async (args: any) => {
                    findManyArgs = args;
                    return [{ category: 'GENERIC', hubId: 'h1', createdAt: d('2026-11-05T00:00:00Z'), dueAt: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null }];
                },
            },
            hub: { findMany: async () => [{ id: 'h1', name: 'Hub Um' }] },
        } as any;
        const r = await loadExceptionsReport(period, db, new Date('2026-11-23T00:00:00Z'));
        assert.ok(findManyArgs.take > 50);
        assert.equal(r.opened, 1);
        assert.deepEqual(r.backlogNow, { total: 3, overdue: 1 });
        assert.equal(r.byHub[0].hubName, 'Hub Um');
    });
});
