import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateAutonomy, hasSuggestion, loadAutonomyReport, routineOf, type FeedbackInput } from './autonomyReport.js';

const period = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-30T23:59:59Z') };

const suggestion = [{ source: 'next_hop_queue', queueKey: 'q1', orderIds: ['o1'] }];

const fb = (over: Partial<FeedbackInput> = {}): FeedbackInput => ({
    action: 'ACCEPTED', suggestedManifests: suggestion,
    utilizationBefore: 0, utilizationAfter: 0.8, marginBefore: 0.1, marginAfter: 0.3, ...over,
});

describe('hasSuggestion / routineOf', () => {
    it('só há sugestão com JSON não nulo e com conteúdo', () => {
        assert.equal(hasSuggestion(null), false);
        assert.equal(hasSuggestion(undefined), false);
        assert.equal(hasSuggestion([]), false);
        assert.equal(hasSuggestion(suggestion), true);
        assert.equal(hasSuggestion({ source: 'x' }), true);
        assert.equal(hasSuggestion('texto'), false);
    });

    it('identifica a rotina pelo campo source', () => {
        assert.equal(routineOf(suggestion), 'next_hop_queue');
        assert.equal(routineOf([{ foo: 1 }]), 'DESCONHECIDA');
    });
});

describe('aggregateAutonomy', () => {
    it('não conta ACCEPTED sem sugestão (addOrderToManifest) e calcula % por rotina', () => {
        const rows: FeedbackInput[] = [
            fb(),
            fb(),
            fb({ action: 'MODIFIED', utilizationAfter: 0.6, marginAfter: 0.2 }),
            fb({ action: 'REJECTED', marginBefore: null }),
            // ações manuais: ACCEPTED sem sugestão e MODIFIED da remoção
            fb({ suggestedManifests: null }),
            fb({ action: 'MODIFIED', suggestedManifests: null }),
            fb({ suggestedManifests: [] }),
        ];
        const r = aggregateAutonomy(rows, period, { fetched: 7, matching: 7, limit: 20000 });

        assert.equal(r.targetPercent, 90);
        assert.deepEqual(r.overall, { suggestions: 4, accepted: 2, modified: 1, rejected: 1, acceptedPercent: 50, meetsTarget: false });
        assert.equal(r.byRoutine.length, 1);
        const q = r.byRoutine[0];
        assert.equal(q.routine, 'next_hop_queue');
        assert.deepEqual([q.suggestions, q.accepted, q.modified, q.rejected, q.acceptedPercent], [4, 2, 1, 1, 50]);
        // utilização: (0+0+0+0) antes; depois (0.8+0.8+0.6+0.8)/4 = 0.75
        assert.deepEqual(q.utilization, { samples: 4, beforePercent: 0, afterPercent: 75 });
        // margem: só pares completos (3 de 4): antes 0.1, depois (0.3+0.3+0.2)/3
        assert.deepEqual(q.margin, { samples: 3, beforePercent: 10, afterPercent: 26.67 });
        assert.deepEqual(r.excluded.map((e) => e.count), [3]);
        assert.match(r.excluded[0].reason, /sem sugestão/);
    });

    it('sem sugestões, % é null e meta indefinida', () => {
        const r = aggregateAutonomy([fb({ suggestedManifests: null })], period, { fetched: 1, matching: 1, limit: 20000 });
        assert.equal(r.overall.acceptedPercent, null);
        assert.equal(r.overall.meetsTarget, null);
        assert.deepEqual(r.byRoutine, []);
    });

    it('atinge a meta com 90% ou mais', () => {
        const rows = [...Array(9)].map(() => fb()).concat([fb({ action: 'MODIFIED' })]);
        const r = aggregateAutonomy(rows, period, { fetched: 10, matching: 10, limit: 20000 });
        assert.equal(r.overall.acceptedPercent, 90);
        assert.equal(r.overall.meetsTarget, true);
    });
});

describe('loadAutonomyReport', () => {
    it('lê o feedback do período', async () => {
        let where: any = null;
        const db = {
            consolidationFeedback: {
                count: async () => 1,
                findMany: async (args: any) => {
                    where = args.where;
                    return [fb()];
                },
            },
        } as any;
        const r = await loadAutonomyReport(period, db);
        assert.deepEqual(where.createdAt, { gte: period.from, lte: period.to });
        assert.equal(r.overall.acceptedPercent, 100);
    });
});
