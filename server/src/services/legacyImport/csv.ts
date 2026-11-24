/**
 * Leitor de CSV para exportações de sistemas legados (Excel pt-BR usa `;`; outros usam `,`).
 * Aceita BOM, aspas com aspas dobradas e quebra de linha dentro de aspas. Cabeçalho normalizado:
 * minúsculas, sem acento, só letras/números/underscore ("Razão Social" → "razao_social").
 */
export function normalizeHeader(h: string): string {
    return h
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function detectDelimiter(firstLine: string): ';' | ',' | '\t' {
    const counts = { ';': 0, ',': 0, '\t': 0 } as Record<';' | ',' | '\t', number>;
    let quoted = false;
    for (const ch of firstLine) {
        if (ch === '"') quoted = !quoted;
        else if (!quoted && ch in counts) counts[ch as ';' | ',' | '\t']++;
    }
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as ';' | ',' | '\t';
}

export function parseCsv(text: string): Array<Record<string, string>> {
    const src = text.replace(/^﻿/, '');
    const firstLineEnd = src.search(/\r?\n/);
    const delimiter = detectDelimiter(firstLineEnd === -1 ? src : src.slice(0, firstLineEnd));
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') quoted = false;
            else field += ch;
            continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === delimiter) { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(field); field = '';
            rows.push(row); row = [];
        } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
    if (nonEmpty.length === 0) return [];
    const headers = nonEmpty[0].map(normalizeHeader);
    return nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Primeiro valor não vazio entre os apelidos de coluna (cada sistema chama a coluna de um jeito). */
export function pick(row: Record<string, string>, aliases: string[]): string {
    for (const a of aliases) {
        const v = row[a];
        if (v !== undefined && v.trim() !== '') return v.trim();
    }
    return '';
}

/** dd/mm/aaaa, aaaa-mm-dd ou dd-mm-aaaa → Date (meio-dia UTC, sem fuso virar o dia). */
export function parseBrDate(value: string): Date | null {
    const v = value.trim();
    let m = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(v);
    if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12));
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    return null;
}

/** Inteiro em formato brasileiro ("14.500", "14500", "14.500,0") → 14500; vazio/inválido → null. */
export function parseIntLoose(value: string): number | null {
    const v = value.trim().replace(/\s/g, '');
    if (!v) return null;
    const n = Number(v.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n) : null;
}
