import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import {
    cancelCteViaAcbr,
    consultCteCancelViaAcbr,
    consultCteCartaCorrecaoViaAcbr,
    createCteCartaCorrecaoViaAcbr,
    downloadCteCancelXml,
    type CteCorrecaoItem,
    type CteEventOutcome,
} from '../acbr/acbrCteCancel.js';
import type { AcbrFiscalEnvironment } from '../acbr/acbrConfig.js';

/** Prazo legal para cancelar CT-e: 7 dias (168 h) da autorização. */
export const CTE_CANCEL_DEADLINE_HOURS = 168;
export const CTE_CANCEL_REASON_MIN = 15;
export const CTE_CANCEL_REASON_MAX = 255;
/** Sem rastro do evento no provedor depois disto, o pedido é considerado não recebido e o CT-e volta a autorizado. */
export const CTE_CANCEL_NOT_FOUND_GRACE_MINUTES = 30;

const HOUR_MS = 3_600_000;

export function validateCancelReason(raw: unknown): string {
    const reason = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (reason.length < CTE_CANCEL_REASON_MIN || reason.length > CTE_CANCEL_REASON_MAX) {
        throw new AppError(`Explique o motivo do cancelamento com ${CTE_CANCEL_REASON_MIN} a ${CTE_CANCEL_REASON_MAX} caracteres.`, 400);
    }
    return reason;
}

/** Quando o prazo de 7 dias acaba (null se a autorização não foi registrada). */
export function cancelDeadline(authorizedAt: Date | null): Date | null {
    return authorizedAt ? new Date(authorizedAt.getTime() + CTE_CANCEL_DEADLINE_HOURS * HOUR_MS) : null;
}

export interface CancelEligibilityInput {
    documentType: string;
    status: string;
    authorizedAt: Date | null;
    now: Date;
    hasProviderDocId: boolean;
    hasAccessKey: boolean;
    activeInvoice: boolean;
    circulationBlock: string | null;
}

/** Devolve a razão (em português simples) pela qual o CT-e NÃO pode ser cancelado agora; null = pode. */
export function cancelBlockReason(i: CancelEligibilityInput): string | null {
    if (i.documentType !== 'CTE') return 'Só CT-e autorizado pode ser cancelado por aqui.';
    if (i.status === 'CTE_CANCEL_PENDING') return 'O cancelamento deste CT-e já foi pedido e está em andamento. Use “Consultar”.';
    if (i.status === 'CTE_CANCELLED') return 'Este CT-e já está cancelado.';
    if (i.status !== 'CTE_AUTHORIZED') return 'Só um CT-e autorizado pode ser cancelado.';
    if (!i.hasAccessKey) return 'O CT-e não tem chave de acesso registrada. Fale com a torre.';
    if (!i.hasProviderDocId) return 'Não achamos o registro deste CT-e no provedor fiscal. Fale com a torre antes de cancelar.';
    const deadline = cancelDeadline(i.authorizedAt);
    if (!deadline) return 'Não há data de autorização registrada para conferir o prazo de 7 dias. Fale com a torre.';
    if (i.now.getTime() > deadline.getTime()) return 'Passou o prazo de 7 dias para cancelar este CT-e.';
    if (i.activeInvoice) return 'O pedido já está em uma fatura. Cancele a fatura antes de cancelar o CT-e.';
    if (i.circulationBlock) return i.circulationBlock;
    return null;
}

// ---------------------------------------------------------------------------------------------
// Persistência (injetável para teste)
// ---------------------------------------------------------------------------------------------

type CalcRow = Awaited<ReturnType<typeof prisma.orderFreightCalculation.findFirst>>;

export interface CteCancelDeps {
    prisma: Pick<typeof prisma, '$transaction' | 'orderFreightCalculation' | 'orderHistory' | 'cteEmissionJob' | 'invoice' | 'invoiceItem' | 'orderLeg' | 'manifestFiscalDocument'>;
    cancelCteViaAcbr: typeof cancelCteViaAcbr;
    consultCteCancelViaAcbr: typeof consultCteCancelViaAcbr;
    createCteCartaCorrecaoViaAcbr: typeof createCteCartaCorrecaoViaAcbr;
    consultCteCartaCorrecaoViaAcbr: typeof consultCteCartaCorrecaoViaAcbr;
    downloadCteCancelXml: typeof downloadCteCancelXml;
    uploadBase64Object: typeof uploadBase64Object;
    now: () => Date;
}

