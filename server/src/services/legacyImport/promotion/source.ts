import prisma from '../../../lib/prisma.js';
import type { LegacySourceRow } from './types.js';

/**
 * Leitura do arquivo do legado (LegacyRecord) em lotes, na ordem do id (estável entre execuções).
 * Linhas de totais (`totregs`) nunca entram no arquivo (o carregador as remove); a checagem aqui é
 * só uma segunda guarda.
 */
export async function forEachLegacyBatch(entity: string, size: number, fn: (rows: LegacySourceRow[]) => Promise<void>): Promise<number> {
    let cursor: string | undefined;
    let total = 0;
    for (;;) {
        const page = await prisma.legacyRecord.findMany({
            where: { entity },
            orderBy: { id: 'asc' },
            take: size,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, legacyKey: true, data: true },
        });
        if (page.length === 0) break;
        cursor = page[page.length - 1].id;
        const rows = page
            .map((r) => ({ id: r.id, legacyKey: r.legacyKey, data: (r.data ?? {}) as Record<string, unknown> }))
            .filter((r) => !('totregs' in r.data));
        total += rows.length;
        if (rows.length) await fn(rows);
        if (page.length < size) break;
    }
    return total;
}

export async function loadLegacyRows(entity: string): Promise<LegacySourceRow[]> {
    const all: LegacySourceRow[] = [];
    await forEachLegacyBatch(entity, 2000, async (rows) => { all.push(...rows); });
    return all;
}

/** Valor do campo como texto aparado ('' se ausente). */
export function text(data: Record<string, unknown>, key: string): string {
    const v = data[key];
    return v === null || v === undefined ? '' : String(v).trim();
}

export function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}
