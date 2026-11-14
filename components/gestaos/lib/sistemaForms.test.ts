import { describe, expect, it } from 'vitest';
import { buildEmitterPayload, certificateProblem, emptyEmitterForm, seedProblem, validateEmitterForm } from './sistemaForms';

describe('emitente fiscal', () => {
    it('exige o CNPJ e a seguradora com 14 dígitos', () => {
        expect(validateEmitterForm(emptyEmitterForm())).toHaveProperty('personId');
        expect(validateEmitterForm({ ...emptyEmitterForm(), personId: 'p', cargoInsurerCnpj: '123' })).toHaveProperty('cargoInsurerCnpj');
        expect(validateEmitterForm({ ...emptyEmitterForm(), personId: 'p', cargoInsurerCnpj: '11.222.333/0001-81' })).toEqual({});
    });
    it('só envia a senha da averbação quando digitada e leva o campo de totais do MDF-e', () => {
        const base = { ...emptyEmitterForm(), personId: 'p', mdfeCargoTotalsSource: 'ORDER_REAL_WEIGHT' as const };
        const keep = buildEmitterPayload(base);
        expect(keep).not.toHaveProperty('atmPassword');
        expect(keep.mdfeCargoTotalsSource).toBe('ORDER_REAL_WEIGHT');
        expect(buildEmitterPayload({ ...base, atmPassword: 'x' })).toHaveProperty('atmPassword', 'x');
        expect(keep).toMatchObject({ hubId: null, displayName: null, environment: 'HOMOLOGACAO', provider: 'SIMULATED' });
    });
});

describe('certificado e semente', () => {
    it('valida extensão e senha', () => {
        expect(certificateProblem(null, '')).toBeNull();
        expect(certificateProblem({ name: 'a.pem' }, 'x')).toMatch(/pfx/);
        expect(certificateProblem({ name: 'a.PFX' }, '')).toMatch(/senha/);
        expect(certificateProblem({ name: 'a.p12' }, 'x')).toBeNull();
    });
    it('chave tem 44 dígitos e NSU não é vazio', () => {
        expect(seedProblem('chave', '123')).not.toBeNull();
        expect(seedProblem('chave', '1'.repeat(44))).toBeNull();
        expect(seedProblem('nsu', '')).not.toBeNull();
        expect(seedProblem('nsu', '42')).toBeNull();
    });
});
