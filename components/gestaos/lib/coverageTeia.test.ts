import { describe, expect, it } from 'vitest';
import { applyTeiaSelection, coverageCounts, MAX_COVERAGE, setServed } from './coverageTeia';
import type { CoverageRow } from './redeCadastro';

const row = (code: string, over: Partial<CoverageRow> = {}): CoverageRow => ({
    cityIbgeCode: code, cityName: `C${code}`, state: 'MA', leadTimeDays: 2, priority: 5, active: true, ...over,
});
const city = (code: string) => ({ ibgeCode: code, name: `N${code}`, state: 'PA' });

describe('coverageTeia', () => {
    it('adiciona novas como Atende, no fim e na ordem da entrada', () => {
        const base = [row('1')];
        const r = applyTeiaSelection(base, [city('3'), city('2')], null);
        expect(r.added).toBe(2);
        expect(r.rows.map((x) => x.cityIbgeCode)).toEqual(['1', '3', '2']);
        expect(r.rows[1]).toEqual({ cityIbgeCode: '3', cityName: 'N3', state: 'PA', leadTimeDays: null, priority: 100, active: true });
        expect(base).toHaveLength(1);
    });

    it('ignora a sede e conta em skippedSeat', () => {
        const r = applyTeiaSelection([], [city('9'), city('8')], '9');
        expect(r.skippedSeat).toBe(1);
        expect(r.rows.map((x) => x.cityIbgeCode)).toEqual(['8']);
    });

    it('mantém linha existente intacta e conta alreadyPresent', () => {
        const existing = row('2', { active: false, priority: 7 });
        const r = applyTeiaSelection([existing], [city('2')], null);
        expect(r.alreadyPresent).toBe(1);
        expect(r.added).toBe(0);
        expect(r.rows[0]).toEqual(existing);
    });

    it('deduplica a entrada', () => {
        const r = applyTeiaSelection([], [city('4'), city('4')], null);
        expect(r.added).toBe(1);
        expect(r.rows).toHaveLength(1);
    });

    it('respeita o limite de 500 e conta truncated', () => {
        const base = Array.from({ length: 498 }, (_, i) => row(String(1000 + i)));
        const r = applyTeiaSelection(base, [city('1'), city('2'), city('3')], null);
        expect(r.rows).toHaveLength(MAX_COVERAGE);
        expect(r.added).toBe(2);
        expect(r.truncated).toBe(1);
    });

    it('setServed altera só a linha alvo', () => {
        const rows = [row('1'), row('2')];
        const out = setServed(rows, '2', false);
        expect(out[0]).toBe(rows[0]);
        expect(out[1].active).toBe(false);
        expect(rows[1].active).toBe(true);
        expect(setServed(rows, '99', false)).toBe(rows);
    });

    it('coverageCounts separa atende e não atende', () => {
        expect(coverageCounts([row('1'), row('2', { active: false }), row('3', { active: false })])).toEqual({ served: 1, notServed: 2 });
        expect(coverageCounts([])).toEqual({ served: 0, notServed: 0 });
    });
});