export const defaultCteCancelDeps: CteCancelDeps = {
    prisma,
    cancelCteViaAcbr,
    consultCteCancelViaAcbr,
    createCteCartaCorrecaoViaAcbr,
    consultCteCartaCorrecaoViaAcbr,
    downloadCteCancelXml,
    uploadBase64Object,
    now: () => new Date(),
};

type Actor = { id: string };

/**
 * "Já circulou?" — o CT-e não pode ser cancelado depois que a carga andou. Duas provas independentes, ambas
 * conservadoras (na dúvida, bloqueia):
 *  1. Viagem: alguma perna do pedido em manifesto IN_PROGRESS/COMPLETED, ou perna com início/fim registrado.
 *  2. MDF-e: manifesto da perna com MDF-e SENT/AUTHORIZED/CLOSED cujo payload enviado (`rawPayload`, infCTe[].chCTe)
 *     contém a chave deste CT-e — ou que não dá para provar que NÃO contém (payload ausente/sem infCTe).
 */
export async function findCirculationBlock(db: CteCancelDeps['prisma'], orderId: string, accessKey: string): Promise<string | null> {
    const legs = await db.orderLeg.findMany({
        where: { orderId },
        select: { manifestId: true, startedAt: true, completedAt: true, manifest: { select: { status: true } } },
    });
    const traveled = legs.find((l) => l.startedAt || l.completedAt || l.manifest?.status === 'IN_PROGRESS' || l.manifest?.status === 'COMPLETED');
    if (traveled) return 'A carga deste pedido já saiu em viagem. CT-e de carga que já circulou não pode mais ser cancelado.';
    const manifestIds = [...new Set(legs.map((l) => l.manifestId))];
    if (manifestIds.length === 0) return null;
    const docs = await db.manifestFiscalDocument.findMany({
        where: { manifestId: { in: manifestIds }, documentType: 'MDFE', status: { in: ['SENT', 'AUTHORIZED', 'CLOSED'] } },
        select: { number: true, status: true, rawPayload: true },
    });
    for (const doc of docs) {
        const text = JSON.stringify(doc.rawPayload ?? null);
        if (text.includes(accessKey) || !text.includes('infCTe')) {
            return `Este CT-e está em um MDF-e${doc.number ? ` nº ${doc.number}` : ''} já enviado ou autorizado. Cancele ou encerre o MDF-e antes.`;
        }
    }
    return null;
}

async function loadCalc(deps: CteCancelDeps, orderId: string, calcId: string) {
    const calc = await deps.prisma.orderFreightCalculation.findFirst({
        where: { id: calcId, orderId },
        include: { fiscalEmitter: { select: { environment: true } } },
    });
    if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);
    const job = await deps.prisma.cteEmissionJob.findFirst({
        where: { calcId, providerDocId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { providerDocId: true },
    });
    const ambiente = String(calc.cteEnvironment ?? calc.fiscalEmitter?.environment ?? 'HOMOLOGACAO').toUpperCase() === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
    return { calc, providerDocId: job?.providerDocId ?? null, ambiente: ambiente as AcbrFiscalEnvironment };
}

async function hasActiveInvoice(db: CteCancelDeps['prisma'], orderId: string): Promise<boolean> {
    const [direct, viaItem] = await Promise.all([
        db.invoice.findFirst({ where: { orderId, status: { not: 'CANCELLED' } }, select: { id: true } }),
        db.invoiceItem.findFirst({ where: { orderId, invoice: { status: { not: 'CANCELLED' } } }, select: { id: true } }),
    ]);
    return Boolean(direct || viaItem);
}

type Transition = { from: 'CTE_AUTHORIZED' | 'CTE_CANCEL_PENDING'; data: Prisma.OrderFreightCalculationUncheckedUpdateManyInput; history: string };

/** Compare-and-swap por status + histórico na mesma transação. */
async function transition(deps: CteCancelDeps, calcId: string, orderId: string, actor: Actor | null, t: Transition): Promise<boolean> {
    return deps.prisma.$transaction(async (tx) => {
        const res = await tx.orderFreightCalculation.updateMany({ where: { id: calcId, status: t.from }, data: t.data });
        if (res.count !== 1) return false;
        await tx.orderHistory.create({ data: { orderId, eventType: 'NOTE', actorUserId: actor?.id ?? null, description: t.history } });
        return true;
    });
}

