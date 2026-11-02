import assert from 'node:assert/strict';
import { it } from 'node:test';
import { cteEmitterMismatchMessage, missingMdfeEmitterData } from './mdfePreflight.js';

it('chave CT-e compara exatamente as posições 7–20 com o emitente', () => {
    const key = '35261026879820000270570010000001121000000000';
    assert.equal(key.length, 44);
    assert.equal(cteEmitterMismatchMessage(112, key, '26.879.820/0002-70'), null);
    assert.equal(cteEmitterMismatchMessage(112, key, '48384601000171'), 'O CT-e do pedido 112 foi emitido por outro CNPJ (26879820000270). O MDF-e precisa do mesmo emitente.');
    assert.equal(cteEmitterMismatchMessage(112, null, '48384601000171'), null);
});
it('emissor válido aceita IE formatada ou ISENTO e exige IBGE/CEP válidos', () => {
    const person = { stateRegistration: '110.042.490.114', address: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Guarulhos', cityIbgeCode: '3518800', state: 'SP', cep: '07000-000' };
    assert.deepEqual(missingMdfeEmitterData(person), []);
    assert.deepEqual(missingMdfeEmitterData({ ...person, stateRegistration: 'ISENTO' }), []);
    assert.deepEqual(missingMdfeEmitterData({ ...person, stateRegistration: 'x', cityIbgeCode: '1', cep: '123' }), ['IE', 'código IBGE', 'CEP']);
});
