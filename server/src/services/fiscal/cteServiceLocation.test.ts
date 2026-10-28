import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCteServiceLocation } from './cteServiceLocation.js';

const remetente = { legalName: 'Remetente', document: '12345678000190', city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308' };

describe('localidade fiscal do CT-e', () => {
    it('usa a cidade e o IBGE do pedido de entrada direta, sem confundir com o remetente', () => {
        assert.deepEqual(resolveCteServiceLocation({
            calculationCity: 'Fortaleza, CE',
            orderCity: 'Fortaleza, CE',
            orderIbgeCode: '2304400',
            person: remetente,
        }), { city: 'Fortaleza', state: 'CE', ibgeCode: '2304400' });
    });

    it('não reaproveita o IBGE de outra cidade quando o cálculo é corrigido', () => {
        assert.deepEqual(resolveCteServiceLocation({
            calculationCity: 'São Luís, MA',
            orderCity: 'São Paulo, SP',
            orderIbgeCode: '3550308',
            person: remetente,
        }), { city: 'São Luís', state: 'MA', ibgeCode: null });
    });

    it('recupera UF de um nome curto somente quando corresponde à cidade conhecida', () => {
        assert.deepEqual(resolveCteServiceLocation({
            calculationCity: 'Fortaleza', orderCity: 'Fortaleza, CE', orderIbgeCode: '2304400', person: remetente,
        }), { city: 'Fortaleza', state: 'CE', ibgeCode: '2304400' });
        assert.equal(resolveCteServiceLocation({ calculationCity: 'Fortaleza', person: remetente }), null);
    });

    it('não inventa origem pelo remetente quando o hub direto não tem localização', () => {
        assert.equal(resolveCteServiceLocation({ person: remetente, allowPersonFallback: false }), null);
    });
});
