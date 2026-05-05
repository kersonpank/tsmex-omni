import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    authorizeCteWithProvider,
    validateCteReadiness,
    type CteEmissionInput,
} from './cteService.js';

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
    numero: 42,
    serie: 1,
    ambiente: 'HOMOLOGACAO',
};

describe('validateCteReadiness', () => {
    it('aprova CT-e quando dados fiscais mínimos estão completos', () => {
        const result = validateCteReadiness(completeInput);

        assert.equal(result.ok, true);
        assert.deepEqual(result.issues, []);
    });

    it('lista pendências fiscais recuperáveis antes do envio', () => {
        const input: CteEmissionInput = {
            ...completeInput,
            calc: { ...completeInput.calc, cfop: null, cst: null },
            hub: { ...completeInput.hub, rntrc: '' },
            person: { ...completeInput.person, address: null },
            order: {
                ...completeInput.order,
                remetentePerson: null,
                invoicesRel: [{ ...completeInput.order.invoicesRel[0], nfKey: '123' }],
            },
        };

        const result = validateCteReadiness(input);

        assert.equal(result.ok, false);
        assert.ok(result.issues.includes('Hub emissor precisa de RNTRC para CT-e.'));
        assert.ok(result.issues.includes('Emitente precisa de endereço, município, UF e CEP.'));
        assert.ok(result.issues.includes('Tomador do frete não identificado para o termo CIF.'));
        assert.ok(result.issues.includes('CT-e precisa de CFOP.'));
        assert.ok(result.issues.includes('CT-e precisa de CST.'));
        assert.ok(result.issues.includes('NF-e 123 precisa de chave de acesso com 44 dígitos.'));
    });

    it('rejeita CST fora do catálogo fiscal suportado', () => {
        const result = validateCteReadiness({
            ...completeInput,
            calc: { ...completeInput.calc, cst: '99' },
        });

        assert.equal(result.ok, false);
        assert.ok(result.issues.includes('CST 99 não está habilitado para CT-e no MVP.'));
    });
});

describe('authorizeCteWithProvider', () => {
    it('provider simulado autoriza com chave, protocolo, XML e PDF', async () => {
        const result = await authorizeCteWithProvider(completeInput, { mode: 'simulate-authorized' });

        assert.equal(result.status, 'AUTHORIZED');
        assert.match(result.accessKey ?? '', /^\d{44}$/);
        assert.match(result.protocol ?? '', /^SIM\d+$/);
        assert.match(result.xml ?? '', /<cte/);
        assert.match(result.pdfUrl ?? '', /cte\/42\.pdf$/);
    });

    it('provider simulado rejeita sem criar chave/protocolo fiscal', async () => {
        const result = await authorizeCteWithProvider(completeInput, { mode: 'simulate-rejected' });

        assert.equal(result.status, 'REJECTED');
        assert.equal(result.accessKey, undefined);
        assert.equal(result.protocol, undefined);
        assert.equal(result.rejectionReason, 'Rejeição simulada do provedor fiscal.');
    });
});
