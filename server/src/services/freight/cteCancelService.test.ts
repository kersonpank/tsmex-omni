import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    cancelBlockReason,
    reconcileCteCancel,
    requestCteCancel,
    requestCteCorrection,
    validateCancelReason,
    validateCorrecoes,
    type CancelEligibilityInput,
    type CteCancelDeps,
} from './cteCancelService.js';
import type { CteEventOutcome } from '../acbr/acbrCteCancel.js';

const KEY = '4'.repeat(44);
const NOW = new Date('2026-11-12T12:00:00Z');
const REASON = 'Tomador informado errado na emissao';

const ok: CancelEligibilityInput = {
    documentType: 'CTE', status: 'CTE_AUTHORIZED', authorizedAt: new Date('2026-11-10T12:00:00Z'), now: NOW,
    hasProviderDocId: true, hasAccessKey: true, activeInvoice: false, circulationBlock: null,
};

describe('cancelBlockReason', () => {
    it('libera CT-e autorizado, no prazo, sem fatura e sem circulacao', () => {
        assert.equal(cancelBlockReason(ok), null);
    });
    it('bloqueia fora do prazo de 7 dias (168 h)', () => {
        assert.match(cancelBlockReason({ ...ok, authorizedAt: new Date('2026-11-05T11:59:00Z') })!, /prazo de 7 dias/);
        assert.equal(cancelBlockReason({ ...ok, authorizedAt: new Date('2026-11-05T12:01:00Z') }), null);
    });
    it('bloqueia com fatura ativa, circulacao, sem id do provedor e fora do status', () => {
        assert.match(cancelBlockReason({ ...ok, activeInvoice: true })!, /fatura/);
        assert.equal(cancelBlockReason({ ...ok, circulationBlock: 'ja saiu' }), 'ja saiu');
        assert.match(cancelBlockReason({ ...ok, hasProviderDocId: false })!, /provedor/);
        assert.match(cancelBlockReason({ ...ok, status: 'CTE_REJECTED' })!, /autorizado/);
        assert.match(cancelBlockReason({ ...ok, status: 'CTE_CANCEL_PENDING' })!, /em andamento/);
        assert.match(cancelBlockReason({ ...ok, status: 'CTE_CANCELLED' })!, /já está cancelado/);
        assert.match(cancelBlockReason({ ...ok, authorizedAt: null })!, /data de autorização/);
    });
});

describe('validacoes', () => {
    it('justificativa de 15 a 255 caracteres', () => {
        assert.throws(() => validateCancelReason('curto'), /15 a 255/);
        assert.throws(() => validateCancelReason('x'.repeat(256)), /15 a 255/);
        assert.equal(validateCancelReason(`  ${REASON}  `), REASON);
    });
    it('carta de correcao: formato do contrato e campos proibidos por lei', () => {
        assert.deepEqual(validateCorrecoes([{ grupo: 'infCarga', campo: 'proPred', valor: 'Cosmeticos', item: 2 }]), [
            { grupo_alterado: 'infCarga', campo_alterado: 'proPred', valor_alterado: 'Cosmeticos', numero_item_alterado: 2 },
        ]);
        assert.throws(() => validateCorrecoes([{ grupo: 'vPrest', campo: 'vTPrest', valor: '10' }]), /não pode ser corrigido/);
        assert.throws(() => validateCorrecoes([{ grupo: 'toma3', campo: 'toma', valor: '1' }]), /tomador/);
        assert.throws(() => validateCorrecoes([{ grupo: 'ide', campo: 'dhEmi', valor: '2026' }]), /data de emissão/);
        assert.throws(() => validateCorrecoes([]), /ao menos uma/);
        assert.throws(() => validateCorrecoes([{ grupo: 'ide', campo: 'x', valor: '' }]), /novo valor/);
    });
});

