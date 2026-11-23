import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler.js';

/** Utilidades compartilhadas dos relatórios de gestão (somente leitura). */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_PERIOD_DAYS = 30;
export const MAX_PERIOD_DAYS = 366;

export interface ReportPeriod {
    from: Date;
    to: Date;
}

export interface ReportPeriodIso {
    from: string;
    to: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const isoInstant = (label: string) =>
    z
        .string({ invalid_type_error: `Informe "${label}" como data ISO (ex.: 2026-11-01 ou 2026-11-01T00:00:00Z).` })
        .trim()
        .refine((v) => !Number.isNaN(new Date(v).getTime()), {
            message: `Data inválida em "${label}". Use o formato ISO (ex.: 2026-11-01 ou 2026-11-01T00:00:00Z).`,
        });

export const reportQuerySchema = z.object({
    from: isoInstant('from').optional(),
    to: isoInstant('to').optional(),
});

/**
 * Resolve o período do relatório. Padrão: últimos 30 dias até agora. Data sem hora em `to` vale
 * até o fim daquele dia (UTC). Máximo de 366 dias; `from` não pode ser posterior a `to`.
 * Lança `AppError` 400 com mensagem clara.
 */
export function resolveReportPeriod(query: unknown, now: Date = new Date()): ReportPeriod {
    const parsed = reportQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
        throw new AppError(parsed.error.errors[0]?.message ?? 'Período inválido.', 400);
    }
    const { from: rawFrom, to: rawTo } = parsed.data;

    let to: Date;
    if (rawTo) {
        to = new Date(rawTo);
        if (DATE_ONLY.test(rawTo)) to = new Date(to.getTime() + DAY_MS - 1);
    } else {
        to = now;
    }
    const from = rawFrom ? new Date(rawFrom) : new Date(to.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS);

    if (from.getTime() > to.getTime()) {
        throw new AppError('Período inválido: "from" não pode ser posterior a "to".', 400);
    }
    if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
        throw new AppError(`Período máximo de ${MAX_PERIOD_DAYS} dias.`, 400);
    }
    return { from, to };
}

export const periodToIso = (p: ReportPeriod): ReportPeriodIso => ({
    from: p.from.toISOString(),
    to: p.to.toISOString(),
});

/** Quantidade de registros deixados de fora de um relatório e o motivo (texto para a tela). */
export interface ExcludedCount {
    reason: string;
    count: number;
}

/** Converte Decimal/number/string para centavos inteiros, sem passar por ponto flutuante quando possível. */
export function toCents(value: { toString(): string } | number | string | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const text = typeof value === 'number' ? String(value) : value.toString();
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
    if (m) {
        const frac = (m[3] ?? '').padEnd(3, '0');
        const cents = Number(m[2]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
        return m[1] ? -cents : cents;
    }
    const n = Number(text);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Reais (já arredondados a 2 casas pelo pricingService) para centavos. */
export const reaisToCents = (v: number): number => Math.round(v * 100);

/** Percentual com 2 casas, ou null sem base. */
export function percentOf(part: number, whole: number): number | null {
    return whole > 0 ? Math.round((part / whole) * 10000) / 100 : null;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function average(values: number[]): number | null {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Percentil por posição (nearest-rank) em lista já ordenável. */
export function percentile(values: number[], p: number): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[rank];
}

export const monthKey = (d: Date): string => d.toISOString().slice(0, 7);

/** Executa `fn` sobre os itens com no máximo `limit` em paralelo, preservando a ordem. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return out;
}
