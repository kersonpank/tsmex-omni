import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { acbrFetchJson, AcbrHttpError, classifyAcbrErrorResponse } from './acbrHttp.js';

/**
 * Eventos de CT-e no provedor ACBr (clone da API Nuvem Fiscal) — contrato `hom.acbr.api.br/openapi/swagger.json`:
 *  - POST/GET /cte/{id}/cancelamento      (CancelarCte / ConsultarCancelamentoCte; body `CtePedidoCancelamento`, resposta `DfeCancelamento`)
 *  - GET      /cte/{id}/cancelamento/xml  (XML do evento)
 *  - POST/GET /cte/{id}/carta-correcao    (CriarCartaCorrecaoCte / ConsultarCartaCorrecaoCte; body `CtePedidoCartaCorrecao`, resposta `CteCartaCorrecao`)
 * `{id}` é o id interno do documento no provedor (CteEmissionJob.providerDocId), não a chave de acesso.
 * O evento tem `status`: pendente | registrado | rejeitado | erro. SÓ `registrado` com protocolo confirma.
 */

export type CteEventOutcome =
    | { kind: 'REGISTERED'; protocol: string; eventId?: string; eventAt?: string; rawResponse: unknown }
    | { kind: 'REJECTED'; reason: string; code?: string; rawResponse?: unknown }
    | { kind: 'PENDING'; reason?: string; eventId?: string; rawResponse?: unknown }
    /** O provedor pode ter recebido o pedido sem devolver resposta utilizável (timeout/5xx). Nunca reenviar às cegas. */
    | { kind: 'UNCERTAIN'; reason: string }
    /** Pedido recusado antes de ser processado (cota/limite): seguro tentar de novo. */
    | { kind: 'NOT_SENT'; reason: string }
    | { kind: 'NOT_FOUND' };

/** `CteInfCorrecao` do contrato. */
export interface CteCorrecaoItem {
    grupo_alterado: string;
    campo_alterado: string;
    valor_alterado: string;
    numero_item_alterado?: number | null;
}

type FetchJson = typeof acbrFetchJson;
const SCOPES = ['empresa', 'cte'];
/** cStat de evento aceito: 135 registrado e vinculado, 136 registrado sem vínculo, 155 cancelamento fora de prazo homologado. */
const OK_EVENT_CODES = new Set(['135', '136', '155']);