type Calc = Record<string, unknown>;
function makeDeps(opts: {
    calc?: Partial<Calc>; legs?: unknown[]; mdfe?: unknown[]; invoice?: boolean; providerDocId?: string | null;
    cancel?: CteEventOutcome; consult?: CteEventOutcome; cce?: CteEventOutcome; consultCce?: CteEventOutcome; cancelXml?: string | Error;
}) {
    const calc: Calc = {
        id: 'c1', orderId: 'o1', documentType: 'CTE', status: 'CTE_AUTHORIZED', cteAccessKey: KEY, cteNumber: '55',
        cteAuthorizedAt: new Date('2026-11-10T12:00:00Z'), cteEnvironment: 'homologacao', fiscalEmitter: null,
        cteCancelXmlStorageKey: null, cteCancelRequestedAt: null, cteCorrections: null, updatedAt: new Date('2026-11-10T12:00:00Z'),
        ...opts.calc,
    };
    const history: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const prisma: any = {
        orderFreightCalculation: {
            findFirst: async () => ({ ...calc }),
            findUniqueOrThrow: async () => ({ ...calc }),
            update: async ({ data }: any) => { Object.assign(calc, data); return { ...calc }; },
            updateMany: async ({ where, data }: any) => {
                if (where.status && calc.status !== where.status) return { count: 0 };
                if (where.updatedAt && (where.updatedAt as Date).getTime() !== (calc.updatedAt as Date).getTime()) return { count: 0 };
                Object.assign(calc, data);
                return { count: 1 };
            },
        },
        cteEmissionJob: { findFirst: async () => (opts.providerDocId === null ? null : { providerDocId: opts.providerDocId ?? 'prov-1' }) },
        invoice: { findFirst: async () => (opts.invoice ? { id: 'i' } : null) },
        invoiceItem: { findFirst: async () => null },
        orderLeg: { findMany: async () => opts.legs ?? [] },
        manifestFiscalDocument: { findMany: async () => opts.mdfe ?? [] },
        orderHistory: { create: async ({ data }: any) => { history.push(data); return data; } },
        $transaction: async (fn: any) => fn(prisma),
    };
    const deps: CteCancelDeps = {
        prisma,
        cancelCteViaAcbr: async (i) => { calls.push(`cancel:${i.providerDocId}:${i.justificativa}`); return opts.cancel ?? { kind: 'REGISTERED', protocol: 'P1', rawResponse: {} }; },
        consultCteCancelViaAcbr: async () => { calls.push('consult'); return opts.consult ?? { kind: 'PENDING' }; },
        createCteCartaCorrecaoViaAcbr: async () => { calls.push('cce'); return opts.cce ?? { kind: 'REGISTERED', protocol: 'C1', rawResponse: {} }; },
        consultCteCartaCorrecaoViaAcbr: async () => { calls.push('consultCce'); return opts.consultCce ?? { kind: 'PENDING' }; },
        downloadCteCancelXml: async () => { if (opts.cancelXml instanceof Error) throw opts.cancelXml; return opts.cancelXml ?? '<evento/>'; },
        uploadBase64Object: (async () => ({ storageKey: 'cte/c1/cancelamento/x.xml' })) as never,
        now: () => NOW,
    };
    return { deps, calc, history, calls };
}
const actor = { id: 'u1' };
const input = { orderId: 'o1', calcId: 'c1', reason: REASON, actor };

