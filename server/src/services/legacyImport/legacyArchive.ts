import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { normalizeHeader, parseCsv } from './csv.js';

/**
 * Arquivo do sistema legado (LegacyRecord): guarda cada linha exportada de lá como veio.
 * - idempotente: a mesma linha (entidade + chave) entra uma vez; se mudou, atualiza e conta revisão;
 * - chave: a coluna informada, ou a primeira coluna-chave conhecida, ou o hash da linha;
 * - busca: texto sem acento + dígitos de todos os valores (nome, CNPJ, número, chave de CT-e…).
 */
export type LegacyRow = Record<string, unknown>;

export interface ArchiveResult {
    entity: string;
    keyColumn: string | null;
    created: number;
    updated: number;
    unchanged: number;
    total: number;
}

const KEY_CANDIDATES = ['id', 'codigo', 'cod', 'numero', 'num', 'nr', 'chave', 'chave_acesso', 'documento', 'cnpj_cpf', 'cpf_cnpj', 'cnpj', 'cpf', 'placa'];
const CHUNK = 500;

export function normalizeEntity(entity: string): string {
    const e = normalizeHeader(entity);
    if (!e) throw new Error('Informe o tipo da listagem (ex.: pessoas, pedidos, viagens, ctes, titulos).');
    return e.slice(0, 60);
}

/** Normaliza as chaves do objeto (cabeçalhos do legado variam de acento/caixa entre telas). */
function normalizeKeys(row: LegacyRow): LegacyRow {
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizeHeader(k) || k, v]));
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function flattenText(value: unknown, out: string[] = []): string[] {
    if (value === null || value === undefined) return out;
    if (typeof value === 'object') {
        for (const v of Array.isArray(value) ? value : Object.values(value as object)) flattenText(v, out);
        return out;
    }
    const s = String(value).trim();
    if (s) {
        out.push(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
        const d = s.replace(/\D/g, '');
        if (d.length >= 3 && d !== s) out.push(d);
    }
    return out;
}

export function detectKeyColumn(rows: LegacyRow[], requested?: string | null): string | null {
    if (requested) {
        // Chave composta: "divisao+rota".
        const parts = requested.split('+').map((p) => normalizeHeader(p)).filter(Boolean);
        for (const k of parts) {
            if (!rows.some((r) => r[k] !== undefined)) throw new Error(`A coluna-chave "${k}" não existe no arquivo.`);
        }
        return parts.join('+');
    }
    const first = rows[0] ?? {};
    for (const c of KEY_CANDIDATES) {
        if (first[c] === undefined) continue;
        const values = rows.map((r) => String(r[c] ?? '').trim());
        // Só serve de chave se preenchida e sem repetição no arquivo.
        if (values.every(Boolean) && new Set(values).size === values.length) return c;
    }
    return null;
}

export async function archiveLegacyRows(
    entityRaw: string,
    rawRows: LegacyRow[],
    options: { keyColumn?: string | null; sourceFile?: string | null; metaKey?: string | null } = {},
): Promise<ArchiveResult> {
    const entity = normalizeEntity(entityRaw);
    // Linha de totais/metadados que o legado mistura aos registros (ex.: { totregs }): não é histórico.
    const meta = options.metaKey ? normalizeHeader(options.metaKey) : null;
    const rows = rawRows.map(normalizeKeys).filter((r) => !(meta && meta in r));
    const keyColumn = detectKeyColumn(rows, options.keyColumn);
    const result: ArchiveResult = { entity, keyColumn, created: 0, updated: 0, unchanged: 0, total: rows.length };

    // Linhas idênticas repetidas no mesmo arquivo (comum em export paginado) contam uma vez.
    const prepared = new Map<string, { legacyKey: string; data: LegacyRow; rowHash: string; searchText: string }>();
    const collisions: string[] = [];
    for (const data of rows) {
        const canonical = stableStringify(data);
        const rowHash = createHash('sha256').update(canonical).digest('hex');
        const legacyKey = keyColumn
            ? keyColumn.split('+').map((k) => String(data[k] ?? '').trim()).join('|').slice(0, 200)
            : `h:${rowHash.slice(0, 40)}`;
        const prev = prepared.get(legacyKey);
        if (prev && prev.rowHash !== rowHash) collisions.push(legacyKey);
        prepared.set(legacyKey, { legacyKey, data, rowHash, searchText: flattenText(data).join(' ').slice(0, 20000) });
    }
    // Mesma chave com conteúdo diferente no mesmo arquivo = a chave não identifica a linha. Guardar só a
    // última perderia histórico em silêncio: recusa e pede chave composta (ex.: codigo+documento).
    if (collisions.length > 0) {
        const sample = [...new Set(collisions)].slice(0, 5).join(', ');
        throw new Error(`A chave "${keyColumn}" não é única em ${entity}: ${new Set(collisions).size} chave(s) com linhas diferentes (ex.: ${sample}). Use uma chave composta, ex.: --key ${keyColumn}+documento.`);
    }
    result.unchanged += rows.length - prepared.size;

    const items = [...prepared.values()];
    for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        const existing = await prisma.legacyRecord.findMany({
            where: { entity, legacyKey: { in: chunk.map((c) => c.legacyKey) } },
            select: { id: true, legacyKey: true, rowHash: true },
        });
        const byKey = new Map(existing.map((e) => [e.legacyKey, e]));
        const toCreate = chunk.filter((c) => !byKey.has(c.legacyKey));
        if (toCreate.length) {
            const created = await prisma.legacyRecord.createMany({
                data: toCreate.map((c) => ({ entity, legacyKey: c.legacyKey, data: c.data as Prisma.InputJsonValue, rowHash: c.rowHash, searchText: c.searchText, sourceFile: options.sourceFile ?? null })),
                skipDuplicates: true,
            });
            result.created += created.count;
            result.unchanged += toCreate.length - created.count;
        }
        for (const c of chunk) {
            const prev = byKey.get(c.legacyKey);
            if (!prev) continue;
            if (prev.rowHash === c.rowHash) { result.unchanged++; continue; }
            await prisma.legacyRecord.update({
                where: { id: prev.id },
                data: { data: c.data as Prisma.InputJsonValue, rowHash: c.rowHash, searchText: c.searchText, sourceFile: options.sourceFile ?? undefined, revisions: { increment: 1 } },
            });
            result.updated++;
        }
    }
    return result;
}

