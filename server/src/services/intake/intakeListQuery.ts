import type { Prisma } from '@prisma/client';
import { extractChaveFromInput } from '../../lib/nfeChaveIntake.js';

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Filtro OR para busca textual na fila de intake (usar dentro de AND com demais escopos).
 */
export function buildIntakeDemandSearchWhere(q: string | undefined): Prisma.DemandWhereInput {
    if (q == null || !String(q).trim()) return {};
    const raw = String(q).trim();
    const digitsOnly = raw.replace(/\D/g, '');
    const nfeDigits = extractChaveFromInput(raw).replace(/\D/g, '');

    const or: Prisma.DemandWhereInput[] = [
        { nfNumber: { contains: raw, mode: 'insensitive' } },
        { origin: { contains: raw, mode: 'insensitive' } },
        { destination: { contains: raw, mode: 'insensitive' } },
        {
            externalReference: {
                contains: raw.replace(/\s/g, ''),
                mode: 'insensitive',
            },
        },
        {
            client: {
                companyName: { contains: raw, mode: 'insensitive' },
            },
        },
        {
            client: {
                document: { contains: digitsOnly.length >= 8 ? digitsOnly : raw, mode: 'insensitive' },
            },
        },
    ];

    if (nfeDigits.length >= 8) {
        or.push({
            documentKey: {
                contains: nfeDigits.length >= 44 ? nfeDigits.slice(0, 44) : nfeDigits,
                mode: 'insensitive',
            },
        });
    }

    if (UUID_RE.test(raw)) {
        or.push({ id: raw });
    }

    return { OR: or };
}
