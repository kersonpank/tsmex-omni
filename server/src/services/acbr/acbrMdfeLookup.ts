import { acbrFetchJson } from './acbrHttp.js';
import type { AcbrFiscalEnvironment } from './acbrConfig.js';

/**
 * Busca de MDF-e no provedor SEM id (contrato ACBr: `GET /mdfe?cpf_cnpj=&ambiente=&referencia=`,
 * resposta `DfeListagem` = `{ "@count", data: Dfe[] }`). A referência do MDF-e é o id do nosso
 * `ManifestFiscalDocument`. Mesmo critério do CT-e (acbrCteLookup.ts):
 * - FOUND: existe no provedor (devolve o id).
 * - NOT_FOUND: a listagem respondeu com sucesso e nenhum item tem essa referência.
 * - AMBIGUOUS: mais de um documento com a mesma referência — não decide sozinho.
 * - LOOKUP_FAILED: rede/5xx/timeout/resposta fora do contrato — não prova nada; nunca libera reemissão.
 */
export type MdfeLookupOutcome =
    | { kind: 'FOUND'; providerDocId: string }
    | { kind: 'NOT_FOUND' }
    | { kind: 'AMBIGUOUS'; ids: string[] }
    | { kind: 'LOOKUP_FAILED'; error: string };

const PAGE = 100;
const MAX_PAGES = 5;

type Dfe = { id?: unknown; referencia?: unknown };

export async function lookupMdfeByReferencia(
    q: { cpfCnpj: string; ambiente: AcbrFiscalEnvironment; referencia: string },
    fetchJson: typeof acbrFetchJson = acbrFetchJson,
): Promise<MdfeLookupOutcome> {
    try {
        const all: Dfe[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
            const qs = new URLSearchParams({
                cpf_cnpj: q.cpfCnpj.replace(/\D/g, ''),
                ambiente: q.ambiente === 'PRODUCAO' ? 'producao' : 'homologacao',
                referencia: q.referencia,
                $top: String(PAGE),
                $skip: String(page * PAGE),
                $inlinecount: 'true',
            });
            const body = await fetchJson<{ '@count'?: unknown; data?: unknown }>(`/mdfe?${qs.toString()}`, {
                method: 'GET', scopes: ['empresa', 'mdfe'], apiEnvironment: q.ambiente,
            });
            if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
                throw new Error('Resposta da listagem de MDF-e fora do contrato (sem "data").');
            }
            all.push(...(body.data as Dfe[]));
            const count = typeof body['@count'] === 'number' ? body['@count'] : null;
            if (body.data.length < PAGE || (count != null && (page + 1) * PAGE >= count)) {
                const ids = [...new Set(all.filter((d) => d.referencia === q.referencia)
                    .map((d) => (typeof d.id === 'string' || typeof d.id === 'number' ? String(d.id).trim() : ''))
                    .filter(Boolean))];
                if (ids.length === 0) return { kind: 'NOT_FOUND' };
                return ids.length === 1 ? { kind: 'FOUND', providerDocId: ids[0] } : { kind: 'AMBIGUOUS', ids };
            }
        }
        throw new Error('Listagem de MDF-e grande demais para conferir com segurança.');
    } catch (err) {
        return { kind: 'LOOKUP_FAILED', error: err instanceof Error ? err.message : String(err) };
    }
}
