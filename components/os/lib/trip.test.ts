import { describe, expect, it } from 'vitest';
import type { ManifestReadiness, ManifestReadinessIssue } from '../../../types/index';
import { groupIssues, groupOf, linkCompositionPlates, occupancy, parseMoney, primaryAction } from './trip';

function issue(partial: Partial<ManifestReadinessIssue>): ManifestReadinessIssue {
    return { step: 'responsible', code: 'X', severity: 'blocking', message: 'm', ...partial } as ManifestReadinessIssue;
}

function readiness(issues: ManifestReadinessIssue[], flags: Partial<ManifestReadiness> = {}): ManifestReadiness {
    return { canOffer: false, canStart: false, currentStep: 'review', steps: {} as never, issues, ...flags } as ManifestReadiness;
}

describe('groupOf', () => {
    it('pendências operacionais caem no grupo com ação própria', () => {
        expect(groupOf(issue({ code: 'LINK_REQUIRED' }))).toBe('responsible');
        expect(groupOf(issue({ code: 'DRIVER_REQUIRED' }))).toBe('responsible');
        expect(groupOf(issue({ step: 'cover', code: 'DEPARTURE_REQUIRED' }))).toBe('departure');
        expect(groupOf(issue({ step: 'freight', code: 'FREIGHT_AGREEMENT_REQUIRED' }))).toBe('freight');
        expect(groupOf(issue({ step: 'fiscal', code: 'MDFE_AUTHORIZATION_REQUIRED' }))).toBe('documents');
    });

    it('dados de veículo/motorista sem código mapeado viram cadastro', () => {
        expect(groupOf(issue({ code: 'VEHICLE_CHASSI_PENDING' }))).toBe('registry');
        expect(groupOf(issue({ code: 'DRIVER_CNH_PENDING' }))).toBe('registry');
    });
});

describe('groupIssues', () => {
    it('grupos com bloqueio vêm antes dos que só têm aviso, na ordem da roda', () => {
        const groups = groupIssues([
            issue({ step: 'cover', code: 'FISCAL_EMITTER_PENDING', severity: 'warning' }),
            issue({ step: 'freight', code: 'FREIGHT_AGREEMENT_REQUIRED' }),
            issue({ code: 'LINK_REQUIRED' }),
        ]);
        expect(groups.map((g) => g.key)).toEqual(['responsible', 'freight', 'emitter']);
        expect(groups[2].blocking).toHaveLength(0);
        expect(groups[2].warnings).toHaveLength(1);
    });
});

describe('primaryAction', () => {
    it('rascunho: confirmar transportador só sem bloqueios', () => {
        const blocked = primaryAction('DRAFT', readiness([issue({ code: 'LINK_REQUIRED' })]));
        expect(blocked).toMatchObject({ kind: 'confirm', enabled: false });
        expect(blocked.hint).toContain('1 pendência');
        expect(primaryAction('DRAFT', readiness([], { canOffer: true }))).toMatchObject({ kind: 'confirm', enabled: true });
    });

    it('confirmada: registrar saída depende de canStart', () => {
        expect(primaryAction('ACCEPTED', readiness([], { canStart: true }))).toMatchObject({ kind: 'start', enabled: true });
        expect(primaryAction('ACCEPTED', readiness([issue({ step: 'fiscal', code: 'CIOT_REQUIRED' })]))).toMatchObject({
            kind: 'start',
            enabled: false,
        });
    });

    it('aguardando aceite: o hub confirma pelo transportador', () => {
        expect(primaryAction('PENDING_ACCEPT', null)).toMatchObject({ kind: 'accept', enabled: true });
    });

    it('em rota não tem ação', () => {
        expect(primaryAction('IN_PROGRESS', null).kind).toBe('none');
    });
});

describe('linkCompositionPlates', () => {
    it('prefere as unidades cadastradas e cai para as placas legadas', () => {
        expect(
            linkCompositionPlates({
                vehiclePlate: 'AAA1111',
                trailerPlate: 'BBB2222',
                tractionUnit: { plate: 'CCC3333' },
                trailer2Unit: { plate: 'DDD4444' },
            }),
        ).toEqual({ traction: 'CCC3333', trailers: ['BBB2222', 'DDD4444'] });
    });

    it('sem placa nenhuma devolve tração nula', () => {
        expect(linkCompositionPlates({ vehiclePlate: null })).toEqual({ traction: null, trailers: [] });
    });
});

describe('occupancy', () => {
    it('percentual por peso e volume; sem capacidade fica nulo', () => {
        expect(occupancy(5000, 20, 10000, 80)).toEqual({ weightPct: 50, volumePct: 25 });
        expect(occupancy(5000, 20)).toEqual({ weightPct: null, volumePct: null });
    });
});

describe('parseMoney', () => {
    it('aceita formato brasileiro, sem milhar e com ponto decimal', () => {
        expect(parseMoney('1.500,50')).toBe(1500.5);
        expect(parseMoney('1500,50')).toBe(1500.5);
        expect(parseMoney('1500.50')).toBe(1500.5);
        expect(parseMoney('')).toBe(0);
        expect(parseMoney('abc')).toBe(0);
    });
});
