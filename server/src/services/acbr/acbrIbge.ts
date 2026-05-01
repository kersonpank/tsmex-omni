import prisma from '../../lib/prisma.js';

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
    const fallback = process.env.ACBR_FALLBACK_CMUN?.trim() ?? '3550308';
    const c = (city ?? '').trim();
    const st = (state ?? '').trim().toUpperCase();
    if (!c || !st) return fallback;
    const row = await prisma.city.findFirst({
        where: {
            name: { equals: c, mode: 'insensitive' },
            state: { code: st },
        },
        select: { ibgeCode: true },
    });
    return row?.ibgeCode ?? fallback;
}
