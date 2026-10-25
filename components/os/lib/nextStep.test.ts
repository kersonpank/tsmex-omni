import { describe, expect, it } from 'vitest';
import type { ManifestFiscalDocument, ManifestReadiness, ManifestReadinessIssue } from '../../../types/index';
import type { ManifestWithLegs } from './arrival';
import { tripNextStep } from './nextStep';

function document(documentType: 'CIOT' | 'MDFE', status: ManifestFiscalDocument['status'] = 'AUTHORIZED'): ManifestFiscalDocument {
    return { id: documentType, manifestId: 'trip', documentType, status, createdAt: '', updatedAt: '' };
}

function manifest(overrides: Partial<ManifestWithLegs> = {}): ManifestWithLegs {
    return {
        id: 'trip', status: 'ACCEPTED', vehicleTypeId: 'truck', origin: 'Origem', destination: 'Destino',
        totalWeight: 1, totalVolume: 1, totalValue: 1, createdAt: '', updatedAt: '',
        linkId: 'carrier', driverId: 'driver', fiscalEmitterId: 'emitter', plannedDepartureAt: '2026-10-25T12:00:00Z',
        freightAgreement: {
            id: 'agreement', manifestId: 'trip', freteBruto: 0, adiantamento: 0, pedagio: 0, irrf: 0, inss: 0,
            issqn: 0, sestSenat: 0, outrosDescontos: 0, saldoLiquido: 0, createdAt: '', updatedAt: '',
        },
        legs: [{ id: 'leg', orderId: 'order', order: { id: 'order', freightDocState: 'emitted' } }],
        fiscalDocuments: [document('CIOT'), document('MDFE')],
        ...overrides,
    };
}

function issue(code: string, step: ManifestReadinessIssue['step'] = 'fiscal', severity: ManifestReadinessIssue['severity'] = 'blocking'): ManifestReadinessIssue {
    return { code, step, severity, message: `Resolver ${code}` };
}

function readiness(issues: ManifestReadinessIssue[] = [], overrides: Partial<ManifestReadiness> = {}): ManifestReadiness {
    return { canOffer: true, canStart: true, currentStep: 'review', steps: {} as ManifestReadiness['steps'], issues, ...overrides };
}

