import axios from 'axios';
import type { Person, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { consultCNPJ, normalizeStateRegistration } from '../cnpjService.js';
import { AppError } from '../../middleware/errorHandler.js';
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
    stateRegistration?: string;
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
    const rawIe = row.inscricao_estadual;
    const ieRows = Array.isArray(rawIe) ? rawIe as Record<string, unknown>[] : [];
    const matchingIe = ieRows.find((entry) => {
        const state = text(entry.estado)?.toUpperCase();
        return !state || state === text(row.uf)?.toUpperCase();
    });
    const stateRegistration = normalizeStateRegistration(
        matchingIe ? matchingIe.inscricao_estadual : rawIe,
    );
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
        stateRegistration,
    };
}

type BrasilLookup = { status: 'found'; data: PublicCnpjData } | { status: 'not_found' | 'unavailable' };

async function lookupBrasilApiCnpj(cnpj: string): Promise<BrasilLookup> {
    const document = digitsOf(cnpj);
    if (document.length !== 14) return { status: 'not_found' };
    try {
        const res = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${document}`, { timeout: 5000 });
        const data = fromBrasilApi(document, res.data);
        return data ? { status: 'found', data } : { status: 'unavailable' };
    } catch (error) {
        return { status: axios.isAxiosError(error) && error.response?.status === 404 ? 'not_found' : 'unavailable' };
    }
}

/** A criação da demanda é best-effort e continua mesmo sem a BrasilAPI. */
export async function fetchBrasilApiCnpj(cnpj: string): Promise<PublicCnpjData | null> {
    const result = await lookupBrasilApiCnpj(cnpj);
    return result.status === 'found' ? result.data : null;
}

/** BrasilAPI e ReceitaWS; consulta de IE no Sintegra apenas se SINTEGRA_TOKEN estiver configurado. */
export async function fetchPublicCnpj(cnpj: string): Promise<PublicCnpjData | null> {
    const brasil = await lookupBrasilApiCnpj(cnpj);
    if (brasil.status === 'found') {
        // A BrasilAPI costuma retornar os dados cadastrais sem IE. Quando o Sintegra
        // foi configurado, aproveitamos a consulta autorizada para completar esse campo;
        // falha na consulta de IE nunca descarta os dados públicos já obtidos.
        if (brasil.data.stateRegistration || !process.env.SINTEGRA_TOKEN?.trim()) return brasil.data;
        try {
            const fiscal = await consultCNPJ(digitsOf(cnpj), process.env.SINTEGRA_TOKEN);
            return {
                ...brasil.data,
                ...(fiscal.stateRegistration ? { stateRegistration: fiscal.stateRegistration } : {}),
            };
        } catch {
            return brasil.data;
        }
    }
    try {
        const r = await consultCNPJ(digitsOf(cnpj), process.env.SINTEGRA_TOKEN);
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
            stateRegistration: r.stateRegistration,
        };
    } catch (error) {
        if (error instanceof AppError && error.statusCode === 404 && brasil.status === 'not_found') return null;
        if (error instanceof AppError && error.statusCode === 429) throw error;
        throw new AppError('Consulta de CNPJ indisponível. Tente novamente ou cadastre manualmente.', 503);
    }
}

/** Atualiza somente uma IE ainda vazia, inclusive se outra pessoa editar durante a consulta. */
async function fillMissingIe(person: Person, value?: string): Promise<Person> {
    const ie = normalizeStateRegistration(value);
    if (!ie || person.stateRegistration?.trim()) return person;
    const updated = await prisma.person.updateMany({
        where: { id: person.id, OR: [{ stateRegistration: null }, { stateRegistration: '' }] },
        data: { stateRegistration: ie },
    });
    if (!updated.count) return (await prisma.person.findUnique({ where: { document: person.document } })) ?? person;
    return { ...person, stateRegistration: ie };
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
    const matchingKnown = known?.legalName && digitsOf(known.cnpj) === document ? known : null;
    if (existing?.stateRegistration?.trim()) return existing;
    const knownWithoutIe = matchingKnown && !matchingKnown.stateRegistration;
    const enrichedKnown = knownWithoutIe && process.env.SINTEGRA_TOKEN?.trim()
        ? await fetchPublicCnpj(document) ?? matchingKnown
        : matchingKnown;
    if (existing) return fillMissingIe(existing, enrichedKnown?.stateRegistration);
    const data = enrichedKnown ?? await fetchPublicCnpj(document);
    if (!data) return null;
    const person = await upsertParty({
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
    return fillMissingIe(person, data.stateRegistration);
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
