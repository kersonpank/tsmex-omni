import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ciotSuggestionDefaults } from './ciotSuggestionDefaults.js';
import { normalizeEfreteRntrc } from './efreteUtil.js';

it('sugere embalagem do domínio v8.2 e +1 dia sem coordenadas', () => {
    assert.deepEqual(ciotSuggestionDefaults({ plannedDepartureAt: new Date('2026-11-02T10:00:00Z'), plannedArrivalAt: null }), {
        distanceKm: null, endDate: '2026-11-03T10:00:00.000Z', embalagem: 'Caixa', tipoEmbalagem: 'Caixa',
    });
});
it('preserva chegada planejada e usa agora quando não há partida', () => {
    const arrival = new Date('2026-11-08T20:00:00Z');
    assert.equal(ciotSuggestionDefaults({ plannedDepartureAt: null, plannedArrivalAt: arrival }).endDate, arrival.toISOString());
    assert.equal(ciotSuggestionDefaults({ plannedDepartureAt: null, plannedArrivalAt: null }, new Date('2026-11-02T00:00:00Z')).endDate, '2026-11-03T00:00:00.000Z');
});
it('centraliza os 9 dígitos eFrete, preservando a massa ANTT', () => {
    assert.equal(normalizeEfreteRntrc('55887888'), '055887888');
    assert.equal(normalizeEfreteRntrc('055887888'), '055887888');
    assert.equal(normalizeEfreteRntrc('55.887.888'), '055887888');
});