describe('requestCteCancel', () => {
    it('evento registrado: CTE_CANCELLED com protocolo, motivo, solicitante, xml e historico', async () => {
        const t = makeDeps({});
        const r = await requestCteCancel(input, t.deps);
        assert.equal(r.state, 'CANCELLED');
        assert.equal(t.calc.status, 'CTE_CANCELLED');
        assert.equal(t.calc.cteCancelProtocol, 'P1');
        assert.equal(t.calc.cteCancelReason, REASON);
        assert.equal(t.calc.cteCancelRequestedByUserId, 'u1');
        assert.equal(t.calc.cteCancelXmlStorageKey, 'cte/c1/cancelamento/x.xml');
        assert.deepEqual(t.calls, [`cancel:prov-1:${REASON}`]);
        assert.equal(t.history.length, 2);
        assert.ok(t.history.every((h) => h.actorUserId === 'u1'));
        assert.match(String(t.history[0].description), /Motivo: Tomador/);
    });
    it('falha ao arquivar o XML nao desfaz o cancelamento confirmado', async () => {
        const t = makeDeps({ cancelXml: new Error('s3 fora') });
        const r = await requestCteCancel(input, t.deps);
        assert.equal(r.state, 'CANCELLED');
        assert.equal(t.calc.status, 'CTE_CANCELLED');
        assert.equal(t.calc.cteCancelXmlStorageKey, null);
    });
    it('rejeicao volta para CTE_AUTHORIZED com o motivo', async () => {
        const t = makeDeps({ cancel: { kind: 'REJECTED', reason: 'Rejeicao 218: ja cancelado', code: '218' } });
        const r = await requestCteCancel(input, t.deps);
        assert.equal(r.state, 'REJECTED');
        assert.equal(t.calc.status, 'CTE_AUTHORIZED');
        assert.match(String(t.calc.cteStatusReason), /218/);
    });
    it('resultado incerto fica CTE_CANCEL_PENDING e nao reenvia', async () => {
        const t = makeDeps({ cancel: { kind: 'UNCERTAIN', reason: 'timeout' } });
        const r = await requestCteCancel(input, t.deps);
        assert.equal(r.state, 'PENDING');
        assert.equal(t.calc.status, 'CTE_CANCEL_PENDING');
        assert.equal(t.calls.length, 1);
        await assert.rejects(requestCteCancel(input, t.deps), /em andamento/);
        assert.equal(t.calls.length, 1, 'segunda tentativa nao chama o provedor');
    });
    it('NOT_SENT (cota) volta a autorizado', async () => {
        const t = makeDeps({ cancel: { kind: 'NOT_SENT', reason: 'sem credito' } });
        assert.equal((await requestCteCancel(input, t.deps)).state, 'NOT_SENT');
        assert.equal(t.calc.status, 'CTE_AUTHORIZED');
    });
    it('bloqueia sem chamar o provedor: viagem, MDF-e com a chave, MDF-e sem prova, fatura, prazo, justificativa', async () => {
        const trip = makeDeps({ legs: [{ manifestId: 'm1', startedAt: null, completedAt: null, manifest: { status: 'IN_PROGRESS' } }] });
        await assert.rejects(requestCteCancel(input, trip.deps), /saiu em viagem/);
        const mdfe = makeDeps({
            legs: [{ manifestId: 'm1', startedAt: null, completedAt: null, manifest: { status: 'ACCEPTED' } }],
            mdfe: [{ number: '9', status: 'AUTHORIZED', rawPayload: { infMunDescarga: [{ infCTe: [{ chCTe: KEY }] }] } }],
        });
        await assert.rejects(requestCteCancel(input, mdfe.deps), /MDF-e nº 9/);
        const noProof = makeDeps({
            legs: [{ manifestId: 'm1', startedAt: null, completedAt: null, manifest: { status: 'ACCEPTED' } }],
            mdfe: [{ number: null, status: 'SENT', rawPayload: { referencia: 'x' } }],
        });
        await assert.rejects(requestCteCancel(input, noProof.deps), /MDF-e/);
        const other = makeDeps({
            legs: [{ manifestId: 'm1', startedAt: null, completedAt: null, manifest: { status: 'ACCEPTED' } }],
            mdfe: [{ number: '9', status: 'AUTHORIZED', rawPayload: { infMunDescarga: [{ infCTe: [{ chCTe: '1'.repeat(44) }] }] } }],
        });
        assert.equal((await requestCteCancel(input, other.deps)).state, 'CANCELLED');
        const inv = makeDeps({ invoice: true });
        await assert.rejects(requestCteCancel(input, inv.deps), /fatura/);
        const late = makeDeps({ calc: { cteAuthorizedAt: new Date('2026-11-01T00:00:00Z') } });
        await assert.rejects(requestCteCancel(input, late.deps), /prazo/);
        await assert.rejects(requestCteCancel({ ...input, reason: 'curto' }, trip.deps), /15 a 255/);
        for (const t of [trip, mdfe, noProof, inv, late]) assert.equal(t.calls.length, 0);
        assert.equal(trip.calc.status, 'CTE_AUTHORIZED');
    });
    it('compare-and-swap: duas chamadas simultaneas enviam uma unica vez', async () => {
        const t = makeDeps({ cancel: { kind: 'UNCERTAIN', reason: 'x' } });
        const results = await Promise.allSettled([requestCteCancel(input, t.deps), requestCteCancel(input, t.deps)]);
        assert.equal(t.calls.filter((c) => c.startsWith('cancel')).length, 1);
        assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
    });
});

