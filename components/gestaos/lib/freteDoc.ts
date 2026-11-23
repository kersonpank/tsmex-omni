import type { EmitOptions, EmitOutcome } from '../../os/freightActions';
import { DOC_TYPE_LABEL, EMPTY_INFORMED, IN_FLIGHT, parseInformed, type InformedForm } from '../../os/lib/freight';
import type { FreightDocType, FreightDocumentSummary, FreightQueueItem, FreightSuggestion } from '../../../types/index';
import type { Tone } from './trips';

/**
 * Regras de tela do documento do frete (CT-e, DC-e, minuta) na Gestão V2 — puras e testáveis.
 * A ordem das chamadas e as travas são as do O.S. (`freightActions`): prepara (sem duplicar), grava
 * CFOP/CST escolhidos, emite pelo endpoint do tipo. Aqui só se decide O QUE enviar e O QUE dizer.
 */

export const CANCEL_REASON_MIN = 15;
export const CANCEL_REASON_MAX = 255;
const NO_TABLE = 'Sem tabela de preço';

export { DOC_TYPE_LABEL, EMPTY_INFORMED };
export type { InformedForm };

/* ---------- Mensagens do servidor ---------- */

/**
 * Mensagem técnica do servidor ou do emissor fiscal em frase que a pessoa entende.
 * Mensagem já em português vai como veio (o servidor escreve para o operador); texto técnico
 * ou em inglês vira o `fallback`.
 */
export function readableFiscalMessage(raw: string | null | undefined, fallback: string): string {
    const text = (raw ?? '').trim();
    if (!text) return fallback;
    if (/timeout|timed out|ETIMEDOUT|ECONNABORTED|tempo esgotado/i.test(text)) {
        return 'O emissor fiscal demorou a responder. Confira o documento no pedido antes de emitir de novo.';
    }
    if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|socket hang up|network error|bad gateway|service unavailable|\b50[234]\b/i.test(text)) {
        return 'O emissor fiscal está fora do ar agora. Tente de novo em alguns minutos.';
    }
    if (/certificad/i.test(text) && /(venc|expir)/i.test(text)) {
        return 'O certificado digital do emitente está vencido. Atualize o certificado em Sistema antes de emitir.';
    }
    if (/duplicidade|duplicate|already exists/i.test(text) && /cte|ct-e|documento|chave/i.test(text)) {
        return 'A SEFAZ diz que este documento já existe. Use “Conferir agora” antes de emitir de novo.';
    }
    if (/unauthorized|forbidden|\b40[13]\b/i.test(text) && !/[áéíóúãõç]/i.test(text)) {
        return 'Seu acesso não permite esta ação neste pedido.';
    }
    const technical = /^[\x20-\x7e]*$/.test(text) && /(error|exception|failed|undefined|null|prisma|invalid|internal server|cannot|unexpected|stack)/i.test(text);
    return technical ? fallback : text;
}

/* ---------- Resultado da emissão ---------- */

export type NoticeTone = 'ok' | 'info' | 'bad';
export interface Notice {
    tone: NoticeTone;
    text: string;
}

export function outcomeNotice(outcome: EmitOutcome): Notice {
    switch (outcome.kind) {
        case 'authorized':
            return { tone: 'ok', text: `${DOC_TYPE_LABEL[outcome.calc.documentType]} nº ${outcome.calc.cteNumber ?? outcome.calc.dceNumber ?? ''} autorizado.`.replace(' nº  ', ' ') };
        case 'sent':
            return { tone: 'info', text: 'Enviado à SEFAZ. A autorização aparece aqui em instantes.' };
        case 'minuta':
            return { tone: 'ok', text: `Minuta nº ${outcome.calc.minutaNumber ?? ''} emitida.` };
        case 'rejected':
            return { tone: 'bad', text: `Rejeitado: ${readableFiscalMessage(outcome.reason, 'A SEFAZ rejeitou o documento.')} Corrija e emita de novo.` };
        case 'already':
            return { tone: 'info', text: 'Este pedido já tem esse documento — nada foi duplicado.' };
        case 'blocked':
            return { tone: 'bad', text: `Pendências: ${[...outcome.issues, ...outcome.missingFields.map((field) => `falta ${field}`)].join(' ')}` };
        default:
            return { tone: 'bad', text: readableFiscalMessage(outcome.message, 'Não foi possível emitir o documento. Tente de novo.') };
    }
}

/** Resultado de uma linha da fila em lote. */
export function queueResultText(outcome: EmitOutcome): { ok: boolean; text: string } {
    switch (outcome.kind) {
        case 'authorized':
            return { ok: true, text: 'autorizado' };
        case 'sent':
            return { ok: true, text: 'enviado à SEFAZ' };
        case 'minuta':
            return { ok: true, text: `minuta nº ${outcome.calc.minutaNumber ?? ''} — imprima no pedido` };
        case 'already':
            return { ok: true, text: 'já tinha documento' };
        case 'rejected':
            return { ok: false, text: `rejeitado: ${readableFiscalMessage(outcome.reason, 'rejeitado pela SEFAZ')}` };
        case 'blocked':
            return { ok: false, text: outcome.issues[0] ?? 'pendência fiscal' };
        default:
            return { ok: false, text: readableFiscalMessage(outcome.message, 'não foi possível emitir') };
    }
}

/** Emissão que não deu certo: vira erro na ação para o aviso sair em vermelho. */
export const isFailedOutcome = (outcome: EmitOutcome): boolean => outcome.kind === 'rejected' || outcome.kind === 'blocked' || outcome.kind === 'error';

