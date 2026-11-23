import { describe, expect, it } from 'vitest';
import type { FreightDocType, FreightDocumentSummary, FreightQueueItem } from '../../../types/index';
import {
    buildEmitOptions,
    canCancelCte,
    canCorrectCfop,
    cancelReasonCheck,
    documentTone,
    emitReadiness,
    EMPTY_INFORMED,
    hasInFlight,
    isFailedOutcome,
    outcomeNotice,
    queueBatch,
    queueEmitOptions,
    queueResultText,
    readableFiscalMessage,
    visibleDocuments,
    type ComposerState,
} from './freteDoc';

const suggestion = { blockers: [] as string[], missingFields: [] as string[], docs: { allowed: ['CTE', 'MINUTA'] as FreightDocType[], recommended: 'CTE' as FreightDocType, reason: '' } };
const base: ComposerState = { docType: 'CTE', informedMode: false, tableId: 't1', form: EMPTY_INFORMED, reason: '', tax: { cfop: '', cst: '' }, newDocument: false };
const doc = (patch: Partial<FreightDocumentSummary>) => ({ id: 'd1', documentType: 'CTE', status: 'CTE_AUTHORIZED', statusReason: null, ...patch }) as FreightDocumentSummary;

describe('mensagens fiscais legíveis', () => {
    it('traduz timeout, emissor fora do ar e certificado vencido', () => {
        expect(readableFiscalMessage('timeout of 30000ms exceeded', 'x')).toMatch(/demorou a responder/);
        expect(readableFiscalMessage('connect ECONNREFUSED 10.0.0.1:443', 'x')).toMatch(/fora do ar/);
        expect(readableFiscalMessage('Certificado digital vencido em 2026-01-01', 'x')).toMatch(/certificado digital/i);
    });
    it('mantém o texto em português do servidor e troca o técnico pelo reserva', () => {
        expect(readableFiscalMessage('Sem tabela de preço para este pedido.', 'x')).toBe('Sem tabela de preço para este pedido.');
        expect(readableFiscalMessage('PrismaClientKnownRequestError: invalid invocation', 'Não foi possível emitir.')).toBe('Não foi possível emitir.');
        expect(readableFiscalMessage('', 'reserva')).toBe('reserva');
        expect(readableFiscalMessage(undefined, 'reserva')).toBe('reserva');
    });
});

describe('o que a emissão exige', () => {
    it('pronto com tabela e sem pendência', () => {
        const readiness = emitReadiness(suggestion, base, { tableTotal: 350, tableCount: 1, busy: false });
        expect(readiness).toMatchObject({ total: 350, canEmit: true, showTax: false });
    });
    it('sem valor, ocupado ou com pendência não emite; "sem tabela" não conta como pendência', () => {
        expect(emitReadiness(suggestion, base, { tableTotal: 0, tableCount: 0, busy: false }).canEmit).toBe(false);
        expect(emitReadiness(suggestion, base, { tableTotal: 10, tableCount: 1, busy: true }).canEmit).toBe(false);
        const blocked = { ...suggestion, blockers: ['Sem tabela de preço para esta rota', 'Destinatário sem IE'] };
        const readiness = emitReadiness(blocked, base, { tableTotal: 10, tableCount: 1, busy: false });
        expect(readiness.blocking).toEqual(['Destinatário sem IE']);
        expect(readiness.canEmit).toBe(false);
    });
    it('CFOP/CST faltando pedem escolha e bloqueiam até escolher', () => {
        const missing = { ...suggestion, missingFields: ['cfop', 'cst'], blockers: ['CFOP não definido'] };
        const empty = emitReadiness(missing, base, { tableTotal: 10, tableCount: 1, busy: false });
        expect(empty.showTax).toBe(true);
        expect(empty.canEmit).toBe(false);
        const chosen = emitReadiness(missing, { ...base, tax: { cfop: '6353', cst: '00' } }, { tableTotal: 10, tableCount: 1, busy: false });
        expect(chosen.canEmit).toBe(true);
    });
    it('valor informado com tabela disponível exige motivo', () => {
        const form = { ...EMPTY_INFORMED, freightBase: '100,00' };
        const state = { ...base, informedMode: true, form };
        expect(emitReadiness(suggestion, state, { tableTotal: 0, tableCount: 2, busy: false }).canEmit).toBe(false);
        expect(emitReadiness(suggestion, { ...state, reason: 'negociado' }, { tableTotal: 0, tableCount: 2, busy: false })).toMatchObject({ total: 100, canEmit: true });
        expect(emitReadiness(suggestion, state, { tableTotal: 0, tableCount: 0, busy: false }).canEmit).toBe(true);
    });
});

