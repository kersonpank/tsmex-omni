import { describe, expect, it } from 'vitest';
import type { ManifestReadiness } from '../../../types/index';
import { buildCorrectionBody, cancelCiotResult, correctionError, deleteDraftPermission, emptyCorrection, readableFiscalMessage, requestCorrectionPermission, resolveCorrectionError } from './viagemFiscal';
import { dockStepVisible, visibleSteps } from './viagemWork';

const readiness = (planningActions: ManifestReadiness['planningActions']): ManifestReadiness => ({ canOffer: false, canStart: false, currentStep: 'route', steps: {} as never, issues: [], planningActions });
const allow = { allowed: true };
const actions = (patch: Record<string, { allowed: boolean; reason?: string }> = {}) => ({ editPlanning: allow, withdrawOffer: allow, reopen: allow, cancel: allow, delete: allow, requestCorrection: allow, ...patch });

describe('mensagens fiscais legíveis', () => {
    it('mantém o texto em português do provedor', () => {
        const text = 'Valor do frete informado é menor do que o valor mínimo.';
        expect(readableFiscalMessage(text, 'x')).toEqual({ message: text, technical: null });
    });
    it('troca erro de rede e HTTP por explicação e guarda o original', () => {
        expect(readableFiscalMessage('timeout of 15000ms exceeded', 'x').message).toMatch(/demorou demais/);
        expect(readableFiscalMessage('Request failed with status code 502', 'x')).toMatchObject({ message: expect.stringMatching(/instável/), technical: 'Request failed with status code 502' });
        expect(readableFiscalMessage('connect ECONNREFUSED 10.0.0.1:443', 'x').message).toMatch(/conexão/);
        expect(readableFiscalMessage('Request failed with status code 401', 'x').message).toMatch(/credenciais/);
    });
    it('usa o fallback para JSON/pilha sem regra e para vazio', () => {
        expect(readableFiscalMessage('{"a":1}', 'Falhou.')).toMatchObject({ message: 'Falhou.', technical: '{"a":1}' });
        expect(readableFiscalMessage('TypeError: x is not a function', 'Falhou.').message).toBe('Falhou.');
        expect(readableFiscalMessage(null, 'Falhou.')).toEqual({ message: 'Falhou.', technical: null });
    });
});

describe('cancelar CIOT', () => {
    it('avisa quando o MDF-e precisa ser cancelado na SEFAZ', () => {
        expect(cancelCiotResult({ data: { mdfeRequiresManualCancellation: { id: 'm', accessKey: '35260' } } })).toEqual({ mdfeManual: true, accessKey: '35260', message: 'CIOT cancelado. O MDF-e vinculado precisa ser cancelado manualmente na SEFAZ.' });
        expect(cancelCiotResult({ mdfeRequiresManualCancellation: { id: 'm', accessKey: null } }).mdfeManual).toBe(true);
        expect(cancelCiotResult({ data: { mdfeRequiresManualCancellation: null } })).toMatchObject({ mdfeManual: false, message: 'CIOT cancelado.' });
        expect(cancelCiotResult(undefined).mdfeManual).toBe(false);
    });
});

describe('rascunho vazio e correções', () => {
    const empty = { status: 'DRAFT' as const, creationAuditComplete: true, firstOfferedAt: null, demands: [], fiscalDocuments: [], freightAgreement: null };
    it('a prontidão do servidor decide; sem ela vale a regra local', () => {
        expect(deleteDraftPermission(empty, null).allowed).toBe(true);
        expect(deleteDraftPermission({ ...empty, demands: [{ id: 'd' } as never] }, null).allowed).toBe(false);
        expect(deleteDraftPermission(empty, readiness(actions({ delete: { allowed: false, reason: 'Já teve oferta.' } })))).toEqual({ allowed: false, reason: 'Já teve oferta.' });
        expect(deleteDraftPermission({ ...empty, status: 'ACCEPTED' as never }, null).allowed).toBe(false);
    });
    it('valida a correção na mesma ordem da gestão clássica e monta o corpo', () => {
        const draft = { ...emptyCorrection(), reason: 'curto' };
        expect(correctionError(draft)).toMatch(/ao menos 8/);
        expect(correctionError({ ...draft, reason: 'motivo longo', description: 'x', kind: 'STOP' })).toBe('Selecione a parada a corrigir.');
        expect(correctionError({ ...draft, reason: 'motivo longo', description: 'x' })).toMatch(/código IBGE/);
        const ok = { kind: 'STOP' as const, reason: ' motivo longo ', description: ' trocar ', stopId: 's1', city: { city: 'Pedreiras', state: 'MA', ibgeCode: '2106102' } };
        expect(correctionError(ok)).toBeNull();
        expect(buildCorrectionBody(ok)).toEqual({ kind: 'STOP', reason: 'motivo longo', after: { description: 'trocar', stopId: 's1', city: 'Pedreiras', state: 'MA', cityIbgeCode: '2106102' } });
        expect(correctionError({ ...ok, kind: 'DRIVER', city: null, stopId: '' })).toBeNull();
        expect(resolveCorrectionError('curto')).toMatch(/8 caracteres/);
        expect(resolveCorrectionError('conclusão ok')).toBeNull();
    });
    it('pedir correção só na estrada', () => {
        expect(requestCorrectionPermission({ status: 'IN_PROGRESS' }, null).allowed).toBe(true);
        expect(requestCorrectionPermission({ status: 'ACCEPTED' }, null).allowed).toBe(false);
        expect(requestCorrectionPermission({ status: 'IN_PROGRESS' }, readiness(actions({ requestCorrection: { allowed: false, reason: 'Sem acesso.' } })))).toEqual({ allowed: false, reason: 'Sem acesso.' });
    });
});

describe('etapa Chegada e entrega', () => {
    it('só aparece com a viagem na estrada ou concluída', () => {
        expect(dockStepVisible('IN_PROGRESS')).toBe(true);
        expect(dockStepVisible('COMPLETED')).toBe(true);
        expect(dockStepVisible('ACCEPTED')).toBe(false);
        expect(visibleSteps('ACCEPTED').some((step) => step.id === 'doca')).toBe(false);
        expect(visibleSteps('IN_PROGRESS').at(-1)).toEqual({ id: 'doca', label: 'Chegada e entrega' });
    });
});