function norm(s: unknown): string {
    return String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

export function interpretCteEvent(doc: Record<string, unknown>, expectedAccessKey?: string | null): CteEventOutcome {
    const status = norm(doc.status);
    const protocol = String(doc.numero_protocolo ?? '').trim();
    const reason = String(doc.motivo_status ?? doc.mensagem ?? '').trim();
    const code = doc.codigo_status == null ? '' : String(doc.codigo_status).trim();
    const eventId = typeof doc.id === 'string' ? doc.id : undefined;
    const key = String(doc.chave_acesso ?? '').replace(/\D/g, '');
    if (status === 'rejeitado') return { kind: 'REJECTED', reason: reason || 'Evento rejeitado pelo provedor.', code: code || undefined, rawResponse: doc };
    if (status === 'registrado') {
        if (expectedAccessKey && key && key !== expectedAccessKey.replace(/\D/g, '')) {
            return { kind: 'PENDING', reason: 'O evento devolvido pelo provedor é de outra chave de acesso.', eventId, rawResponse: doc };
        }
        if (!protocol) return { kind: 'PENDING', reason: 'Evento sem número de protocolo; aguardando confirmação.', eventId, rawResponse: doc };
        if (code && !OK_EVENT_CODES.has(code)) {
            return { kind: 'PENDING', reason: `Código de retorno inesperado (${code}): ${reason || 'sem detalhe'}.`, eventId, rawResponse: doc };
        }
        return {
            kind: 'REGISTERED', protocol, eventId, rawResponse: doc,
            eventAt: typeof doc.data_evento === 'string' ? doc.data_evento : undefined,
        };
    }
    return { kind: 'PENDING', reason: status === 'erro' ? (reason || 'O provedor informou erro no evento.') : undefined, eventId, rawResponse: doc };
}

function classifyThrown(error: unknown): CteEventOutcome {
    if (error instanceof AcbrHttpError) {
        if (error.httpStatus === 402 || error.httpStatus === 429) {
            return { kind: 'NOT_SENT', reason: 'O provedor está sem crédito ou limitou as chamadas agora. Nada foi enviado; tente de novo em instantes.' };
        }
        if (error.httpStatus === 404) return { kind: 'NOT_FOUND' };
        if (error.httpStatus >= 400 && error.httpStatus < 500) return { kind: 'REJECTED', reason: error.message, code: String(error.httpStatus) };
        return { kind: 'UNCERTAIN', reason: error.message };
    }
    return { kind: 'UNCERTAIN', reason: error instanceof Error ? error.message : 'Falha de comunicação com o provedor.' };
}

async function sendEvent(
    method: 'GET' | 'POST', path: string, ambiente: AcbrFiscalEnvironment, body: unknown, accessKey: string | null | undefined, fetchJson: FetchJson,
): Promise<CteEventOutcome> {
    try {
        const doc = await fetchJson<Record<string, unknown>>(path, {
            method, scopes: SCOPES, apiEnvironment: ambiente,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return interpretCteEvent(doc && typeof doc === 'object' ? doc : {}, accessKey);
    } catch (error) {
        const outcome = classifyThrown(error);
        // GET 404 é "sem evento"; POST 404 é documento inexistente no provedor (recusa definitiva).
        if (outcome.kind === 'NOT_FOUND' && method === 'POST') return { kind: 'REJECTED', reason: 'O provedor não encontrou este CT-e.', code: '404' };
        return outcome;
    }
}

interface EventBase {
    providerDocId: string;
    ambiente: AcbrFiscalEnvironment;
    accessKey?: string | null;
}

/** Cancelamento (evento 110111). Uma única chamada; resultado incerto NUNCA é reenviado — concilie com `consultCteCancelViaAcbr`. */
export function cancelCteViaAcbr(input: EventBase & { justificativa: string }, fetchJson: FetchJson = acbrFetchJson): Promise<CteEventOutcome> {
    return sendEvent('POST', `/cte/${encodeURIComponent(input.providerDocId)}/cancelamento`, input.ambiente, { justificativa: input.justificativa }, input.accessKey, fetchJson);
}

export function consultCteCancelViaAcbr(input: EventBase, fetchJson: FetchJson = acbrFetchJson): Promise<CteEventOutcome> {
    return sendEvent('GET', `/cte/${encodeURIComponent(input.providerDocId)}/cancelamento`, input.ambiente, undefined, input.accessKey, fetchJson);
}

/** Carta de correção (evento 110110). */
export function createCteCartaCorrecaoViaAcbr(input: EventBase & { correcoes: CteCorrecaoItem[] }, fetchJson: FetchJson = acbrFetchJson): Promise<CteEventOutcome> {
    return sendEvent('POST', `/cte/${encodeURIComponent(input.providerDocId)}/carta-correcao`, input.ambiente, { correcoes: input.correcoes }, input.accessKey, fetchJson);
}

export function consultCteCartaCorrecaoViaAcbr(input: EventBase, fetchJson: FetchJson = acbrFetchJson): Promise<CteEventOutcome> {
    return sendEvent('GET', `/cte/${encodeURIComponent(input.providerDocId)}/carta-correcao`, input.ambiente, undefined, input.accessKey, fetchJson);
}

/** XML do evento de cancelamento homologado (`GET /cte/{id}/cancelamento/xml`). */
export async function downloadCteCancelXml(providerDocId: string, ambiente: AcbrFiscalEnvironment): Promise<string> {
    const token = await getAcbrAccessToken(SCOPES, ambiente);
    const path = `/cte/${encodeURIComponent(providerDocId)}/cancelamento/xml`;
    const res = await fetch(`${getAcbrApiBaseUrlForEnvironment(ambiente)}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) await classifyAcbrErrorResponse(res, path, await res.text());
    return res.text();
}