export interface CancelResult {
    state: 'CANCELLED' | 'PENDING' | 'REJECTED' | 'NOT_SENT';
    message: string;
}

async function archiveCancelXml(deps: CteCancelDeps, calcId: string, providerDocId: string, ambiente: AcbrFiscalEnvironment): Promise<boolean> {
    try {
        const xml = await deps.downloadCteCancelXml(providerDocId, ambiente);
        if (!xml.trim()) return false;
        const uploaded = await deps.uploadBase64Object({
            base64: Buffer.from(xml, 'utf8').toString('base64'), fileName: `${calcId}-cancelamento.xml`,
            mimeType: 'application/xml', keyPrefix: `cte/${calcId}/cancelamento`,
        });
        await deps.prisma.orderFreightCalculation.updateMany({ where: { id: calcId, status: 'CTE_CANCELLED' }, data: { cteCancelXmlStorageKey: uploaded.storageKey } });
        return true;
    } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', source: 'cteCancel', calcId, message: 'Falha ao arquivar XML do evento de cancelamento', error: error instanceof Error ? error.message : String(error) }));
        return false;
    }
}

async function applyOutcome(
    deps: CteCancelDeps,
    ctx: { calcId: string; orderId: string; actor: Actor | null; providerDocId: string; ambiente: AcbrFiscalEnvironment; requestedAt: Date | null },
    outcome: CteEventOutcome,
): Promise<CancelResult> {
    const { calcId, orderId, actor } = ctx;
    if (outcome.kind === 'REGISTERED') {
        const ok = await transition(deps, calcId, orderId, actor, {
            from: 'CTE_CANCEL_PENDING',
            data: { status: 'CTE_CANCELLED', cteCancelledAt: deps.now(), cteCancelProtocol: outcome.protocol, cteStatusReason: null },
            history: `CT-e cancelado (evento registrado, protocolo ${outcome.protocol}).`,
        });
        if (!ok) return { state: 'PENDING', message: 'O estado do CT-e mudou durante a operação. Recarregue o pedido.' };
        await archiveCancelXml(deps, calcId, ctx.providerDocId, ctx.ambiente);
        return { state: 'CANCELLED', message: 'CT-e cancelado. Já dá para preparar e emitir outro documento.' };
    }
    if (outcome.kind === 'REJECTED' || outcome.kind === 'NOT_SENT') {
        const why = outcome.reason;
        await transition(deps, calcId, orderId, actor, {
            from: 'CTE_CANCEL_PENDING',
            data: { status: 'CTE_AUTHORIZED', cteStatusReason: `Cancelamento não aceito: ${why}`.slice(0, 1000) },
            history: `Cancelamento do CT-e não aceito pelo provedor: ${why}`,
        });
        return { state: outcome.kind, message: outcome.kind === 'REJECTED' ? `O provedor não aceitou o cancelamento: ${why}` : why };
    }
    if (outcome.kind === 'NOT_FOUND') {
        const age = ctx.requestedAt ? deps.now().getTime() - ctx.requestedAt.getTime() : 0;
        if (age >= CTE_CANCEL_NOT_FOUND_GRACE_MINUTES * 60_000) {
            await transition(deps, calcId, orderId, actor, {
                from: 'CTE_CANCEL_PENDING',
                data: { status: 'CTE_AUTHORIZED', cteStatusReason: 'Cancelamento não encontrado no provedor: o pedido não chegou a ser registrado. Pode pedir de novo.' },
                history: 'Cancelamento do CT-e sem rastro no provedor após a espera; CT-e segue autorizado.',
            });
            return { state: 'REJECTED', message: 'O provedor não tem registro do cancelamento. O CT-e segue autorizado e você pode pedir de novo.' };
        }
        return { state: 'PENDING', message: 'O provedor ainda não mostra o cancelamento. Consulte de novo em alguns minutos.' };
    }
    const why = outcome.reason;
    await deps.prisma.orderFreightCalculation.updateMany({
        where: { id: calcId, status: 'CTE_CANCEL_PENDING' },
        data: { cteStatusReason: `Cancelamento em andamento${why ? `: ${why}` : ''}`.slice(0, 1000) },
    });
    return { state: 'PENDING', message: 'Cancelamento em andamento: o provedor ainda não confirmou. Use “Consultar” em alguns minutos.' };
}

