import assert from 'node:assert/strict';
import { it } from 'node:test';
import { computeAnttFloor } from './anttFloor.js';

const input = { tipoCarga: 5, eixos: 7, distanceKm: 2950, altoDesempenho: false };
it('calcula o caso real de carga geral com sete eixos', () => {
    const floor = computeAnttFloor(input);
    assert.equal(floor.value, 25236.13);
    assert.equal('ccd' in floor && floor.ccd, 8.2727);
    assert.equal('cc' in floor && floor.cc, 831.66);
    assert.equal(floor.version, 'SUROC-22-2026');
    assert.equal(floor.table, 'A');
});
it('usa a próxima coluna superior, nunca a inferior', () => {
    const floor = computeAnttFloor({ ...input, eixos: 8 });
    assert.equal('eixosUsed' in floor && floor.eixosUsed, 9);
    assert.equal(floor.eixos, 8);
});
it('informa ausência de coluna superior, inclusive por tipo de carga', () => {
    assert.equal(computeAnttFloor({ ...input, eixos: 10 }).value, null);
    assert.equal(computeAnttFloor({ ...input, tipoCarga: 12, eixos: 5 }).value, null);
});
it('usa tabela C em alto desempenho', () => {
    const floor = computeAnttFloor({ ...input, altoDesempenho: true });
    assert.equal(floor.table, 'C');
    assert.equal(floor.value, 20633.11);
});
it('recusa distância, carga e eixos inválidos', () => {
    for (const distanceKm of [0, -1, NaN, Infinity, null]) assert.equal(computeAnttFloor({ ...input, distanceKm }).value, null);
    for (const eixos of [0, -1, 2.5, null]) assert.equal(computeAnttFloor({ ...input, eixos }).value, null);
    assert.equal(computeAnttFloor({ ...input, tipoCarga: 13 }).value, null);
});