/**
 * Lê o conteúdo exportado: CSV (; ou ,) ou JSON (array, ou objeto com a coleção em `collection`,
 * caminho com pontos — ex.: "dados.itens"). JSON Lines também.
 */
export function parseLegacyExport(content: string, options: { format?: 'csv' | 'json'; collection?: string | null } = {}): LegacyRow[] {
    const text = content.replace(/^﻿/, '').trim();
    const looksJson = text.startsWith('[') || text.startsWith('{');
    if (options.format === 'csv' || (!options.format && !looksJson)) return parseCsv(text);
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        parsed = text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    }
    let node: unknown = parsed;
    if (options.collection) {
        for (const part of options.collection.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    } else if (!Array.isArray(node) && node && typeof node === 'object') {
        // Sem caminho: usa a maior coleção de objetos do primeiro nível.
        const arrays = Object.values(node as Record<string, unknown>).filter((v): v is unknown[] => Array.isArray(v) && v.every((x) => x && typeof x === 'object'));
        node = arrays.sort((a, b) => b.length - a.length)[0] ?? [node];
    }
    if (!Array.isArray(node)) throw new Error('Não encontrei a lista de registros no JSON (informe a coleção).');
    return node.filter((x): x is LegacyRow => Boolean(x) && typeof x === 'object' && !Array.isArray(x));
}

export async function legacyArchiveSummary() {
    const rows = await prisma.legacyRecord.groupBy({ by: ['entity'], _count: { _all: true }, _max: { updatedAt: true } });
    return rows.map((r) => ({ entity: r.entity, count: r._count._all, lastImportAt: r._max.updatedAt })).sort((a, b) => a.entity.localeCompare(b.entity));
}

export async function searchLegacyArchive(params: { entity?: string; q?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const terms = (params.q ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
    const where: Prisma.LegacyRecordWhereInput = {
        ...(params.entity ? { entity: normalizeEntity(params.entity) } : {}),
        ...(terms.length ? { AND: terms.map((t) => ({ searchText: { contains: /^[\d./-]+$/.test(t) ? t.replace(/\D/g, '') || t : t } })) } : {}),
    };
    const [total, rows] = await Promise.all([
        prisma.legacyRecord.count({ where }),
        prisma.legacyRecord.findMany({ where, orderBy: [{ entity: 'asc' }, { legacyKey: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, entity: true, legacyKey: true, data: true, revisions: true, sourceFile: true, updatedAt: true } }),
    ]);
    return { total, page, pageSize, rows };
}