/** Pede o cancelamento. Uma única chamada ao provedor; se o resultado for incerto, fica pendente e é conciliado por consulta. */
export async function requestCteCancel(
    input: { orderId: string; calcId: string; reason: unknown; actor: Actor },
    deps: CteCancelDeps = defaultCteCancelDeps,
): Promise<CancelResult> {
    const reason = validateCancelReason(input.reason);
    const { calc, providerDocId, ambiente } = await loadCalc(deps, input.orderId, input.calcId);
    const accessKey = calc.cteAccessKey ?? '';
    const [activeInvoice, circulationBlock] = await Promise.all([
        hasActiveInvoice(deps.prisma, input.orderId),
        accessKey ? findCirculationBlock(deps.prisma, input.orderId, accessKey) : Promise.resolve(null),
    ]);
    const block = cancelBlockReason({
        documentType: calc.documentType, status: calc.status, authorizedAt: calc.cteAuthorizedAt, now: deps.now(),
        hasProviderDocId: Boolean(providerDocId), hasAccessKey: /^\d{44}$/.test(accessKey), activeInvoice, circulationBlock,
    });
    if (block) throw new AppError(block, 409);

    const requestedAt = deps.now();
    const claimed = await transition(deps, calc.id, input.orderId, input.actor, {
        from: 'CTE_AUTHORIZED',
        data: { status: 'CTE_CANCEL_PENDING', cteCancelReason: reason, cteCancelRequestedAt: requestedAt, cteCancelRequestedByUserId: input.actor.id, cteStatusReason: null },
        history: `Cancelamento do CT-e${calc.cteNumber ? ` nº ${calc.cteNumber}` : ''} pedido. Motivo: ${reason}`,
    });
    if (!claimed) throw new AppError('O CT-e mudou de estado enquanto você pedia o cancelamento. Recarregue o pedido.', 409);

    const outcome = await deps.cancelCteViaAcbr({ providerDocId: providerDocId!, ambiente, justificativa: reason, accessKey });
    return applyOutcome(deps, { calcId: calc.id, orderId: input.orderId, actor: input.actor, providerDocId: providerDocId!, ambiente, requestedAt }, outcome);
}

/** Consulta o evento pendente no provedor (GET). Nunca reenvia o pedido. */
export async function reconcileCteCancel(
    input: { orderId: string; calcId: string; actor: Actor },
    deps: CteCancelDeps = defaultCteCancelDeps,
): Promise<CancelResult> {
    const { calc, providerDocId, ambiente } = await loadCalc(deps, input.orderId, input.calcId);
    if (calc.status === 'CTE_CANCELLED') {
        if (!calc.cteCancelXmlStorageKey && providerDocId) await archiveCancelXml(deps, calc.id, providerDocId, ambiente);
        return { state: 'CANCELLED', message: 'CT-e já cancelado.' };
    }
    if (calc.status !== 'CTE_CANCEL_PENDING') throw new AppError('Não há cancelamento em andamento neste CT-e.', 409);
    if (!providerDocId) throw new AppError('Não achamos o registro deste CT-e no provedor fiscal. Fale com a torre.', 409);
    const outcome = await deps.consultCteCancelViaAcbr({ providerDocId, ambiente, accessKey: calc.cteAccessKey });
    return applyOutcome(deps, { calcId: calc.id, orderId: input.orderId, actor: input.actor, providerDocId, ambiente, requestedAt: calc.cteCancelRequestedAt }, outcome);
}

// ---------------------------------------------------------------------------------------------
// Carta de correção (CC-e, evento 110110)
// ---------------------------------------------------------------------------------------------

/**
 * Grupos/campos que a lei NÃO deixa corrigir por carta de correção: valores do serviço e dos tributos, base de cálculo,
 * alíquota, tomador, remetente, destinatário e data de emissão (Ajuste SINIEF 09/2007, cláusula 26ª-A, ou MOC CT-e).
 * Se algo disso estiver errado, cancele o CT-e (até 7 dias, antes da carga sair) e emita outro.
 */
