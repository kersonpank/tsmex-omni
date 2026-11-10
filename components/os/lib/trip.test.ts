import { describe, expect, it } from 'vitest';
import type { ManifestReadiness, ManifestReadinessIssue } from '../../../types/index';
import { canReopenPlanning, groupIssues, groupOf, linkCompositionPlates, mdfeFixGroup, occupancy, parseMoney, primaryAction, tripVehicleLabel } from './trip';

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

    it('seguro da carga: apólice vai ao emitente e averbação à saída da viagem', () => {
        expect(groupOf(issue({ step: 'fiscal', code: 'MDFE_CARGO_INSURANCE_PENDING' }))).toBe('emitter');
        expect(groupOf(issue({ step: 'fiscal', code: 'MDFE_CARGO_AVERBACAO_PENDING' }))).toBe('departure');
        expect(mdfeFixGroup('Informe o seguro da carga (seguradora, CNPJ e apólice) no emitente e a averbação na viagem antes de emitir o MDF-e.')?.group).toBe('departure');
    });

    it('cavalo obrigatório vai para o responsável e veículo em outra viagem para o cadastro', () => {
        expect(groupOf(issue({ code: 'VEHICLE_TRACTION_REQUIRED', field: 'vehicleTraction' }))).toBe('responsible');
        expect(groupOf(issue({ code: 'VEHICLE_RESERVED_ELSEWHERE', severity: 'warning' }))).toBe('registry');
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

describe('groupIssues — documentos', () => {
    it('ordena CT-e → CIOT → MDF-e', () => {
        const groups = groupIssues([
            issue({ step: 'fiscal', code: 'MDFE_AUTHORIZATION_REQUIRED' }),
            issue({ step: 'fiscal', code: 'CIOT_REQUIRED' }),
            issue({ step: 'fiscal', code: 'CTE_AUTHORIZATION_REQUIRED' }),
        ]);
        expect(groups[0].blocking.map((i) => i.code)).toEqual(['CTE_AUTHORIZATION_REQUIRED', 'CIOT_REQUIRED', 'MDFE_AUTHORIZATION_REQUIRED']);
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

describe('novos códigos de prontidão', () => {
    it('mapeia cada código ao grupo que o resolve', () => {
        expect(groupOf(issue({ code: 'FISCAL_EMITTER_DATA_PENDING', step: 'fiscal' }))).toBe('emitter');
        expect(groupOf(issue({ code: 'MANIFEST_TOTALS_PENDING', step: 'review' }))).toBe('cargo');
        expect(groupOf(issue({ code: 'CTE_EMITTER_MISMATCH', step: 'review' }))).toBe('documents');
        expect(groupOf(issue({ code: 'RNTRC_HOLDER_NOT_CARRIER', step: 'fiscal' }))).toBe('registry');
        expect(groupOf(issue({ code: 'ORIGIN_IBGE_PENDING', step: 'route' }))).toBe('route');
    });
});

describe('mdfeFixGroup', () => {
    it.each([
        ['UF de licenciamento do veículo ausente', 'registry'],
        ['Informe a tara do cavalo', 'registry'],
        ['Capacidade do veículo pendente', 'registry'],
        ['RNTRC do proprietário inválido', 'registry'],
        ['IE do emitente não informada', 'emitter'],
        ['Endereço do emitente incompleto', 'emitter'],
        ['Percurso inválido', 'route'],
        ['CIOT não encontrado', 'documents'],
        ['Valor total da carga zerado', 'cargo'],
        ['Peso bruto inválido', 'cargo'],
    ])('%s -> %s', (message, group) => {
        expect(mdfeFixGroup(message)?.group).toBe(group);
    });
    it('não inventa correção para erro desconhecido', () => {
        expect(mdfeFixGroup('Rejeição 999: falha genérica')).toBeNull();
    });
});

describe('canReopenPlanning', () => {
    const doc = (documentType: 'CIOT' | 'MDFE', status: string) => ({ documentType, status }) as never;
    it('permite reabrir viagem confirmada sem CIOT/MDF-e vivos', () => {
        expect(canReopenPlanning({ status: 'ACCEPTED', fiscalDocuments: [] })).toBe(true);
        expect(canReopenPlanning({ status: 'ACCEPTED', fiscalDocuments: [doc('CIOT', 'REJECTED')] })).toBe(true);
    });
    it('bloqueia com CIOT autorizado, MDF-e em processamento ou outro status', () => {
        expect(canReopenPlanning({ status: 'ACCEPTED', fiscalDocuments: [doc('CIOT', 'AUTHORIZED')] })).toBe(false);
        expect(canReopenPlanning({ status: 'ACCEPTED', fiscalDocuments: [doc('MDFE', 'SENT')] })).toBe(false);
        expect(canReopenPlanning({ status: 'DRAFT', fiscalDocuments: [] })).toBe(false);
    });
    it('respeita a decisão do servidor', () => {
        const blocked = readiness([], { planningActions: { reopen: { allowed: false, reason: 'x' } } as never });
        expect(canReopenPlanning({ status: 'ACCEPTED', fiscalDocuments: [] }, blocked)).toBe(false);
    });
});

describe('tripVehicleLabel', () => {
    const unit = (slot: number, plate: string, role: string, wheelType?: string) => ({ slot, vehicleUnit: { plate, role, wheelType } }) as never;
    it('troca "Van" pelas placas quando a composição tem cavalo', () => {
        const label = tripVehicleLabel({
            vehicleType: { name: 'Van' } as never,
            vehicleAssignments: [unit(0, 'AAA1A11', 'TRACTION', 'Cavalo'), unit(1, 'BBB2B22', 'TRAILER')],
        });
        expect(label).toBe('AAA1A11 + BBB2B22');
    });
    it('mantém o nome do tipo nos demais casos', () => {
        expect(tripVehicleLabel({ vehicleType: { name: 'Van' } as never, vehicleAssignments: [] })).toBe('Van');
        expect(tripVehicleLabel({ vehicleType: { name: 'Carreta' } as never, vehicleAssignments: [unit(0, 'AAA1A11', 'TRACTION', 'Cavalo')] })).toBe('Carreta');
        expect(tripVehicleLabel({ vehicleType: undefined, vehicleAssignments: [] })).toBe('veículo');
    });
});
