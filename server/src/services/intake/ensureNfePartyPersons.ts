import type { Person, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { normalizeCityName } from '../selectedCity.js';
import { resolveIbgeCode } from '../acbr/acbrIbge.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

type PartyAddress = Partial<Pick<ParsedNfeCargo['destinatario'], 'municipio' | 'uf' | 'ibge'>>;

export interface NormalizedParty {
    document: string;
    legalName: string;
    tradeName?: string;
    stateRegistration?: string;
    city: { name: string; state: string; ibgeCode: string } | null;
    cep?: string;
    address?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
}

export interface NfePartyPersons {
    remetente: Person | null;
    destinatario: Person | null;
}

const digits = (value?: string | null) => (value ?? '').replace(/\D/g, '');
const clean = (value?: string | null) => value?.trim() || undefined;
const isBlank = (value?: string | null) => !value || !value.trim();

/**
 * Cidade da NF-e → catálogo IBGE. `cMun` do XML é a fonte oficial; só cai para nome+UF quando
 * o código falta ou contradiz a UF. Nunca inventa cidade: sem correspondência, `null`.
 */
export async function resolveNfeCity(address: PartyAddress): Promise<NormalizedParty['city']> {
    const uf = clean(address.uf)?.toUpperCase();
    const ibge = digits(address.ibge);
    if (/^\d{7}$/.test(ibge)) {
        const byCode = await prisma.city.findUnique({ where: { ibgeCode: ibge }, include: { state: true } });
        if (byCode && (!uf || byCode.state.code === uf)) {
            return { name: byCode.name, state: byCode.state.code, ibgeCode: byCode.ibgeCode };
        }
    }
    if (address.municipio && uf) {
        const byName = await resolveIbgeCode(address.municipio, uf);
        if (byName) return { name: byName.name, state: uf, ibgeCode: byName.ibgeCode };
    }
    return null;
}

async function normalizeParty(
    role: 'emitente' | 'destinatario',
    cargo: ParsedNfeCargo,
): Promise<NormalizedParty | null> {
    const party = cargo[role];
    const document = digits(party?.cnpj);
    if (!party || document.length !== 14 || !clean(party.razaoSocial)) return null;

    const cep = digits(party.cep);
    let stateRegistration: string | undefined;
    if (role === 'destinatario') {
        const dest = cargo.destinatario;
        // IE real vence; só marca ISENTO quando a própria nota declara isenção (indIEDest=2).
        stateRegistration = clean(dest.ie) ?? (dest.indIEDest === '2' ? 'ISENTO' : undefined);
    } else {
        stateRegistration = clean(cargo.emitente.ie);
    }

    return {
        document,
        legalName: party.razaoSocial.trim(),
        tradeName: role === 'emitente' ? clean(cargo.emitente.nomeFantasia) : undefined,
        stateRegistration,
        city: await resolveNfeCity(party),
        cep: cep.length === 8 ? cep : undefined,
        address: clean(party.logradouro),
        number: clean(party.numero),
        complement: clean(party.complemento),
        neighborhood: clean(party.bairro),
    };
}

/**
 * Preenche apenas lacunas do cadastro existente (nunca sobrescreve dado já confirmado por
 * humano). Endereço da NF-e só entra se a cidade final da Pessoa for a mesma da NF-e — evita
 * misturar rua de uma cidade com município de outra.
 */
function buildFillPatch(person: Person, party: NormalizedParty): Prisma.PersonUpdateInput {
    const patch: Prisma.PersonUpdateInput = {};

    let sameCity = false;
    if (party.city) {
        if (person.cityIbgeCode) {
            sameCity = person.cityIbgeCode === party.city.ibgeCode;
        } else if (isBlank(person.city) || (
            normalizeCityName(person.city!) === normalizeCityName(party.city.name)
            && (isBlank(person.state) || person.state!.toUpperCase() === party.city.state)
        )) {
            patch.city = party.city.name;
            patch.state = party.city.state;
            patch.cityIbgeCode = party.city.ibgeCode;
            sameCity = true;
        }
    }

    if (isBlank(person.tradeName) && party.tradeName) patch.tradeName = party.tradeName;
    if (isBlank(person.stateRegistration) && party.stateRegistration) patch.stateRegistration = party.stateRegistration;
    if (sameCity) {
        if (isBlank(person.cep) && party.cep) patch.cep = party.cep;
        if (isBlank(person.address) && party.address) patch.address = party.address;
        if (isBlank(person.number) && party.number) patch.number = party.number;
        if (isBlank(person.complement) && party.complement) patch.complement = party.complement;
        if (isBlank(person.neighborhood) && party.neighborhood) patch.neighborhood = party.neighborhood;
    }
    return patch;
}

export async function upsertParty(party: NormalizedParty): Promise<Person> {
    const existing = await prisma.person.findUnique({ where: { document: party.document } });
    if (existing) {
        const patch = buildFillPatch(existing, party);
        return Object.keys(patch).length > 0
            ? prisma.person.update({ where: { id: existing.id }, data: patch })
            : existing;
    }
    try {
        return await prisma.person.create({
            data: {
                documentType: 'CNPJ',
                document: party.document,
                legalName: party.legalName,
                tradeName: party.tradeName,
                stateRegistration: party.stateRegistration,
                ...(party.city ? { city: party.city.name, state: party.city.state, cityIbgeCode: party.city.ibgeCode } : {}),
                // Endereço só acompanha a cidade confirmada pelo catálogo.
                ...(party.city ? {
                    cep: party.cep, address: party.address, number: party.number,
                    complement: party.complement, neighborhood: party.neighborhood,
                } : {}),
                country: 'BRASIL',
            },
        });
    } catch (error) {
        // Corrida: outra chamada criou a mesma pessoa entre o find e o create (document é único).
        if ((error as { code?: string }).code === 'P2002') {
            const raced = await prisma.person.findUnique({ where: { document: party.document } });
            if (raced) return raced;
        }
        throw error;
    }
}

/**
 * Normaliza na chegada da NF-e: remetente (emitente) e destinatário viram Pessoas com cidade
 * resolvida por código IBGE (`cMun` do XML) e endereço completo. Idempotente — pode rodar na
 * criação da Demanda e de novo na abertura da entrada sem duplicar nem sobrescrever.
 * Falha de uma parte não derruba a outra.
 */
export async function ensureNfePartyPersons(cargo: ParsedNfeCargo): Promise<NfePartyPersons> {
    const run = async (role: 'emitente' | 'destinatario'): Promise<Person | null> => {
        try {
            const party = await normalizeParty(role, cargo);
            return party ? await upsertParty(party) : null;
        } catch (error) {
            console.warn(`[intake] Não foi possível normalizar ${role} da NF-e:`, error instanceof Error ? error.message : error);
            return null;
        }
    };
    const [remetente, destinatario] = await Promise.all([run('emitente'), run('destinatario')]);
    return { remetente, destinatario };
}
