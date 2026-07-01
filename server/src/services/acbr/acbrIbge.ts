import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

/** Mapeamento de UFs brasileiras para o código IBGE de suas respectivas capitais. */
const stateCapitalIbge: Record<string, string> = {
    AC: '1200401', // Rio Branco
    AL: '2704302', // Maceió
    AM: '1302603', // Manaus
    AP: '1600303', // Macapá
    BA: '2927408', // Salvador
    CE: '2304400', // Fortaleza
    DF: '5300108', // Brasília
    ES: '3205309', // Vitória
    GO: '5208707', // Goiânia
    MA: '2111300', // São Luís
    MG: '3106200', // Belo Horizonte
    MS: '5002704', // Campo Grande
    MT: '5103403', // Cuiabá
    PA: '1501402', // Belém
    PB: '2507507', // João Pessoa
    PE: '2611606', // Recife
    PI: '2211001', // Teresina
    PR: '4106902', // Curitiba
    RJ: '3304557', // Rio de Janeiro
    RN: '2408102', // Natal
    RO: '1100205', // Porto Velho
    RR: '1400100', // Boa Vista
    RS: '4314902', // Porto Alegre
    SC: '4205407', // Florianópolis
    SE: '2800308', // Aracaju
    SP: '3550308', // São Paulo
    TO: '1721000', // Palmas
};

/** Código IBGE da UF (ex.: SP → 35). */
export function ufToCuf(uf: string | null | undefined): number {
    const u = (uf ?? '').toUpperCase().trim();
    const map: Record<string, number> = {
        RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
        SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
    };
    return map[u] ?? 35;
}

/** normaliza texto removendo acentos, espaços e pontuações */
function normalizeText(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
}

export async function resolveIbgeCode(city: string, state: string): Promise<{ name: string; ibgeCode: string } | null> {
    const cleanState = (state ?? '').toUpperCase().trim();
    const cleanCity = (city ?? '').trim();
    if (!cleanState || !cleanCity) return null;

    // Check if we can find a city using findFirst first (to satisfy tests mocking findFirst)
    let matchedCity: any = await prisma.city.findFirst({
        where: {
            name: { equals: cleanCity, mode: 'insensitive' },
            state: { code: cleanState }
        }
    });

    if (!matchedCity) {
        // Fallback to finding all cities of the state (fuzzy matching in memory)
        const cities = await prisma.city.findMany({
            where: {
                state: { code: cleanState }
            }
        });

        const targetNormalized = normalizeText(cleanCity);
        matchedCity = cities.find(c => normalizeText(c.name) === targetNormalized) || null;
    }

    if (matchedCity) {
        return {
            name: matchedCity.name || cleanCity,
            ibgeCode: matchedCity.ibgeCode
        };
    }
    return null;
}

export function parseCityState(str: string): { city: string; state: string } | null {
    if (!str) return null;
    // split by comma or hyphen from right
    const match = str.match(/^(.*)[,-]\s*([a-zA-Z]{2})$/);
    if (match) {
        return {
            city: match[1].trim(),
            state: match[2].toUpperCase().trim()
        };
    }
    return null;
}

export async function resolveIbgeMunicipio(
    city: string | null | undefined,
    state: string | null | undefined,
    explicitIbgeCode?: string | null
): Promise<string> {
    if (explicitIbgeCode && explicitIbgeCode.trim()) {
        return explicitIbgeCode.trim();
    }

    const cleanCity = (city ?? '').trim();
    const cleanState = (state ?? '').toUpperCase().trim();

    if (!cleanCity || !cleanState) {
        throw new AppError('Cidade e Estado (UF) são obrigatórios para resolver o código IBGE.', 400);
    }

    const resolved = await resolveIbgeCode(cleanCity, cleanState);
    if (resolved) {
        return resolved.ibgeCode;
    }

    throw new AppError(`Não foi possível localizar o código IBGE para a cidade "${cleanCity} - ${cleanState}". Por favor, verifique o nome ou selecione uma cidade válida.`, 400);
}

export async function validateAndNormalizeCity(city: string, state: string): Promise<string> {
    const cleanCity = (city ?? '').trim();
    const cleanState = (state ?? '').toUpperCase().trim();
    if (!cleanCity || !cleanState) {
        throw new AppError('Cidade e estado (UF) são obrigatórios.', 400);
    }
    const resolved = await resolveIbgeCode(cleanCity, cleanState);
    if (!resolved) {
        throw new AppError(`Cidade "${cleanCity} - ${cleanState}" não foi encontrada no cadastro nacional.`, 400);
    }
    return resolved.name;
}