/* ---------- Preparar a emissão ---------- */

export interface ComposerState {
    docType: FreightDocType;
    informedMode: boolean;
    tableId: string | null;
    form: InformedForm;
    reason: string;
    tax: { cfop: string; cst: string };
    newDocument: boolean;
}

export interface Readiness {
    total: number;
    issues: string[];
    blocking: string[];
    showTax: boolean;
    taxOk: boolean;
    reasonOk: boolean;
    canEmit: boolean;
}

/** O que impede de emitir agora — a mesma conta do compositor do O.S. */
export function emitReadiness(
    suggestion: Pick<FreightSuggestion, 'blockers' | 'missingFields' | 'docs'>,
    state: Pick<ComposerState, 'docType' | 'informedMode' | 'form' | 'reason' | 'tax'>,
    options: { tableTotal: number; tableCount: number; busy: boolean },
): Readiness {
    const total = state.informedMode ? parseInformed(state.form).total : options.tableTotal;
    const issues = state.docType === suggestion.docs.recommended ? suggestion.blockers.filter((blocker) => !blocker.startsWith(NO_TABLE)) : [];
    const showTax = state.docType === 'CTE' && (suggestion.missingFields.includes('cfop') || suggestion.missingFields.includes('cst'));
    const blocking = issues.filter((issue) => !(showTax && /CFOP|CST/.test(issue)));
    const taxOk =
        !showTax ||
        ((!suggestion.missingFields.includes('cfop') || Boolean(state.tax.cfop)) && (!suggestion.missingFields.includes('cst') || Boolean(state.tax.cst)));
    const reasonOk = !state.informedMode || options.tableCount === 0 || state.reason.trim().length > 0;
    return { total, issues, blocking, showTax, taxOk, reasonOk, canEmit: total > 0 && blocking.length === 0 && taxOk && reasonOk && !options.busy };
}

/** Corpo da emissão: valor informado (com motivo se houver tabela) OU a tabela escolhida; CFOP/CST só se pedidos. */
export function buildEmitOptions(state: ComposerState, readiness: Pick<Readiness, 'showTax'>, tableCount: number): EmitOptions {
    return {
        documentType: state.docType,
        ...(state.informedMode
            ? { informed: parseInformed(state.form).values, ...(tableCount > 0 ? { reason: state.reason.trim() } : {}) }
            : { pricingTableId: state.tableId ?? undefined }),
        newDocument: state.newDocument,
        ...(readiness.showTax ? { tax: state.tax } : {}),
    };
}

/* ---------- Documentos emitidos ---------- */

export const PRINTABLE_STATUSES: ReadonlySet<string> = new Set(['CTE_AUTHORIZED', 'MINUTA_EMITTED', 'DCE_AUTHORIZED']);

export function printLabel(doc: Pick<FreightDocumentSummary, 'documentType'>): string {
    if (doc.documentType === 'MINUTA') return 'Imprimir minuta';
    return doc.documentType === 'DCE' ? 'Imprimir DC-e' : 'Imprimir DACTE';
}

/** Documentos que a pessoa vê: rascunho sem motivo de rejeição anterior fica de fora. */
export function visibleDocuments(documents: FreightDocumentSummary[]): FreightDocumentSummary[] {
    return documents.filter((doc) => (doc.status !== 'DRAFT' && doc.status !== 'CALCULATED') || Boolean(doc.statusReason));
}

/** Rejeição de CFOP: a SEFAZ cita 519, 524, 676, 908 ou "CFOP". */
export function canCorrectCfop(doc: Pick<FreightDocumentSummary, 'documentType' | 'status' | 'statusReason'>): boolean {
    return doc.documentType === 'CTE' && doc.status === 'CTE_REJECTED' && /\b(?:519|524|676|908)\b|CFOP/i.test(doc.statusReason ?? '');
}

/** Cancelar CT-e: só autorizado. */
export const canCancelCte = (doc: Pick<FreightDocumentSummary, 'documentType' | 'status'>): boolean => doc.documentType === 'CTE' && doc.status === 'CTE_AUTHORIZED';

export function cancelReasonCheck(reason: string): { ok: boolean; length: number; missing: number } {
    const length = reason.trim().length;
    return { ok: length >= CANCEL_REASON_MIN && length <= CANCEL_REASON_MAX, length, missing: Math.max(0, CANCEL_REASON_MIN - length) };
}

export function documentTone(tone: 'ok' | 'route' | 'warn' | 'danger' | 'none'): Tone {
    if (tone === 'ok' || tone === 'route') return 'royal';
    if (tone === 'warn') return 'yellow';
    if (tone === 'danger') return 'red';
    return 'neutral';
}

/** Há CT-e/DC-e a caminho da SEFAZ: a tela consulta de novo sozinha. */
export const hasInFlight = (documents: Pick<FreightDocumentSummary, 'status'>[]): boolean => documents.some((doc) => IN_FLIGHT.includes(doc.status));

/* ---------- Fila em lote ---------- */

/** Só os prontos e marcados saem no lote, na ordem da fila. */
export function queueBatch(items: FreightQueueItem[], selected: ReadonlySet<string>): FreightQueueItem[] {
    return items.filter((item) => item.ready && selected.has(item.orderId));
}

export const readyIds = (items: FreightQueueItem[]): Set<string> => new Set(items.filter((item) => item.ready).map((item) => item.orderId));

/** Corpo da emissão de uma linha da fila: o documento que o sistema recomendou, sem mais nada. */
export const queueEmitOptions = (item: FreightQueueItem): EmitOptions => ({ documentType: item.suggestion.docs.recommended });