const FORBIDDEN_GROUPS = new Set(['vprest', 'comp', 'imp', 'icms', 'icms00', 'icms20', 'icms45', 'icms60', 'icms90', 'icmsoutrauf', 'icmssn', 'toma3', 'toma4', 'toma', 'rem', 'dest', 'exped', 'receb']);
const FORBIDDEN_FIELDS = new Set([
    'vtprest', 'vrec', 'vcomp', 'vbc', 'picms', 'vicms', 'vbcstret', 'vicmsstret', 'vtottrib', 'cst',
    'dhemi', 'dhemis', 'tomador',
]);

export const CCE_LEGAL_NOTICE =
    'A carta de correção não vale para valores do frete e dos impostos, nem para tomador, remetente, destinatário ou data de emissão. Nesses casos, cancele o CT-e (até 7 dias e antes da carga sair) e emita outro.';

export function validateCorrecoes(raw: unknown): CteCorrecaoItem[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new AppError('Informe ao menos uma correção.', 400);
    if (raw.length > 20) throw new AppError('No máximo 20 correções por carta.', 400);
    return raw.map((item, index) => {
        const o = (item ?? {}) as Record<string, unknown>;
        const grupo = String(o.grupo ?? '').trim();
        const campo = String(o.campo ?? '').trim();
        const valor = String(o.valor ?? '').trim();
        const n = index + 1;
        if (!grupo || grupo.length > 20) throw new AppError(`Correção ${n}: informe o grupo (até 20 caracteres).`, 400);
        if (!campo || campo.length > 20) throw new AppError(`Correção ${n}: informe o campo (até 20 caracteres).`, 400);
        if (!valor || valor.length > 500) throw new AppError(`Correção ${n}: informe o novo valor (até 500 caracteres).`, 400);
        if (FORBIDDEN_GROUPS.has(grupo.toLowerCase()) || FORBIDDEN_FIELDS.has(campo.toLowerCase())) {
            throw new AppError(`Correção ${n}: “${grupo}.${campo}” não pode ser corrigido por carta. ${CCE_LEGAL_NOTICE}`, 400);
        }
        let numeroItem: number | null = null;
        if (o.item != null && o.item !== '') {
            numeroItem = Number(o.item);
            if (!Number.isInteger(numeroItem) || numeroItem < 1) throw new AppError(`Correção ${n}: o item começa em 1.`, 400);
        }
        return {
            grupo_alterado: grupo,
            campo_alterado: campo,
            valor_alterado: valor,
            ...(numeroItem != null ? { numero_item_alterado: numeroItem } : {}),
        };
    });
}

export interface CteCorrectionRecord {
    id: string;
    requestedAt: string;
    requestedByUserId: string;
    correcoes: CteCorrecaoItem[];
    status: 'registrada' | 'pendente' | 'rejeitada';
    protocol?: string | null;
    eventId?: string | null;
    reason?: string | null;
}

function correctionsOf(calc: NonNullable<CalcRow>): CteCorrectionRecord[] {
    return Array.isArray(calc.cteCorrections) ? (calc.cteCorrections as unknown as CteCorrectionRecord[]) : [];
}

function recordFromOutcome(base: CteCorrectionRecord, outcome: CteEventOutcome): CteCorrectionRecord {
    if (outcome.kind === 'REGISTERED') return { ...base, status: 'registrada', protocol: outcome.protocol, eventId: outcome.eventId ?? base.eventId ?? null, reason: null };
    if (outcome.kind === 'REJECTED') return { ...base, status: 'rejeitada', reason: outcome.reason };
    const reason = 'reason' in outcome ? outcome.reason ?? null : null;
    return { ...base, status: 'pendente', eventId: ('eventId' in outcome ? outcome.eventId : undefined) ?? base.eventId ?? null, reason };
}

