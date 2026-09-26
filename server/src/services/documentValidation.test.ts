import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidCpf, isValidCnpj } from './documentValidation.js';

describe('identidade fiscal de pessoas', () => {
    it('aceita dígitos verificadores de CPF e CNPJ com ou sem máscara', () => {
        assert.equal(isValidCpf('529.982.247-25'), true);
        assert.equal(isValidCnpj('11.222.333/0001-81'), true);
    });
    it('recusa tamanho incorreto, dígitos repetidos e dígito verificador inválido', () => {
        for (const value of ['5299822472', '00000000000', '52998224726']) assert.equal(isValidCpf(value), false);
        for (const value of ['1122233300018', '11111111111111', '11222333000182']) assert.equal(isValidCnpj(value), false);
    });
});
