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

import {
    buildTripComposition,
    classifyDocument,
    cnhStatus,
    driverToDraft,
    formatPersonAddress,
    resolveCarrierLookup,
    sortDriversForLink,
    unitPrefillFromVehicle,
} from './carrier';

describe('classifyDocument / resolveCarrierLookup', () => {
    it('classifica por quantidade de dígitos', () => {
        expect(classifyDocument('123.456.789-09')).toBe('CPF');
        expect(classifyDocument('12.345.678/0001-90')).toBe('CNPJ');
        expect(classifyDocument('1234')).toBeNull();
    });

    const person = { id: 'p1', document: '12345678000190', legalName: 'ACME LTDA' };
    it('transportador existente tem prioridade; só pessoa vira prefill; documento parcial não casa', () => {
        expect(resolveCarrierLookup([{ ...person, links: [{ id: 'l1', name: 'Acme' }] }], '12.345.678/0001-90')).toEqual({ kind: 'LINK', linkId: 'l1', name: 'Acme' });
        expect(resolveCarrierLookup([person], '12345678000190').kind).toBe('PERSON');
        expect(resolveCarrierLookup([{ ...person, document: '99912345678000190' }], '12345678000190').kind).toBe('NONE');
    });

    it('formata endereço ignorando vazios', () => {
        expect(formatPersonAddress({ address: 'Rua A', number: '10', city: 'São Luís', state: 'MA' })).toBe('Rua A, 10 · São Luís/MA');
        expect(formatPersonAddress(null)).toBe('');
    });
});

describe('cnhStatus', () => {
    const now = new Date('2026-10-01T12:00:00');
    it('vencida, a vencer, válida e ausente', () => {
        expect(cnhStatus('2026-09-01', now).tone).toBe('bad');
        expect(cnhStatus('2026-10-15', now).tone).toBe('warn');
        expect(cnhStatus('2028-01-01', now).tone).toBe('ok');
        expect(cnhStatus(null, now).tone).toBe('missing');
    });
});

describe('sortDriversForLink', () => {
    it('ligados ao transportador vêm primeiro', () => {
        const rows = [
            { id: 'a', name: 'Ana', document: '1', carriers: [] },
            { id: 'b', name: 'Zé', document: '2', carriers: [{ linkId: 'L', active: true }] },
            { id: 'c', name: 'Bia', document: '3', linkId: 'L' },
        ];
        expect(sortDriversForLink(rows, 'L').map((d) => d.id)).toEqual(['c', 'b', 'a']);
    });
});

describe('prefill', () => {
    it('driverToDraft normaliza datas e UF da CNH', () => {
        const draft = driverToDraft({ name: 'João', birthDate: '1980-02-03T00:00:00.000Z', cnhExpiry: '2027-05-06T00:00:00.000Z', person: { state: 'MA' } });
        expect(draft.birthDate).toBe('1980-02-03');
        expect(draft.cnhExpiry).toBe('2027-05-06');
        expect(draft.cnhState).toBe('MA');
        expect(draft.cnhCategory).toBe('E');
    });

    it('unitPrefillFromVehicle só traz o que existe', () => {
        const patch = unitPrefillFromVehicle({ renavam: '123456789', axles: 3, tareKg: null, rntrcHolderPerson: { rntrc: '12345678' } });
        expect(patch).toEqual({ renavam: '123456789', axles: '3', rntrc: '12345678' });
    });
});

describe('buildTripComposition', () => {
    it('normaliza, remove repetidas/inválidas e limita a 3 implementos', () => {
        const out = buildTripComposition('abc-1d23', ['xyz1a11', 'XYZ1A11', 'x', 'bbb2b22', 'ccc3c33', 'ddd4d44']);
        expect(out?.traction.plate).toBe('ABC1D23');
        expect(out?.trailers.map((t) => t.plate)).toEqual(['XYZ1A11', 'BBB2B22', 'CCC3C33']);
        expect(buildTripComposition('', [])).toBeNull();
    });
});