describe('tripNextStep', () => {
    it('resolve transportador/motorista antes de Carta Frete, saída e documentos', () => {
        expect(tripNextStep(manifest({ linkId: undefined, freightAgreement: null, plannedDepartureAt: null }), readiness()).action).toBe('responsible');
        expect(tripNextStep(manifest({ driverId: null }), readiness()).action).toBe('responsible');
    });

    it('respeita o bloqueio do servidor para motorista ou transportador já escolhido', () => {
        const pending = issue('DRIVER_LINK_MISMATCH', 'responsible');
        expect(tripNextStep(manifest(), readiness([pending]))).toMatchObject({ action: 'responsible', hint: pending.message });
    });

    it('pede Carta Frete antes da saída prevista e aceita frete zero', () => {
        expect(tripNextStep(manifest({ freightAgreement: null, plannedDepartureAt: null }), readiness()).action).toBe('freight');
        expect(tripNextStep(manifest(), readiness()).action).toBe('start');
    });

    it('usa o bloqueio da Carta Frete mesmo com um acordo no cliente', () => {
        expect(tripNextStep(manifest(), readiness([issue('FREIGHT_AGREEMENT_REQUIRED', 'freight')])).action).toBe('freight');
    });

    it('pede saída prevista e corrige chegada anterior à saída', () => {
        expect(tripNextStep(manifest({ plannedDepartureAt: null }), readiness()).action).toBe('departure');
        expect(tripNextStep(manifest(), readiness([issue('ARRIVAL_BEFORE_DEPARTURE', 'cover')])).action).toBe('departure');
    });

    it('resolve emitente fiscal antes dos documentos', () => {
        expect(tripNextStep(manifest({ fiscalEmitterId: null, fiscalDocuments: [] }), readiness()).action).toBe('emitter');
        expect(tripNextStep(manifest(), readiness([issue('FISCAL_EMITTER_PENDING', 'cover', 'warning')])).action).toBe('emitter');
    });

    it.each(['DRIVER_CNH_PENDING', 'VEHICLE_RENAVAM_PENDING', 'MDFE_VEHICLE_CAPACITY_PENDING'])('encaminha %s ao cadastro', (code) => {
        const pending = issue(code, code.startsWith('MDFE_') ? 'fiscal' : 'responsible');
        expect(tripNextStep(manifest({ fiscalDocuments: [] }), readiness([pending]))).toMatchObject({ action: 'registry', hint: pending.message });
    });

    it('antecipa dados obrigatórios do veículo mesmo quando ainda são avisos', () => {
        expect(tripNextStep(manifest(), readiness([issue('MDFE_VEHICLE_DATA_PENDING', 'responsible', 'warning')])).action).toBe('registry');
    });

    it('não repete avisos informativos de transportador sem acesso ou frota agregada', () => {
        expect(tripNextStep(manifest(), readiness([
            issue('LINK_ACCESS_PENDING', 'responsible', 'warning'),
            issue('RNTRC_HOLDER_NOT_CARRIER', 'responsible', 'warning'),
        ])).action).toBe('start');
    });

    it.each(['ORDER_DOCUMENTATION_PENDING', 'CTE_AUTHORIZATION_REQUIRED'])('prioriza %s mesmo com badge emitted', (code) => {
        expect(tripNextStep(manifest({ fiscalDocuments: [] }), readiness([
            issue('MDFE_AUTHORIZATION_REQUIRED'), issue('CIOT_REQUIRED'), issue(code, code.startsWith('ORDER_') ? 'orders' : 'fiscal'),
        ])).action).toBe('documents_cte');
    });

    it.each(['none', 'draft', 'in_flight', 'rejected'] as const)('pede CT-e quando uma perna está %s', (freightDocState) => {
        expect(tripNextStep(manifest({
            legs: [{ id: 'leg', orderId: 'order', order: { id: 'order', freightDocState } }], fiscalDocuments: [],
        }), readiness()).action).toBe('documents_cte');
    });

    it('confirma o rascunho para liberar emissão de CIOT e MDF-e', () => {
        expect(tripNextStep(manifest({ status: 'DRAFT', fiscalDocuments: [] }), readiness())).toMatchObject({
            action: 'confirm', label: 'Confirmar transportador', hint: 'Confirme o transportador para liberar CIOT e MDF-e.',
        });
    });

    it('confirma pelo transportador quando o aceite está pendente', () => {
        expect(tripNextStep(manifest({ status: 'PENDING_ACCEPT', fiscalDocuments: [] }), readiness())).toMatchObject({ action: 'confirm', label: 'Confirmar pelo transportador' });
    });

    it('não confirma rascunho sem canOffer nem registra saída sem canStart', () => {
        expect(tripNextStep(manifest({ status: 'DRAFT' }), readiness([], { canOffer: false })).action).toBe('none');
        expect(tripNextStep(manifest(), readiness([], { canStart: false })).action).toBe('none');
        expect(tripNextStep(manifest(), null).action).toBe('none');
    });

    it('mantém bloqueios de rota/carga visíveis sem oferecer confirmação', () => {
        const pending = issue('ORDER_REQUIRED', 'orders');
        expect(tripNextStep(manifest({ status: 'DRAFT' }), readiness([pending]))).toMatchObject({ action: 'none', hint: pending.message });
    });

    it('só oferece MDF-e depois de CIOT autorizado ou dispensado', () => {
        expect(tripNextStep(manifest({ fiscalDocuments: [] }), readiness()).action).toBe('documents_ciot');
        expect(tripNextStep(manifest({ fiscalDocuments: [document('CIOT', 'REJECTED')] }), readiness()).action).toBe('documents_ciot');
        expect(tripNextStep(manifest({ fiscalDocuments: [document('CIOT')] }), readiness()).action).toBe('documents_mdfe');
        expect(tripNextStep(manifest({ fiscalDocuments: [], ciotDispensado: true }), readiness()).action).toBe('documents_mdfe');
    });

    it('confia nas pendências fiscais do servidor mesmo com documentos antigos no cliente', () => {
        expect(tripNextStep(manifest(), readiness([issue('CIOT_REQUIRED'), issue('MDFE_AUTHORIZATION_REQUIRED')])).action).toBe('documents_ciot');
        expect(tripNextStep(manifest(), readiness([issue('MDFE_AUTHORIZATION_REQUIRED')])).action).toBe('documents_mdfe');
    });

    it('oferece consulta para MDF-e enviado sem incentivar nova emissão', () => {
        expect(tripNextStep(manifest({ fiscalDocuments: [document('CIOT'), document('MDFE', 'SENT')] }), readiness())).toMatchObject({
            action: 'documents_mdfe', label: 'Consultar MDF-e', hint: 'MDF-e em processamento na SEFAZ — não reemita.',
        });
    });

    it('registra saída apenas quando o servidor libera', () => {
        expect(tripNextStep(manifest(), readiness())).toMatchObject({ action: 'start', label: 'Registrar saída' });
        expect(tripNextStep(manifest({ fiscalDocuments: undefined }), readiness()).action).toBe('start');
    });

    it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const)('não sugere preparação para status %s', (status) => {
        expect(tripNextStep(manifest({ status, linkId: undefined, freightAgreement: null }), readiness()).action).toBe('none');
    });
});