describe('corpo da emissão', () => {
    it('por tabela: só o id da tabela e se é outro documento', () => {
        expect(buildEmitOptions(base, { showTax: false }, 1)).toEqual({ documentType: 'CTE', pricingTableId: 't1', newDocument: false });
        expect(buildEmitOptions({ ...base, newDocument: true, docType: 'MINUTA' }, { showTax: false }, 1)).toEqual({ documentType: 'MINUTA', pricingTableId: 't1', newDocument: true });
    });
    it('informado: valores por componente e motivo só quando há tabela; CFOP/CST só quando pedidos', () => {
        const form = { ...EMPTY_INFORMED, freightBase: '1.200,50', toll: '30' };
        const state = { ...base, informedMode: true, form, reason: '  negociado  ', tax: { cfop: '6353', cst: '00' } };
        expect(buildEmitOptions(state, { showTax: true }, 2)).toEqual({
            documentType: 'CTE',
            informed: { freightBase: 1200.5, toll: 30 },
            reason: 'negociado',
            newDocument: false,
            tax: { cfop: '6353', cst: '00' },
        });
        expect(buildEmitOptions(state, { showTax: false }, 0)).toEqual({ documentType: 'CTE', informed: { freightBase: 1200.5, toll: 30 }, newDocument: false });
    });
});

describe('resultado da emissão', () => {
    const calc = { documentType: 'CTE', cteNumber: '123', minutaNumber: '9' } as never;
    it('diz o que aconteceu em texto', () => {
        expect(outcomeNotice({ kind: 'authorized', calc })).toEqual({ tone: 'ok', text: 'CT-e nº 123 autorizado.' });
        expect(outcomeNotice({ kind: 'sent', calc }).tone).toBe('info');
        expect(outcomeNotice({ kind: 'already', calc }).text).toMatch(/nada foi duplicado/);
        expect(outcomeNotice({ kind: 'blocked', issues: ['Destinatário sem IE.'], missingFields: ['cfop'] }).text).toBe('Pendências: Destinatário sem IE. falta cfop');
        expect(outcomeNotice({ kind: 'rejected', calc, reason: 'Rejeição 519: CFOP inválido' }).text).toMatch(/^Rejeitado: Rejeição 519/);
        expect(outcomeNotice({ kind: 'error', message: 'Error: undefined is not a function' }).text).toBe('Não foi possível emitir o documento. Tente de novo.');
    });
    it('falha = rejeitado, bloqueado ou erro', () => {
        expect(isFailedOutcome({ kind: 'error', message: 'x' })).toBe(true);
        expect(isFailedOutcome({ kind: 'blocked', issues: [], missingFields: [] })).toBe(true);
        expect(isFailedOutcome({ kind: 'sent', calc })).toBe(false);
        expect(isFailedOutcome({ kind: 'already', calc })).toBe(false);
    });
    it('linha da fila', () => {
        expect(queueResultText({ kind: 'already', calc })).toEqual({ ok: true, text: 'já tinha documento' });
        expect(queueResultText({ kind: 'blocked', issues: ['Remetente sem IE'], missingFields: [] })).toEqual({ ok: false, text: 'Remetente sem IE' });
    });
});

describe('documentos emitidos', () => {
    it('rascunho sem motivo some; rejeitado e autorizado aparecem', () => {
        const list = [doc({ status: 'DRAFT' }), doc({ id: 'd2', status: 'CALCULATED', statusReason: 'Rejeição anterior' }), doc({ id: 'd3' })];
        expect(visibleDocuments(list).map((d) => d.id)).toEqual(['d2', 'd3']);
    });
    it('cancelar só CT-e autorizado, com motivo de 15 a 255 caracteres', () => {
        expect(canCancelCte(doc({}))).toBe(true);
        expect(canCancelCte(doc({ documentType: 'MINUTA' }))).toBe(false);
        expect(canCancelCte(doc({ status: 'CTE_CANCEL_PENDING' }))).toBe(false);
        expect(cancelReasonCheck('curto')).toMatchObject({ ok: false, missing: 10 });
        expect(cancelReasonCheck('  pagador informado errado  ').ok).toBe(true);
        expect(cancelReasonCheck('x'.repeat(256)).ok).toBe(false);
    });
    it('reenvio por CFOP só no rejeitado que cita o CFOP', () => {
        expect(canCorrectCfop(doc({ status: 'CTE_REJECTED', statusReason: 'Rejeição 519: CFOP de operação interestadual' }))).toBe(true);
        expect(canCorrectCfop(doc({ status: 'CTE_REJECTED', statusReason: 'IE do destinatário inválida' }))).toBe(false);
        expect(canCorrectCfop(doc({ status: 'CTE_AUTHORIZED', statusReason: 'CFOP' }))).toBe(false);
    });
    it('acompanha enquanto há envio em andamento; tom de cada estado', () => {
        expect(hasInFlight([doc({ status: 'CTE_SENT' })])).toBe(true);
        expect(hasInFlight([doc({})])).toBe(false);
        expect([documentTone('ok'), documentTone('warn'), documentTone('danger'), documentTone('none')]).toEqual(['royal', 'yellow', 'red', 'neutral']);
    });
});

describe('fila em lote', () => {
    const item = (orderId: string, ready: boolean, recommended: 'CTE' | 'MINUTA' = 'CTE') =>
        ({ orderId, ready, suggestion: { docs: { recommended } } }) as unknown as FreightQueueItem;
    it('só os prontos e marcados saem, na ordem da fila, com o documento recomendado', () => {
        const items = [item('a', true), item('b', false), item('c', true, 'MINUTA'), item('d', true)];
        const batch = queueBatch(items, new Set(['a', 'b', 'c']));
        expect(batch.map((i) => i.orderId)).toEqual(['a', 'c']);
        expect(queueEmitOptions(batch[1])).toEqual({ documentType: 'MINUTA' });
    });
});
