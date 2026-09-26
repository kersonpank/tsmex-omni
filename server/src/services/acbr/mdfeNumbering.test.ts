import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AcbrHttpError } from './acbrHttp.js';
import { calculateMdfeCheckDigit, generateCMdf, isDefinitiveMdfeRejection } from './mdfeNumbering.js';

describe('mdfeNumbering', () => {
    it('calcula o dígito da chave do MDF-e pelo módulo 11 sobre 43 posições', () => {
        assert.equal(calculateMdfeCheckDigit({ cUF: 35, cnpj: '11222333000181', series: 1, number: 1, cMDF: '12345678', issuedAt: new Date('2026-09-26T12:00:00Z') }), 1);
    });
    it('cMDF tem 8 dígitos numéricos', () => {
        for (let i = 0; i < 200; i++) assert.match(generateCMdf(), /^[1-9]\d{7}$/);
    });

    it('4xx explícito é rejeição definitiva; 408/429/5xx/timeout/rede não são', () => {
        assert.equal(isDefinitiveMdfeRejection(new AcbrHttpError('x', 400)), true);
        assert.equal(isDefinitiveMdfeRejection(new AcbrHttpError('x', 422)), true);
        assert.equal(isDefinitiveMdfeRejection(new AcbrHttpError('x', 402)), true);
        assert.equal(isDefinitiveMdfeRejection(new AcbrHttpError('x', 408)), false);
        assert.equal(isDefinitiveMdfeRejection(new AcbrHttpError('x', 429)), false);
        assert.equal(isDefinitiveMdfeRejection(new AcbrHttpError('x', 503)), false);
        assert.equal(isDefinitiveMdfeRejection(new DOMException('Timeout', 'TimeoutError')), false);
        assert.equal(isDefinitiveMdfeRejection(new Error('fetch failed')), false);
    });
});