/** Pede uma carta de correção. Só CT-e autorizado; o evento é guardado na lista `cteCorrections` do cálculo. */
export async function requestCteCorrection(
    input: { orderId: string; calcId: string; correcoes: unknown; actor: Actor },
    deps: CteCancelDeps = defaultCteCancelDeps,
): Promise<{ record: CteCorrectionRecord; message: string }> {
    const correcoes = validateCorrecoes(input.correcoes);
    const { calc, providerDocId, ambiente } = await loadCalc(deps, input.orderId, input.calcId);
    if (calc.documentType !== 'CTE' || calc.status !== 'CTE_AUTHORIZED') throw new AppError('Só um CT-e autorizado aceita carta de correção.', 409);
    if (!providerDocId || !/^\d{44}$/.test(calc.cteAccessKey ?? '')) throw new AppError('Não achamos o registro deste CT-e no provedor fiscal. Fale com a torre.', 409);
    const open = correctionsOf(calc).find((c) => c.status === 'pendente');
    if (open) throw new AppError('Já existe uma carta de correção em andamento neste CT-e. Consulte antes de pedir outra.', 409);

    const base: CteCorrectionRecord = {
        id: `cce-${deps.now().getTime()}`, requestedAt: deps.now().toISOString(), requestedByUserId: input.actor.id, correcoes, status: 'pendente',
    };
    const previous = correctionsOf(calc);
    // Compare-and-swap: só grava se a lista não mudou e o CT-e segue autorizado (evita duas cartas simultâneas).
    const claimed = await deps.prisma.$transaction(async (tx) => {
        const res = await tx.orderFreightCalculation.updateMany({
            where: { id: calc.id, status: 'CTE_AUTHORIZED', updatedAt: calc.updatedAt },
            data: { cteCorrections: [...previous, base] as unknown as Prisma.InputJsonValue },
        });
        if (res.count !== 1) return false;
        await tx.orderHistory.create({ data: { orderId: input.orderId, eventType: 'NOTE', actorUserId: input.actor.id, description: `Carta de correção do CT-e pedida (${correcoes.map((c) => `${c.grupo_alterado}.${c.campo_alterado}`).join(', ')}).` } });
        return true;
    });
    if (!claimed) throw new AppError('O CT-e mudou enquanto você pedia a carta. Recarregue o pedido.', 409);

    const outcome = await deps.createCteCartaCorrecaoViaAcbr({ providerDocId, ambiente, accessKey: calc.cteAccessKey, correcoes });
    return finishCorrection(deps, input.orderId, calc.id, input.actor, base, outcome);
}

async function finishCorrection(deps: CteCancelDeps, orderId: string, calcId: string, actor: Actor, base: CteCorrectionRecord, outcome: CteEventOutcome) {
    const record = outcome.kind === 'UNCERTAIN' || outcome.kind === 'NOT_SENT'
        ? { ...base, reason: outcome.reason }
        : outcome.kind === 'NOT_FOUND' ? base : recordFromOutcome(base, outcome);
    // NOT_SENT é seguro de repetir: a carta não foi registrada.
    const finalRecord: CteCorrectionRecord = outcome.kind === 'NOT_SENT' ? { ...record, status: 'rejeitada' } : record;
    const fresh = await deps.prisma.orderFreightCalculation.findUniqueOrThrow({ where: { id: calcId } });
    const list = correctionsOf(fresh).map((c) => (c.id === base.id ? finalRecord : c));
    await deps.prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { cteCorrections: list as unknown as Prisma.InputJsonValue } });
    await deps.prisma.orderHistory.create({
        data: { orderId, eventType: 'NOTE', actorUserId: actor.id, description: `Carta de correção do CT-e: ${finalRecord.status}${finalRecord.protocol ? ` (protocolo ${finalRecord.protocol})` : ''}${finalRecord.reason ? ` — ${finalRecord.reason}` : ''}.` },
    });
    const message = finalRecord.status === 'registrada' ? 'Carta de correção registrada.'
        : finalRecord.status === 'rejeitada' ? `A carta não foi aceita: ${finalRecord.reason ?? 'sem detalhe'}`
            : 'Carta de correção em andamento: o provedor ainda não confirmou. Use “Consultar”.';
    return { record: finalRecord, message };
}

/** Consulta a carta de correção pendente (GET) e atualiza o registro. */
export async function reconcileCteCorrection(
    input: { orderId: string; calcId: string; actor: Actor },
    deps: CteCancelDeps = defaultCteCancelDeps,
) {
    const { calc, providerDocId, ambiente } = await loadCalc(deps, input.orderId, input.calcId);
    const open = correctionsOf(calc).find((c) => c.status === 'pendente');
    if (!open) throw new AppError('Não há carta de correção em andamento neste CT-e.', 409);
    if (!providerDocId) throw new AppError('Não achamos o registro deste CT-e no provedor fiscal. Fale com a torre.', 409);
    const outcome = await deps.consultCteCartaCorrecaoViaAcbr({ providerDocId, ambiente, accessKey: calc.cteAccessKey });
    return finishCorrection(deps, input.orderId, calc.id, input.actor, open, outcome);
}
