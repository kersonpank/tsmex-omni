import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNumberingStatus } from './numberingStatus.js';

const emitter = {
    id: 'e1', displayName: 'TSM SP', environment: 'PRODUCAO' as const, cteSeries: 1, lastCteNumber: 22000, mdfeSeries: 2, lastMdfeNumber: 0,
    person: { document: '11.222.333/0001-81', legalName: 'TSM' },
};
const now = new Date('2026-11-24T12:00:00Z');

test('mesma série do legado, legado à frente e ativo: três avisos; série exclusiva: nenhum', () => {
    const [row] = buildNumberingStatus([emitter], [
        { emitterCnpj: '11222333000181', model: 'CTE', series: 1, environment: 'PRODUCAO', lastNumber: 22393, lastIssuedAt: new Date('2026-11-20'), count: 22246 },
        { emitterCnpj: '11222333000181', model: 'MDFE', series: 1, environment: 'PRODUCAO', lastNumber: 531, lastIssuedAt: new Date('2026-10-30'), count: 473 },
        { emitterCnpj: '11222333000181', model: 'CTE', series: 1, environment: 'HOMOLOGACAO', lastNumber: 9, lastIssuedAt: null, count: 9 },
    ], now);
    assert.deepEqual(row.cte.warnings, ['SAME_SERIES_AS_LEGACY', 'LEGACY_AHEAD', 'LEGACY_ACTIVE_RECENTLY']);
    assert.equal(row.cte.legacyLastNumber, 22393);
    assert.deepEqual(row.mdfe.warnings, []);
    assert.equal(row.mdfe.legacyLastNumber, null);
    assert.equal(row.legacySeries.length, 2);
});
