import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CteEmissionInput } from '../cteService.js';
import { buildCtePreflightResult } from './ctePreflight.js';

const completeInput: CteEmissionInput = {
    calc: {
        id: 'calc-1',
        originCity: 'Imperatriz',
        destCity: 'São Luís',
        cfop: '6352',
        cst: '00',
        tipoFrete: 'Normal',
        volumes: 3,
        weight: 120,
        effectiveWeight: 120,
        cubage: 0.4,
        nfValue: 1500,
        commodity: 'Medicamentos',
        freightTotal: 320,
        breakdown: { freightBase: 280, icms: 40 },
        icmsValue: 40,
    },
    order: {
        freightTerm: 'CIF',
        remetentePerson: {
            legalName: 'Remetente SA',
            document: '12345678000190',
            stateRegistration: '123456789',
            address: 'Rua A',
            number: '100',
            neighborhood: 'Centro',
            city: 'Imperatriz',
            state: 'MA',
            cep: '65900000',
        },
        destinatarioPerson: {
            legalName: 'Destinatario SA',
            document: '98765432000110',
            stateRegistration: '987654321',
            address: 'Rua B',
            number: '200',
            neighborhood: 'Centro',
            city: 'São Luís',
            state: 'MA',
            cep: '65000000',
        },
        consignatarioPerson: null,
        expedidorPerson: null,
        invoicesRel: [{
            type: 'NFE',
            nfNumber: '123',
            nfKey: '1'.repeat(44),
            volumes: 3,
            weight: 120,
            value: 1500,
        }],
    },
    hub: {
        id: 'hub-1',
        name: 'HUB Imperatriz',
        code: 'IMP-MA',
        phone: '999999999',
        rntrc: '12345678',
    },
    person: {
        legalName: 'TSM EX LTDA',
        document: '11222333000144',
        stateRegistration: '123456789',
        address: 'Av Central',
        number: '10',
        neighborhood: 'Centro',
        city: 'Imperatriz',
        state: 'MA',
        cep: '65900000',
    },
    numero: 0,
    serie: 1,
    ambiente: 'HOMOLOGACAO',
};

describe('buildCtePreflightResult', () => {
    it('aprova CT-e pronto sem alterar estado fiscal', () => {
        const result = buildCtePreflightResult(completeInput, {
            provider: 'ACBR',
        });

        assert.equal(result.ok, true);
        assert.equal(result.canEmit, true);
        assert.equal(result.environment, 'HOMOLOGACAO');
        assert.equal(result.provider, 'ACBR');
        assert.deepEqual(result.issues, []);
        assert.deepEqual(result.missingFields, []);
        assert.equal(result.tax.cfop?.code, '6352');
        assert.equal(result.tax.cst?.code, '00');
    });

    it('lista pendências de preenchimento e CST inválido antes do envio', () => {
        const result = buildCtePreflightResult({
            ...completeInput,
            calc: { ...completeInput.calc, cfop: null, cst: '99' },
        });

        assert.equal(result.ok, false);
        assert.equal(result.canEmit, false);
        assert.ok(result.issues.includes('CT-e precisa de CFOP.'));
        assert.ok(result.issues.includes('CST 99 não está habilitado para CT-e no MVP.'));
        assert.ok(result.missingFields.includes('cfop'));
        assert.equal(result.tax.cst, null);
    });

    it('aceita pendências externas quando ainda não há input completo', () => {
        const result = buildCtePreflightResult(null, {
            environment: 'HOMOLOGACAO',
            provider: 'ACBR',
            additionalIssues: ['É obrigatório vincular um emitente credenciado ativo a este cálculo para emitir CT-e.'],
            additionalMissingFields: ['fiscalEmitterId'],
        });

        assert.equal(result.ok, false);
        assert.equal(result.canEmit, false);
        assert.deepEqual(result.missingFields, ['fiscalEmitterId']);
    });

    it('bloqueia emissão quando input é nulo mesmo sem pendências externas', () => {
        const result = buildCtePreflightResult(null, {
            environment: 'HOMOLOGACAO',
            provider: 'ACBR',
        });

        assert.equal(result.ok, false);
        assert.equal(result.canEmit, false);
        assert.ok(result.issues.includes('Dados de cálculo e pedido são obrigatórios para o preflight completo do CT-e.'));
        assert.deepEqual(result.missingFields, []);
        assert.equal(result.tax.cfop, null);
        assert.equal(result.tax.cst, null);
    });
});
