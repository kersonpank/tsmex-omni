import prisma from '../../../lib/prisma.js';
import type { ExternalSeriesSummary } from './numberingStatus.js';

/**
 * Último número que o legado usou, tirado do histórico importado (`LegacyRecord`), para quando os XMLs
 * ainda não estão no arquivo fiscal externo:
 * - CT-e: listagem `ctes` (número por código de empresa) cruzada com `empresas` (código → CNPJ). A série
 *   é a do cadastro da empresa no legado, que não tem tela para mudar e está em 1 (`LEGACY_CTE_SERIES`).
 * - MDF-e: chave de acesso de `viagem_mdfes` (CNPJ, série e número estão dentro da chave).
 * O ambiente é produção (o histórico só traz documentos de verdade). É uma foto da data da importação:
 * o contador do próprio legado (tela de Empresas) pode estar à frente por número recusado/inutilizado.
 */
export const LEGACY_CTE_SERIES = 1;

type Row = { cnpj: string; series: number; last: number; count: bigint | number };

export async function legacyArchiveNumberingSummary(db: typeof prisma = prisma): Promise<ExternalSeriesSummary[]> {
    const ctes = await db.$queryRaw<Row[]>`
        SELECT lpad(regexp_replace(e.data->>'documento', '\\D', '', 'g'), 14, '0') AS cnpj,
               ${LEGACY_CTE_SERIES}::int AS series,
               max((c.data->>'numero')::int) AS last,
               count(*) AS count
        FROM "LegacyRecord" c
        JOIN "LegacyRecord" e ON e.entity = 'empresas' AND e.data->>'codigo' = c.data->>'empresa'
        WHERE c.entity = 'ctes' AND c.data->>'numero' ~ '^[0-9]{1,9}$'
        GROUP BY 1`;
    const mdfes = await db.$queryRaw<Row[]>`
        SELECT substr(m.data->>'chave', 7, 14) AS cnpj,
               substr(m.data->>'chave', 23, 3)::int AS series,
               max(substr(m.data->>'chave', 26, 9)::int) AS last,
               count(*) AS count
        FROM "LegacyRecord" m
        WHERE m.entity = 'viagem_mdfes' AND m.data->>'chave' ~ '^[0-9]{44}$' AND substr(m.data->>'chave', 21, 2) = '58'
        GROUP BY 1, 2`;
    const map = (model: 'CTE' | 'MDFE') => (r: Row): ExternalSeriesSummary => ({
        emitterCnpj: r.cnpj, model, series: Number(r.series), environment: 'PRODUCAO',
        lastNumber: Number(r.last), lastIssuedAt: null, count: Number(r.count),
    });
    return [...ctes.map(map('CTE')), ...mdfes.map(map('MDFE'))];
}

/** Junta as duas fontes (XML importado e histórico): por CNPJ+modelo+série+ambiente fica o maior número. */
export function mergeSeriesSummaries(...lists: ExternalSeriesSummary[][]): ExternalSeriesSummary[] {
    const byKey = new Map<string, ExternalSeriesSummary>();
    for (const item of lists.flat()) {
        const key = `${item.emitterCnpj}|${item.model}|${item.series}|${item.environment}`;
        const prev = byKey.get(key);
        if (!prev) { byKey.set(key, { ...item }); continue; }
        const lastIssuedAt = [prev.lastIssuedAt, item.lastIssuedAt].filter(Boolean).map((d) => new Date(d as Date)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
        byKey.set(key, { ...prev, lastNumber: Math.max(prev.lastNumber, item.lastNumber), count: Math.max(prev.count, item.count), lastIssuedAt });
    }
    return [...byKey.values()];
}
