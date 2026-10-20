import { describe, expect, it } from 'vitest';
import { defaultOwnerType, formToUnitInput, unitFormErrors, unitToForm, type RegistryUnit } from './carrier';

describe('defaultOwnerType', () => {
    it('CPF → TAC independente; CNPJ → outros', () => {
        expect(defaultOwnerType('123.456.789-09')).toBe('1');
        expect(defaultOwnerType('12.345.678/0001-90')).toBe('2');
    });
});

describe('unitToForm', () => {
    it('placa nova herda UF do transportador e vínculo pelo documento', () => {
        const form = unitToForm(null, '12345678000190', 'MA');
        expect(form.licensedState).toBe('MA');
        expect(form.mdfeOwnerType).toBe('2');
    });

    it('reboque nasce com rodado "não se aplica"', () => {
        const trailer = { plate: 'AAA1A11', role: 'TRAILER', issues: [] } as RegistryUnit;
        expect(unitToForm(trailer, '12345678909').wheelType).toBe('NaoAplicavel');
    });
});

describe('unitFormErrors', () => {
    const base = unitToForm(null, '12345678909', 'MA');

    it('placa obrigatória e formatos de RENAVAM, chassi e RNTRC', () => {
        const errors = unitFormErrors({ ...base, plate: 'AB', renavam: '12', chassi: 'X', rntrc: '123456789' }, 'TRACTION');
        expect(errors).toHaveLength(4);
    });

    it('cavalo exige rodado válido quando informado', () => {
        expect(unitFormErrors({ ...base, plate: 'ABC1D23', wheelType: 'NaoAplicavel' }, 'TRACTION')).toContain(
            'Escolha o tipo de rodado do cavalo.',
        );
        expect(unitFormErrors({ ...base, plate: 'ABC1D23', wheelType: 'NaoAplicavel' }, 'TRAILER')).toEqual([]);
    });
});

describe('formToUnitInput', () => {
    it('normaliza e envia só o que foi preenchido', () => {
        const input = formToUnitInput({
            ...unitToForm(null, '12345678909', 'MA'),
            plate: 'abc-1d23',
            renavam: '00123456789',
            chassi: '9bwzzz377vt004251',
            axles: '3',
            tareKg: '8.000',
            capacityKg: '',
            bodyType: 'FechadaOuBau',
            wheelType: 'Cavalo',
            rntrc: '1234-5678',
        });
        expect(input).toEqual({
            plate: 'ABC1D23',
            renavam: '00123456789',
            chassi: '9BWZZZ377VT004251',
            axles: 3,
            tareKg: 8000,
            bodyType: 'FechadaOuBau',
            wheelType: 'Cavalo',
            licensedState: 'MA',
            mdfeOwnerType: '1',
            rntrc: '12345678',
        });
    });
});
