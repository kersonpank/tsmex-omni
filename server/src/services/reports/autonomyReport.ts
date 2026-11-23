import prisma from '../../lib/prisma.js';
import {
    average, percentOf, periodToIso, round2,
    type ExcludedCount, type ReportPeriod, type ReportPeriodIso,
} from './common.js';

/**
 * Régua de autonomia: lê `ConsolidationFeedback`. Só conta onde houve SUGESTÃO de verdade
 * (`suggestedManifests` não nulo e com ao menos um grupo): o `addOrderToManifest` grava ACCEPTED com
 * `suggestedManifests = JsonNull` — isso é ação manual, não aceite de sugestão.
 */

export const MAX_FEEDBACK = 20000;
export const AUTONOMY_TARGET_PERCENT = 90;
export const UNKNOWN_ROUTINE = 'DESCONHECIDA';

export interface FeedbackInput {
    action: 'ACCEPTED' | 'MODIFIED' | 'REJECTED';
    /** Valor lido do banco (Json): null = sem sugestão. */
    suggestedManifests: unknown;
    utilizationBefore: number | null;
    utilizationAfter: number | null;
    marginBefore: number | null;
    marginAfter: number | null;
}

/** Há sugestão quando o JSON não é nulo e (se for lista) tem ao menos um item. */
export function hasSuggestion(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return false;
}

/** Rotina que gerou a sugestão (campo `source` do primeiro grupo). */
export function routineOf(value: unknown): string {
    const first = Array.isArray(value) ? value[0] : value;
    if (first && typeof first === 'object') {
        const source = (first as Record<string, unknown>).source;
        if (typeof source === 'string' && source) return source;
    }
    return UNKNOWN_ROUTINE;
}

export interface BeforeAfter {
    samples: number;
    beforePercent: number | null;
    afterPercent: number | null;
}

export interface AutonomyRoutine {
    routine: string;
    suggestions: number;
    accepted: number;
    modified: number;
    rejected: number;
    /** % aceito sem alteração sobre as sugestões da rotina. */
    acceptedPercent: number | null;
    utilization: BeforeAfter;
    margin: BeforeAfter;
}

export interface AutonomyReport {
    period: ReportPeriodIso;
    targetPercent: number;
    coverage: { feedbackAnalysed: number; truncated: boolean; limit: number };
    overall: {
        suggestions: number;
        accepted: number;
        modified: number;
        rejected: number;
        acceptedPercent: number | null;
        meetsTarget: boolean | null;
    };
    byRoutine: AutonomyRoutine[];
    excluded: ExcludedCount[];
}

const ratioToPercent = (v: number | null): number | null => (v === null || !Number.isFinite(v) ? null : round2(v * 100));

function beforeAfter(rows: FeedbackInput[], pick: (r: FeedbackInput) => [number | null, number | null]): BeforeAfter {
    // Só entram pares completos, para que "antes" e "depois" sejam comparáveis.
    const pairs = rows.map(pick).filter((p): p is [number, number] => p[0] !== null && p[1] !== null && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const before = average(pairs.map((p) => p[0]));
    const after = average(pairs.map((p) => p[1]));
    return { samples: pairs.length, beforePercent: ratioToPercent(before), afterPercent: ratioToPercent(after) };
}

/** Agregação pura. */
export function aggregateAutonomy(
    rows: FeedbackInput[],
    period: ReportPeriod,
    coverage: { fetched: number; matching: number; limit: number },
): AutonomyReport {
    const withSuggestion = rows.filter((r) => hasSuggestion(r.suggestedManifests));
    const withoutSuggestion = rows.length - withSuggestion.length;

    const groups = new Map<string, FeedbackInput[]>();
    for (const r of withSuggestion) {
        const key = routineOf(r.suggestedManifests);
        const list = groups.get(key) ?? [];
        list.push(r);
        groups.set(key, list);
    }

    const count = (list: FeedbackInput[], a: FeedbackInput['action']) => list.filter((r) => r.action === a).length;
    const byRoutine: AutonomyRoutine[] = [...groups.entries()]
        .map(([routine, list]) => ({
            routine,
            suggestions: list.length,
            accepted: count(list, 'ACCEPTED'),
            modified: count(list, 'MODIFIED'),
            rejected: count(list, 'REJECTED'),
            acceptedPercent: percentOf(count(list, 'ACCEPTED'), list.length),
            utilization: beforeAfter(list, (r) => [r.utilizationBefore, r.utilizationAfter]),
            margin: beforeAfter(list, (r) => [r.marginBefore, r.marginAfter]),
        }))
        .sort((a, b) => b.suggestions - a.suggestions || a.routine.localeCompare(b.routine));

    const accepted = count(withSuggestion, 'ACCEPTED');
    const acceptedPercent = percentOf(accepted, withSuggestion.length);

    const excluded: ExcludedCount[] = [];
    if (withoutSuggestion) {
        excluded.push({
            reason: 'Feedbacks sem sugestão do sistema (ação manual, ex.: pedido incluído/removido à mão): não contam como aceite.',
            count: withoutSuggestion,
        });
    }

    return {
        period: periodToIso(period),
        targetPercent: AUTONOMY_TARGET_PERCENT,
        coverage: { feedbackAnalysed: coverage.fetched, truncated: coverage.matching > coverage.fetched, limit: coverage.limit },
        overall: {
            suggestions: withSuggestion.length,
            accepted,
            modified: count(withSuggestion, 'MODIFIED'),
            rejected: count(withSuggestion, 'REJECTED'),
            acceptedPercent,
            meetsTarget: acceptedPercent === null ? null : acceptedPercent >= AUTONOMY_TARGET_PERCENT,
        },
        byRoutine,
        excluded,
    };
}

type Db = typeof prisma;

export async function loadAutonomyReport(period: ReportPeriod, db: Db = prisma): Promise<AutonomyReport> {
    const where = { createdAt: { gte: period.from, lte: period.to } };
    const [matching, rows] = await Promise.all([
        db.consolidationFeedback.count({ where }),
        db.consolidationFeedback.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: MAX_FEEDBACK,
            select: {
                action: true, suggestedManifests: true,
                utilizationBefore: true, utilizationAfter: true, marginBefore: true, marginAfter: true,
            },
        }),
    ]);
    return aggregateAutonomy(rows, period, { fetched: rows.length, matching, limit: MAX_FEEDBACK });
}
