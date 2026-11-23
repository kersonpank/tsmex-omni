import type { Manifest, ManifestReadiness } from '../../../types/index';

/** Regras puras do fechamento fiscal da viagem na torre: mensagens, CIOT cancelado, rascunho vazio e correções. */

/* ---------- Mensagem técnica → texto legível ---------- */

export interface ReadableMessage {
    message: string;
    /** O texto original do servidor, só quando foi trocado por uma explicação. */
    technical: string | null;
}

const MESSAGE_RULES: Array<[RegExp, string]> = [
    [/timeout of \d+\s*ms exceeded|ETIMEDOUT|ESOCKETTIMEDOUT|timed out/i, 'O provedor demorou demais para responder. Consulte o andamento antes de emitir outra vez.'],
    [/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network error|getaddrinfo/i, 'Não foi possível falar com o provedor agora (falha de conexão). Tente consultar de novo em instantes.'],
    [/status code 40[13]\b|unauthorized|forbidden/i, 'O provedor recusou as credenciais configuradas. A torre precisa conferir o acesso do integrador.'],
    [/status code 5\d\d\b|bad gateway|service unavailable|gateway time-?out/i, 'O provedor está instável no momento. Tente de novo em alguns minutos.'],
    [/status code 4\d\d\b/i, 'O provedor recusou a solicitação. Confira os dados da viagem e tente de novo.'],
    [/prisma|invalid `?.*invocation|unique constraint/i, 'Falha interna ao gravar os dados. Avise o suporte antes de tentar de novo.'],
];

const looksTechnical = (text: string): boolean =>
    /^[[{<]/.test(text) || /^\w*(Error|Exception)\b/.test(text) || /\n\s+at\s+\S+/.test(text) || /\b(undefined|null)\b.*\b(reading|of)\b/i.test(text) || (text.length > 160 && !/\s/.test(text.slice(0, 80)));

/**
 * `lastError` do job de CIOT e `statusReason` dos documentos chegam do provedor. Texto já em português
 * passa como está; erro de rede/HTTP/banco vira explicação; o que parece técnico e não tem regra usa o `fallback`.
 */
export function readableFiscalMessage(raw: string | null | undefined, fallback: string): ReadableMessage {
    const text = (raw ?? '').trim();
    if (!text) return { message: fallback, technical: null };
    for (const [pattern, replacement] of MESSAGE_RULES) if (pattern.test(text)) return { message: replacement, technical: text.slice(0, 400) };
    if (looksTechnical(text)) return { message: fallback, technical: text.slice(0, 400) };
    return { message: text.length > 600 ? `${text.slice(0, 597)}…` : text, technical: null };
}

/* ---------- CIOT ---------- */

export interface CancelCiotResult {
    /** `true` quando o servidor avisou que o MDF-e vinculado precisa ser cancelado na SEFAZ. */
    mdfeManual: boolean;
    message: string;
    accessKey: string | null;
}

type ManualMdfe = { id: string; accessKey: string | null } | null;
export interface CancelCiotResponse {
    mdfeRequiresManualCancellation?: ManualMdfe;
    data?: { mdfeRequiresManualCancellation?: ManualMdfe } | null;
}

/** Mesmo aviso da gestão clássica; o servidor só sinaliza (não cancela) o MDF-e de uma viagem de Lotação. */
export function cancelCiotResult(result: CancelCiotResponse | null | undefined): CancelCiotResult {
    // O servidor responde com o aviso na raiz; o tipo do cliente o descreve dentro de `data`. Vale qualquer um dos dois.
    const flag = result?.mdfeRequiresManualCancellation ?? result?.data?.mdfeRequiresManualCancellation ?? null;
    return flag
        ? { mdfeManual: true, accessKey: flag.accessKey ?? null, message: 'CIOT cancelado. O MDF-e vinculado precisa ser cancelado manualmente na SEFAZ.' }
        : { mdfeManual: false, accessKey: null, message: 'CIOT cancelado.' };
}

/* ---------- Rascunho vazio ---------- */

export interface DeletePermission {
    allowed: boolean;
    reason: string | null;
}

/** A prontidão do servidor decide (e explica); sem ela vale a regra local da gestão clássica. */
export function deleteDraftPermission(
    trip: Pick<Manifest, 'status' | 'creationAuditComplete' | 'firstOfferedAt' | 'demands' | 'fiscalDocuments' | 'freightAgreement'>,
    readiness: ManifestReadiness | null,
): DeletePermission {
    if (trip.status !== 'DRAFT') return { allowed: false, reason: 'Só rascunho em montagem pode ser excluído.' };
    const planning = readiness?.planningActions?.delete;
    if (planning) return { allowed: planning.allowed, reason: planning.allowed ? null : planning.reason ?? 'O servidor não permite excluir este rascunho.' };
    const empty = Boolean(trip.creationAuditComplete) && !trip.firstOfferedAt && !(trip.demands?.length ?? 0) && !(trip.fiscalDocuments?.length ?? 0) && !trip.freightAgreement;
    return empty ? { allowed: true, reason: null } : { allowed: false, reason: 'Só rascunho vazio (sem pedidos, documentos, Carta Frete ou oferta anterior) pode ser excluído.' };
}

/* ---------- Correções da viagem ---------- */

export type CorrectionKind = 'ROUTE' | 'STOP' | 'VEHICLE' | 'DRIVER';
export type CorrectionOutcome = 'APPLIED' | 'REJECTED' | 'SUCCESSOR';

export const CORRECTION_KINDS: Array<{ value: CorrectionKind; label: string }> = [
    { value: 'ROUTE', label: 'Rota principal' },
    { value: 'STOP', label: 'Parada' },
    { value: 'VEHICLE', label: 'Veículo' },
    { value: 'DRIVER', label: 'Motorista' },
];
export const CORRECTION_KIND_LABEL: Record<string, string> = Object.fromEntries(CORRECTION_KINDS.map((item) => [item.value, item.label]));
export const CORRECTION_STATUS_LABEL: Record<string, string> = { PENDING_FISCAL: 'Pendente de avaliação fiscal', APPLIED: 'Concluída', REJECTED: 'Descartada' };
export const CORRECTION_OUTCOMES: Array<{ value: CorrectionOutcome; label: string }> = [
    { value: 'APPLIED', label: 'Documentos regularizados no provedor' },
    { value: 'SUCCESSOR', label: 'Não cabe nesta viagem: abrir viagem sucessora' },
    { value: 'REJECTED', label: 'Descartar correção' },
];

export interface CorrectionDraft {
    kind: CorrectionKind;
    reason: string;
    description: string;
    stopId: string;
    city: { city: string; state: string; ibgeCode: string } | null;
}

export const emptyCorrection = (): CorrectionDraft => ({ kind: 'ROUTE', reason: '', description: '', stopId: '', city: null });

/** Mesmas travas da gestão clássica, na mesma ordem. */
export function correctionError(draft: CorrectionDraft): string | null {
    if (draft.reason.trim().length < 8 || !draft.description.trim()) return 'Descreva a mudança e o motivo (ao menos 8 caracteres).';
    if (draft.kind === 'STOP' && !draft.stopId) return 'Selecione a parada a corrigir.';
    if ((draft.kind === 'ROUTE' || draft.kind === 'STOP') && !draft.city?.ibgeCode) return 'Selecione a cidade pela busca para registrar o código IBGE.';
    return null;
}

export function buildCorrectionBody(draft: CorrectionDraft): { kind: CorrectionKind; reason: string; after: Record<string, string> } {
    return {
        kind: draft.kind,
        reason: draft.reason.trim(),
        after: {
            description: draft.description.trim(),
            ...(draft.kind === 'STOP' ? { stopId: draft.stopId } : {}),
            ...(draft.city?.ibgeCode ? { city: draft.city.city, state: draft.city.state, cityIbgeCode: draft.city.ibgeCode } : {}),
        },
    };
}

export const resolveCorrectionError = (note: string): string | null => (note.trim().length < 8 ? 'Descreva a conclusão em pelo menos 8 caracteres.' : null);

/** Pedir correção só faz sentido com a viagem na estrada; o servidor ainda confere o acesso. */
export function requestCorrectionPermission(trip: Pick<Manifest, 'status'>, readiness: ManifestReadiness | null): DeletePermission {
    if (trip.status !== 'IN_PROGRESS') return { allowed: false, reason: 'A correção é pedida com a viagem na estrada, depois dos documentos autorizados.' };
    const planning = readiness?.planningActions?.requestCorrection;
    if (planning && !planning.allowed) return { allowed: false, reason: planning.reason ?? 'O servidor não permite pedir correção agora.' };
    return { allowed: true, reason: null };
}
