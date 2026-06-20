import prisma from '../../lib/prisma.js';

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

export async function resolveIbgeMunicipio(city: string | null | undefined, state: string | null | undefined): Promise<string> {
    const st = (state ?? '').trim().toUpperCase();
    
    // Fallback: use state capital IBGE code, or global fallback if not mapped/invalid
    const stateFallback = stateCapitalIbge[st] || (
        (process.env.ACBR_FALLBACK_CMUN && process.env.ACBR_FALLBACK_CMUN.trim())
            ? process.env.ACBR_FALLBACK_CMUN.trim()
            : '3550308'
    );

    const c = (city ?? '').trim();
    if (!c || !st) return stateFallback;

    const row = await prisma.city.findFirst({
        where: {
            name: { equals: c, mode: 'insensitive' },
            state: { code: st },
        },
        select: { ibgeCode: true },
    });
    return row?.ibgeCode ?? stateFallback;
}
