import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveCteCfop } from './cteCfopRule.js';
import { resolveCteCfopCstForEmission } from './cteEmitterDefaults.js';

describe('CFOP conforme início, destino e emitente', () => {
    for (const [startUf, endUf, emitterUf, baseCfop, expected] of [
        ['SC', 'SC', 'SP', '6353', '5932'],
        ['SC', 'MA', 'SP', '6353', '6932'],
        ['SP', 'SP', 'SP', '6353', '5353'],
        ['SP', 'MA', 'SP', '6353', '6353'],
        ['SP', 'MA', 'SP', '5352', '6352'],
        ['SP', 'SP', 'SP', '6352', '5352'],
        ['SP', 'MA', 'SP', '6932', '6353'],
        ['SP', 'SP', 'SP', '', '5353'],
        [' sp ', ' ma ', ' sp ', 'inválido', '6353'],
    ]) it(`${startUf} → ${endUf}, emitente ${emitterUf}, base ${baseCfop} = ${expected}`, () => {
        const result = deriveCteCfop({ startUf, endUf, emitterUf, baseCfop });
        assert.equal(result.cfop, expected);
        assert.match(result.reason, /início em .*destino .* → /);
    });
    for (const [cfop, originCity, destCity, expected] of [
        [null, 'Guarulhos, SP', 'São Luís, MA', '6353'],
        ['6932', 'Guarulhos, SP', 'São Luís, MA', '6353'],
        ['6353', 'Guaramirim, SC', 'São Luís, MA', '6932'],
        ['6932', 'Guaramirim, SC', 'Joinville, SC', '5932'],
        ['5352', 'Guarulhos, SP', 'São Luís, MA', '6353'],
        ['6352', 'Guarulhos, SP', 'São Luís, MA', '6352'],
    ]) it(`corrige ${cfop} de ${originCity} para ${destCity}`, () => {
        assert.deepEqual(resolveCteCfopCstForEmission({ cfop, originCity, destCity, cst: '20' }, { defaultCteCfop: '6353', person: { state: 'SP' } }), { cfop: expected, cst: '20' });
    });
    it('não muda o CFOP registrado em CT-e autorizado', () => {
        assert.equal(resolveCteCfopCstForEmission({ cfop: '6932', originCity: 'Guarulhos, SP', destCity: 'São Luís, MA', status: 'CTE_AUTHORIZED' }, { person: { state: 'SP' } }).cfop, '6932');
    });
});
