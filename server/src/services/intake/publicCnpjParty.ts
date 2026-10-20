import axios from 'axios';
import type { Person, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { consultCNPJ } from '../cnpjService.js';
import { parseChaveNfe } from '../../lib/nfeChaveIntake.js';
import { resolveNfeCity, upsertParty } from './ensureNfePartyPersons.js';

/**
 * Cadastro público do CNPJ (Receita Federal, via BrasilAPI ou ReceitaWS) no formato que a
 * Pessoa precisa. É o que o balcão usa quando o XML da NF-e ainda não chegou: a chave traz o
 * CNPJ do emitente, e o cadastro público traz razão social, endereço e município (IBGE).
 */
export interface PublicCnpjData {
    cnpj: string;
    legalName: string;
    tradeName?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    cep?: string;
    city?: string;
    uf?: string;
    ibge?: string;
    situation?: string;
}

const text = (value: unknown): string | undefined =>
    (typeof value === 'string' || typeof value === 'number') && String(value).trim() ? String(value).trim() : undefined;
const digitsOf = (value: unknown): string => (text(value) ?? '').replace(/\D/g, '');

/** BrasilAPI `/cnpj/v1` → dados públicos. Sem razão social não há cadastro a aproveitar. */
export function fromBrasilApi(cnpj: string, data: unknown): PublicCnpjData | null {
    const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const legalName = text(row.razao_social);
    if (!legalName) return null;
    const kind = text(row.descricao_tipo_de_logradouro);
    const street = text(row.logradouro);
    // CEP pode vir numérico e perder o zero à esquerda (ex.: 1311000 → 01311000).
    const cep = digitsOf(row.cep).padStart(8, '0');
    const ibge = digitsOf(row.codigo_municipio_ibge);
    return {
        cnpj,
        legalName,
        tradeName: text(row.nome_fantasia),
        street: street && kind && !street.toUpperCase().startsWith(kind.toUpperCase()) ? `${kind} ${street}` : street,
        number: text(row.numero),
        complement: text(row.complemento),
        neighborhood: text(row.bairro),
        cep: /^\d{8}$/.test(cep) && cep !== '00000000' ? cep : undefined,
        city: text(row.municipio),
        uf: text(row.uf)?.toUpperCase(),
        ibge: /^\d{7}$/.test(ibge) ? ibge : undefined,
        situation: text(row.descricao_situacao_cadastral),
    };
}

/** Só BrasilAPI (sem chave, limite generoso, 5 s). Usado na criação da entrada pela chave. */
export async function fetchBrasilApiCnpj(cnpj: string): Promise<PublicCnpjData | null> {
    const document = digitsOf(cnpj);
    if (document.length !== 14) return null;
    try {
        const res = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${document}`, { timeout: 5000 });
        return fromBrasilApi(document, res.data);
    } catch {
        return null;
    }
}

/** BrasilAPI e, se falhar, ReceitaWS — nunca Sintegra (cobra por consulta). */
export async function fetchPublicCnpj(cnpj: string): Promise<PublicCnpjData | null> {
    const fromBrasil = await fetchBrasilApiCnpj(cnpj);
    if (fromBrasil) return fromBrasil;
    try {
        const r = await consultCNPJ(digitsOf(cnpj));
        return {
            cnpj: r.cnpj,
            legalName: r.legalName,
            tradeName: r.tradeName,
            street: r.address?.street,
            number: r.address?.number,
            complement: r.address?.complement,
            neighborhood: r.address?.neighborhood,
            cep: r.address?.zipCode,
            city: r.address?.city,
            uf: r.address?.state,
            ibge: r.address?.cityIbgeCode,
            situation: r.situation,
        };
    } catch {
        return null;
    }
}

/**
 * Pessoa do CNPJ: a já cadastrada (sem consulta externa) ou criada pelo cadastro público, com a
 * cidade confirmada no catálogo IBGE e endereço só quando a cidade bate (mesma regra da NF-e).
 * `known` evita uma segunda consulta quando a criação da entrada já trouxe os dados públicos.
 */
export async function ensurePublicCnpjPerson(cnpj: string, known?: PublicCnpjData | null): Promise<Person | null> {
    const document = digitsOf(cnpj);
    if (document.length !== 14) return null;
    const existing = await prisma.person.findUnique({ where: { document } });
    if (existing) return existing;
    const data = known?.legalName ? known : await fetchPublicCnpj(document);
    if (!data) return null;
    return upsertParty({
        document,
        legalName: data.legalName,
        tradeName: data.tradeName,
        city: await resolveNfeCity({ municipio: data.city, uf: data.uf, ibge: data.ibge }),
        cep: data.cep,
        address: data.street,
        number: data.number,
        complement: data.complement,
        neighborhood: data.neighborhood,
    });
}

/** Dados públicos guardados na criação da entrada pela chave (`rawInputData.nfeKeyLookup`). */
export function storedPublicData(raw: Prisma.JsonValue | null | undefined): PublicCnpjData | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const lookup = (raw as Record<string, unknown>).nfeKeyLookup as Record<string, unknown> | undefined;
    const emitente = lookup?.emitente as Record<string, unknown> | undefined;
    const data = emitente?.publicData as PublicCnpjData | undefined;
    return data && typeof data.legalName === 'string' && data.legalName ? data : null;
}

/**
 * Remetente da entrada sem XML: o emitente da NF-e (CNPJ na própria chave) pelo cadastro
 * público. Best-effort — falha devolve `null` e o operador escolhe na tela.
 */
export async function ensureKeyEmitterPerson(demand: {
    documentKey: string | null;
    rawInputData: Prisma.JsonValue | null;
}): Promise<Person | null> {
    const parsed = demand.documentKey ? parseChaveNfe(demand.documentKey) : null;
    if (!parsed) return null;
    try {
        return await ensurePublicCnpjPerson(parsed.cnpjEmit, storedPublicData(demand.rawInputData));
    } catch (error) {
        console.warn('[intake] Remetente pelos dados públicos indisponível:', error instanceof Error ? error.message : error);
        return null;
    }
}
