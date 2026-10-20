import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addressComplete, driverRegistryIssues, unitRegistryIssues } from './carrierRegistry.js';
import type { ResolvedVehicleUnit } from './vehicleUnitRules.js';

const fullAddress = {
    cep: '65900000',
    address: 'Rua A',
    number: '10',
    neighborhood: 'Centro',
    city: 'Imperatriz',
    state: 'MA',
    cityIbgeCode: '2105302',
};

describe('addressComplete', () => {
    it('exige todos os campos do Gravar Proprietário/Motorista, incluindo IBGE', () => {
        assert.equal(addressComplete(fullAddress), true);
        assert.equal(addressComplete({ ...fullAddress, cityIbgeCode: null }), false);
        assert.equal(addressComplete(null), false);
    });
});

describe('driverRegistryIssues', () => {
    it('motorista completo não tem pendência', () => {
        assert.deepEqual(driverRegistryIssues({ cnhNumber: '123', birthDate: '1990-01-01', cnhExpiry: '2099-01-01' }, fullAddress), []);
    });

    it('aponta CNH, nascimento, endereço e CNH vencida', () => {
        const issues = driverRegistryIssues({ cnhExpiry: '2000-01-01' }, { ...fullAddress, number: null }, new Date('2026-10-20'));
        assert.deepEqual(issues, ['número da CNH', 'data de nascimento', 'endereço', 'CNH vencida']);
    });
});

describe('unitRegistryIssues', () => {
    const holder = { personId: 'p1', document: '12345678000190', name: 'X', state: 'MA', rntrc: '12345678' };
    const unit: ResolvedVehicleUnit = {
        source: 'UNIT',
        role: 'TRACTION',
        plate: 'ABC1D23',
        chassi: '9BWZZZ377VT004251',
        renavam: '123456789',
        axles: 3,
        tareKg: 8000,
        capacityKg: 30000,
        bodyType: 'FechadaOuBau',
        wheelType: 'Cavalo',
        licensedState: 'MA',
        mdfeOwnerType: '2',
        rntrcHolder: holder,
    };

    it('placa completa (CIOT + MDF-e) não tem pendência', () => {
        assert.deepEqual(unitRegistryIssues(unit, fullAddress), []);
    });

    it('junta pendências de CIOT, MDF-e, capacidade e endereço do responsável', () => {
        const issues = unitRegistryIssues({ ...unit, chassi: null, licensedState: null, tareKg: null }, null);
        assert.ok(issues.includes('Chassi'));
        assert.ok(issues.includes('UF de licenciamento'));
        assert.ok(issues.includes('tara e capacidade (kg)'));
        assert.ok(issues.includes('endereço do responsável RNTRC'));
    });
});
