import type { CoverageRow } from './redeCadastro';

export type TeiaCity = { ibgeCode: string; name: string; state: string };

export const MAX_COVERAGE = 500;

export function applyTeiaSelection(
    rows: CoverageRow[],
    cities: TeiaCity[],
    seatIbge: string | null,
): { rows: CoverageRow[]; added: number; alreadyPresent: number; skippedSeat: number; truncated: number } {
    const present = new Set(rows.map((r) => r.cityIbgeCode));
    const seen = new Set<string>();
    const next = [...rows];
    let added = 0;
    let alreadyPresent = 0;
    let skippedSeat = 0;
    let truncated = 0;

    for (const { ibgeCode, name, state } of cities) {
        if (seen.has(ibgeCode)) continue;
        seen.add(ibgeCode);
        if (seatIbge && ibgeCode === seatIbge) { skippedSeat++; continue; }
        if (present.has(ibgeCode)) { alreadyPresent++; continue; }
        if (next.length >= MAX_COVERAGE) { truncated++; continue; }
        next.push({ cityIbgeCode: ibgeCode, cityName: name, state, leadTimeDays: null, priority: 100, active: true, pricingTableId: null });
        added++;
    }

    return { rows: next, added, alreadyPresent, skippedSeat, truncated };
}

export function setServed(rows: CoverageRow[], ibgeCode: string, served: boolean): CoverageRow[] {
    if (!rows.some((r) => r.cityIbgeCode === ibgeCode)) return rows;
    return rows.map((r) => (r.cityIbgeCode === ibgeCode ? { ...r, active: served } : r));
}

export function coverageCounts(rows: CoverageRow[]): { served: number; notServed: number } {
    let served = 0;
    for (const r of rows) if (r.active) served++;
    return { served, notServed: rows.length - served };
}
