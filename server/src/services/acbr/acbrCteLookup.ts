import { acbrFetchJson } from './acbrHttp.js';
import type { AcbrFiscalEnvironment } from './acbrConfig.js';

/**
 * Busca de CT-e no provedor SEM `providerDocId` (contrato ACBr: `GET /cte?cpf_cnpj=&ambiente=` com
 * `referencia`, `chave` ou `serie` opcionais; resposta `DfeListagem` = `{ "@count", data: Dfe[] }`).
 *
 * É a PROVA de existência/inexistência que a conciliação precisa antes de decidir qualquer coisa:
 * - FOUND: o documento existe no provedor (devolve o id para o fluxo normal de consulta).
 * - NOT_FOUND: TODAS as consultas responderam com sucesso e nenhuma trouxe o documento.
 * - AMBIGUOUS: mais de um documento candidato — não decide sozinho.
 * - LOOKUP_FAILED: qualquer falha (rede, 5xx, timeout, resposta fora do contrato, listagem grande
 *   demais para varrer) — NÃO é prova de nada; quem chama nunca pode reenviar neste caso.
 */

export interface CteLookupQuery {
    /** CNPJ/CPF do emitente (só dígitos). */
    cpfCnpj: string;
    ambiente: AcbrFiscalEnvironment;
    /** Referências confiáveis (ex.: id do CteEmissionJob): basta bater a referência. */
    referencias: string[];
    /**
     * Referências usadas em envios antigos (ex.: id do cálculo, reaproveitado entre tentativas):
     * só valem se `serie` + `numero` do documento também baterem com os reservados.
     */
    legacyReferencias?: string[];
    chave?: string | null;
    serie?: number | null;
    numero?: number | null;
}

export type CteLookupOutcome =
    | { kind: 'FOUND'; providerDocId: string; matchedBy: 'referencia' | 'chave' | 'numero'; status?: string }
    | { kind: 'NOT_FOUND' }
    | { kind: 'AMBIGUOUS'; ids: string[] }
    | { kind: 'LOOKUP_FAILED'; error: string };

export const CTE_LOOKUP_PAGE_SIZE = 100;
export const CTE_LOOKUP_MAX_PAGES = 10;

type Dfe = { id?: unknown; referencia?: unknown; chave?: unknown; serie?: unknown; numero?: unknown; status?: unknown };

const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

async function listCte(
    params: Record<string, string>,
    q: Pick<CteLookupQuery, 'cpfCnpj' | 'ambiente'>,
    fetchJson: typeof acbrFetchJson,
): Promise<Dfe[]> {
    const all: Dfe[] = [];
    for (let page = 0; page < CTE_LOOKUP_MAX_PAGES; page++) {
        const qs = new URLSearchParams({
            cpf_cnpj: digits(q.cpfCnpj),
            ambiente: q.ambiente === 'PRODUCAO' ? 'producao' : 'homologacao',
            ...params,
            $top: String(CTE_LOOKUP_PAGE_SIZE),
            $skip: String(page * CTE_LOOKUP_PAGE_SIZE),
            $inlinecount: 'true',
        });
        const body = await fetchJson<{ '@count'?: unknown; data?: unknown }>(`/cte?${qs.toString()}`, {
            method: 'GET', scopes: ['empresa', 'cte'], apiEnvironment: q.ambiente,
        });
        if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
            throw new Error('Resposta da listagem de CT-e fora do contrato (sem "data").');
        }
        all.push(...(body.data as Dfe[]));
        const count = typeof body['@count'] === 'number' ? body['@count'] : null;
        const fetched = (page + 1) * CTE_LOOKUP_PAGE_SIZE;
        if (body.data.length < CTE_LOOKUP_PAGE_SIZE || (count != null && fetched >= count)) return all;
    }
    throw new Error('Listagem de CT-e grande demais para conferir com segurança.');
}

function idOf(d: Dfe): string | null {
    return (typeof d.id === 'string' || typeof d.id === 'number') && String(d.id).trim() ? String(d.id).trim() : null;
}

function sameNumber(d: Dfe, q: CteLookupQuery): boolean {
    return q.numero != null && Number(d.numero) === q.numero && (q.serie == null || Number(d.serie) === q.serie);
}

function found(id: string, d: Dfe, matchedBy: 'referencia' | 'chave' | 'numero'): CteLookupOutcome {
    return { kind: 'FOUND', providerDocId: id, matchedBy, ...(typeof d.status === 'string' ? { status: d.status } : {}) };
}

function resolveCandidates(docs: Dfe[], matchedBy: 'referencia' | 'chave' | 'numero', q: CteLookupQuery): CteLookupOutcome | null {
    const byId = new Map<string, Dfe>();
    for (const d of docs) {
        const id = idOf(d);
        if (id) byId.set(id, d);
    }
    if (byId.size === 0) return null;
    const entries = [...byId];
    if (entries.length === 1) return found(entries[0][0], entries[0][1], matchedBy);
    const exact = entries.filter(([, d]) => sameNumber(d, q));
    if (exact.length === 1) return found(exact[0][0], exact[0][1], matchedBy);
    return { kind: 'AMBIGUOUS', ids: entries.map(([id]) => id) };
}

export async function lookupCteInProvider(
    q: CteLookupQuery,
    fetchJson: typeof acbrFetchJson = acbrFetchJson,
): Promise<CteLookupOutcome> {
    try {
        for (const ref of q.referencias.filter(Boolean)) {
            const docs = (await listCte({ referencia: ref }, q, fetchJson)).filter((d) => d.referencia === ref);
            const hit = resolveCandidates(docs, 'referencia', q);
            if (hit) return hit;
        }
        for (const ref of (q.legacyReferencias ?? []).filter(Boolean)) {
            const docs = (await listCte({ referencia: ref }, q, fetchJson)).filter((d) => d.referencia === ref && sameNumber(d, q));
            const hit = resolveCandidates(docs, 'referencia', q);
            if (hit) return hit;
        }
        const chave = digits(q.chave);
        if (chave.length === 44) {
            const docs = (await listCte({ chave }, q, fetchJson)).filter((d) => digits(d.chave) === chave);
            const hit = resolveCandidates(docs, 'chave', q);
            if (hit) return hit;
        }
        if (q.serie != null && q.numero != null) {
            const docs = (await listCte({ serie: String(q.serie) }, q, fetchJson)).filter((d) => sameNumber(d, q));
            const hit = resolveCandidates(docs, 'numero', q);
            if (hit) return hit;
        }
        return { kind: 'NOT_FOUND' };
    } catch (err) {
        return { kind: 'LOOKUP_FAILED', error: err instanceof Error ? err.message : String(err) };
    }
}