describe('reconcileCteCancel', () => {
    const pending = { status: 'CTE_CANCEL_PENDING', cteCancelRequestedAt: new Date('2026-11-12T11:55:00Z') };
    it('consulta (GET) e confirma quando o evento esta registrado', async () => {
        const t = makeDeps({ calc: pending, consult: { kind: 'REGISTERED', protocol: 'P9', rawResponse: {} } });
        assert.equal((await reconcileCteCancel(input, t.deps)).state, 'CANCELLED');
        assert.equal(t.calc.status, 'CTE_CANCELLED');
        assert.deepEqual(t.calls, ['consult']);
    });
    it('ainda pendente continua pendente; rejeitado volta a autorizado', async () => {
        const a = makeDeps({ calc: pending, consult: { kind: 'PENDING' } });
        assert.equal((await reconcileCteCancel(input, a.deps)).state, 'PENDING');
        assert.equal(a.calc.status, 'CTE_CANCEL_PENDING');
        const b = makeDeps({ calc: pending, consult: { kind: 'REJECTED', reason: 'nao pode' } });
        assert.equal((await reconcileCteCancel(input, b.deps)).state, 'REJECTED');
        assert.equal(b.calc.status, 'CTE_AUTHORIZED');
    });
    it('sem rastro no provedor: espera 30 min antes de liberar novo pedido', async () => {
        const recent = makeDeps({ calc: pending, consult: { kind: 'NOT_FOUND' } });
        assert.equal((await reconcileCteCancel(input, recent.deps)).state, 'PENDING');
        assert.equal(recent.calc.status, 'CTE_CANCEL_PENDING');
        const old = makeDeps({ calc: { ...pending, cteCancelRequestedAt: new Date('2026-11-12T10:00:00Z') }, consult: { kind: 'NOT_FOUND' } });
        assert.equal((await reconcileCteCancel(input, old.deps)).state, 'REJECTED');
        assert.equal(old.calc.status, 'CTE_AUTHORIZED');
    });
    it('recusa quando nao ha cancelamento em andamento', async () => {
        await assert.rejects(reconcileCteCancel(input, makeDeps({}).deps), /Não há cancelamento em andamento/);
    });
});

describe('requestCteCorrection', () => {
    const correcoes = [{ grupo: 'infCarga', campo: 'proPred', valor: 'Cosmeticos' }];
    it('registra a CC-e na lista do calculo', async () => {
        const t = makeDeps({});
        const r = await requestCteCorrection({ orderId: 'o1', calcId: 'c1', correcoes, actor }, t.deps);
        assert.equal(r.record.status, 'registrada');
        const list = t.calc.cteCorrections as Array<Record<string, unknown>>;
        assert.equal(list.length, 1);
        assert.equal(list[0].protocol, 'C1');
        assert.equal(t.calc.status, 'CTE_AUTHORIZED');
    });
    it('resultado incerto fica pendente e bloqueia nova carta', async () => {
        const t = makeDeps({ cce: { kind: 'UNCERTAIN', reason: 'timeout' } });
        const r = await requestCteCorrection({ orderId: 'o1', calcId: 'c1', correcoes, actor }, t.deps);
        assert.equal(r.record.status, 'pendente');
        await assert.rejects(requestCteCorrection({ orderId: 'o1', calcId: 'c1', correcoes, actor }, t.deps), /em andamento/);
    });
    it('so CT-e autorizado e campos permitidos', async () => {
        await assert.rejects(requestCteCorrection({ orderId: 'o1', calcId: 'c1', correcoes, actor }, makeDeps({ calc: { status: 'CTE_CANCELLED' } }).deps), /autorizado/);
        await assert.rejects(requestCteCorrection({ orderId: 'o1', calcId: 'c1', correcoes: [{ grupo: 'vPrest', campo: 'vTPrest', valor: '1' }], actor }, makeDeps({}).deps), /carta/);
    });
});
