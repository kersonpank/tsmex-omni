import { consultCNPJ } from './cnpjService.js';
import { fetchPublicCnpj, type PublicCnpjData } from './intake/publicCnpjParty.js';

/**
 * Consulta de documento ANTES de cadastrar (transportador novo): devolve dados sugeridos para
 * preencher o formulário. Não cria nada. A consulta com IE (Sintegra) é paga por chamada,
 * então o resultado fica 10 minutos em memória.
 */
export interface DocumentSuggestion {
    legalName: string;
    tradeName: string | null;
    stateRegistration: string | null;
    phone: string | null;
    cep: string | null;
    address: string | null;
    number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    cityIbgeCode: string | null;
}

export interface CnpjSuggestionResult {
    source: 'sintegra' | 'receita';
    suggestion: DocumentSuggestion;
}

export interface CnpjLookupDeps {
    consult: typeof consultCNPJ;
    fetchPublic: (cnpj: string) => Promise<PublicCnpjData | null>;
    sintegraToken?: string;
    now: () => number;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: CnpjSuggestionResult | null }>();

export function clearCnpjLookupCache(): void {
    cache.clear();
}

const clean = (value: unknown): string | null => {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    return text || null;
};

export async function lookupCnpjSuggestion(cnpj: string, deps?: Partial<CnpjLookupDeps>): Promise<CnpjSuggestionResult | null> {
    const d: CnpjLookupDeps = {
        consult: consultCNPJ,
        fetchPublic: fetchPublicCnpj,
        sintegraToken: process.env.SINTEGRA_TOKEN || undefined,
        now: Date.now,
        ...deps,
    };
    const document = cnpj.replace(/\D/g, '');
    const hit = cache.get(document);
    if (hit && d.now() - hit.at < TTL_MS) return hit.value;

    let value: CnpjSuggestionResult | null = null;
    try {
        const r = await d.consult(document, d.sintegraToken);
        value = {
            source: r.source === 'sintegra' || r.stateRegistration ? 'sintegra' : 'receita',
            suggestion: {
                legalName: r.legalName,
                tradeName: clean(r.tradeName),
                stateRegistration: clean(r.stateRegistration),
                phone: clean(r.phone)?.replace(/\D/g, '') || null,
                cep: clean(r.address?.zipCode)?.replace(/\D/g, '') || null,
                address: clean(r.address?.street),
                number: clean(r.address?.number),
                complement: clean(r.address?.complement),
                neighborhood: clean(r.address?.neighborhood),
                city: clean(r.address?.city),
                state: clean(r.address?.state),
                cityIbgeCode: clean(r.address?.cityIbgeCode),
            },
        };
    } catch {
        const pub = await d.fetchPublic(document);
        if (pub) {
            value = {
                source: 'receita',
                suggestion: {
                    legalName: pub.legalName,
                    tradeName: clean(pub.tradeName),
                    stateRegistration: null,
                    phone: null,
                    cep: clean(pub.cep)?.replace(/\D/g, '') || null,
                    address: clean(pub.street),
                    number: clean(pub.number),
                    complement: clean(pub.complement),
                    neighborhood: clean(pub.neighborhood),
                    city: clean(pub.city),
                    state: clean(pub.uf),
                    cityIbgeCode: clean(pub.ibge),
                },
            };
        }
    }
    cache.set(document, { at: d.now(), value });
    return value;
}
