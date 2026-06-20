import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getIndIETomaAndIe } from './acbrCteMapper.js';
import type { CtePerson } from '../cteService.js';

describe('getIndIETomaAndIe', () => {
    it('retorna indIEToma = 9 para pessoa física (CPF)', () => {
        const cpfPerson: CtePerson = {
            legalName: 'João da Silva',
            document: '123.456.789-00',
            stateRegistration: '',
        };
        const result = getIndIETomaAndIe(cpfPerson);
        assert.equal(result.indIEToma, 9);
        assert.equal(result.ie, undefined);
    });

    it('retorna indIEToma = 1 para pessoa jurídica (CNPJ) com IE válida', () => {
        const cnpjPerson: CtePerson = {
            legalName: 'Empresa Contribuinte LTDA',
            document: '12.345.678/0001-90',
            stateRegistration: '12345678-9',
        };
        const result = getIndIETomaAndIe(cnpjPerson);
        assert.equal(result.indIEToma, 1);
        assert.equal(result.ie, '123456789');
    });

    it('retorna indIEToma = 2 para pessoa jurídica (CNPJ) marcada como ISENTO', () => {
        const cnpjPersonExempt: CtePerson = {
            legalName: 'Empresa Isenta LTDA',
            document: '12.345.678/0001-90',
            stateRegistration: 'ISENTO',
        };
        const result = getIndIETomaAndIe(cnpjPersonExempt);
        assert.equal(result.indIEToma, 2);
        assert.equal(result.ie, 'ISENTO');
    });

    it('retorna indIEToma = 9 para pessoa jurídica (CNPJ) sem IE (Não Contribuinte)', () => {
        const cnpjPersonNoIe: CtePerson = {
            legalName: 'Empresa Não Contribuinte LTDA',
            document: '12.345.678/0001-90',
            stateRegistration: '',
        };
        const result = getIndIETomaAndIe(cnpjPersonNoIe);
        assert.equal(result.indIEToma, 9);
        assert.equal(result.ie, undefined);
    });
});
