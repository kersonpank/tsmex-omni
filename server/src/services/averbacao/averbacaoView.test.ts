import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sealSecret } from '../../lib/secretBox.js';
import { averbacaoRequiredFor, summarizeAverbacao } from './averbacaoView.js';

process.env.FISCAL_SECRET_KEY ||= 'test-secret-test-secret-test-secret';

describe('averbacaoView', () => {
    it('resume o registro com os seguros e sem o corpo bruto', () => {
        const at = new Date('2026-11-11T22:28:26Z');
        const view = summarizeAverbacao({
            status: 'AVERBADO', numeroAverbacao: 'N55', protocolo: 'TESTE', averbadoAt: at, lastError: null,
            dadosSeguro: [{ numeroAverbacao: 'N55', ramo: '55', nomeSeguradora: 'HOMOLOGACAO WS', numApolice: 'PROVISORIA', cnpjSeguradora: '000' }, { ramo: '54' }],
        });
        assert.deepEqual(view, {
            status: 'AVERBADO', numeroAverbacao: 'N55', protocolo: 'TESTE', averbadoAt: at.toISOString(), lastError: null,
            seguros: [{ ramo: '55', nomeSeguradora: 'HOMOLOGACAO WS', numApolice: 'PROVISORIA' }, { ramo: '54', nomeSeguradora: null, numApolice: null }],
        });
        assert.equal(summarizeAverbacao(null), null);
        assert.deepEqual(summarizeAverbacao({ status: 'PENDING', lastError: 'HTTP_522: x' })!.seguros, []);
    });
    it('averbacaoRequired só para CT-e de emitente com AT&M completa', () => {
        const atm = { averbacaoProvider: 'ATM', atmCode: 'C', atmUser: 'U', atmPasswordEncrypted: sealSecret('x') };
        assert.equal(averbacaoRequiredFor({ documentType: 'CTE', fiscalEmitter: atm }), true);
        assert.equal(averbacaoRequiredFor({ documentType: 'MINUTA', fiscalEmitter: atm }), false);
        assert.equal(averbacaoRequiredFor({ documentType: 'CTE', fiscalEmitter: { ...atm, averbacaoProvider: 'NONE' } }), false);
        assert.equal(averbacaoRequiredFor({ documentType: 'CTE', fiscalEmitter: null }), false);
    });
});
