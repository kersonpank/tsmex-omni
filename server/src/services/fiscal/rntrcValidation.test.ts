import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateRntrcFormat } from './rntrcValidation.js';

describe('validateRntrcFormat', () => {
    it('aceita RNTRC com exatamente 8 dígitos numéricos', () => {
        assert.equal(validateRntrcFormat('12345678'), true);
    });

    it('rejeita RNTRC com menos de 8 dígitos', () => {
        assert.equal(validateRntrcFormat('1234567'), false);
    });

    it('rejeita RNTRC com mais de 8 dígitos', () => {
        assert.equal(validateRntrcFormat('123456789'), false);
    });

    it('rejeita RNTRC com caracteres não numéricos', () => {
        assert.equal(validateRntrcFormat('1234-678'), false);
    });

    it('rejeita RNTRC vazio, nulo ou undefined', () => {
        assert.equal(validateRntrcFormat(''), false);
        assert.equal(validateRntrcFormat(null), false);
        assert.equal(validateRntrcFormat(undefined), false);
    });

    it('rejeita RNTRC com espaços em volta mesmo se o miolo tiver 8 dígitos', () => {
        assert.equal(validateRntrcFormat(' 12345678 '), true, 'trim é aceitável, mas o valor interno deve ter 8 dígitos');
    });
});
