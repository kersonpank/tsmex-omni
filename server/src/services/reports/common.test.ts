import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../middleware/errorHandler.js';
import { DAY_MS, mapWithConcurrency, percentOf, percentile, resolveReportPeriod, toCents } from './common.js';

const NOW = new Date('2026-11-23T12:00:00.000Z');

function statusOf(fn: () => unknown): { status: number; message: string } {
    try {
        fn();
    } catch (e) {
        assert.ok(e instanceof AppError);
        return { status: e.statusCode, message: e.message };
    }
    assert.fail('esperava AppError');
}

describe('resolveReportPeriod', () => {
    it('padrão: últimos 30 dias até agora', () => {
        const p = resolveReportPeriod({}, NOW);
        assert.equal(p.to.toISOString(), NOW.toISOString());
        assert.equal(p.to.getTime() - p.from.getTime(), 30 * DAY_MS);
    });

    it('aceita from/to ISO e trata data sem hora em "to" como fim do dia UTC', () => {
        const p = resolveReportPeriod({ from: '2026-11-01', to: '2026-11-10' }, NOW);
        assert.equal(p.from.toISOString(), '2026-11-01T00:00:00.000Z');
        assert.equal(p.to.toISOString(), '2026-11-10T23:59:59.999Z');
    });

    it('rejeita data inválida com 400 e mensagem clara', () => {
        const r = statusOf(() => resolveReportPeriod({ from: 'ontem' }, NOW));
        assert.equal(r.status, 400);
        assert.match(r.message, /from/);
    });

    it('rejeita from posterior a to', () => {
        const r = statusOf(() => resolveReportPeriod({ from: '2026-11-10', to: '2026-11-01' }, NOW));
        assert.equal(r.status, 400);
        assert.match(r.message, /posterior/);
    });

    it('rejeita período maior que 366 dias e aceita exatamente 366', () => {
        const r = statusOf(() => resolveReportPeriod({ from: '2025-01-01', to: '2026-11-01' }, NOW));
        assert.equal(r.status, 400);
        assert.match(r.message, /366/);
        assert.doesNotThrow(() => resolveReportPeriod({ from: '2025-11-23T12:00:00Z', to: '2026-11-24T12:00:00Z' }, NOW));
    });
});

describe('helpers numéricos', () => {
    it('toCents converte Decimal textual sem ruído de ponto flutuante', () => {
        assert.equal(toCents('1234.56'), 123456);
        assert.equal(toCents('0.10'), 10);
        assert.equal(toCents('19.99'), 1999);
        assert.equal(toCents('0.295'), 30);
        assert.equal(toCents('-5.5'), -550);
        assert.equal(toCents(12), 1200);
        assert.equal(toCents(null), 0);
        assert.equal(toCents({ toString: () => '8.2' }), 820);
    });

    it('percentOf e percentile', () => {
        assert.equal(percentOf(1, 3), 33.33);
        assert.equal(percentOf(1, 0), null);
        assert.equal(percentile([], 50), null);
        assert.equal(percentile([1, 2, 3, 4], 50), 2);
        assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
    });

    it('mapWithConcurrency preserva a ordem', async () => {
        const out = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
            await new Promise((r) => setTimeout(r, n));
            return n * 2;
        });
        assert.deepEqual(out, [6, 2, 4]);
    });
});
