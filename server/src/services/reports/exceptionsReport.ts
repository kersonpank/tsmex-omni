import prisma from '../../lib/prisma.js';
import {
    average, HOUR_MS, percentile, percentOf, periodToIso, round1,
    type ExcludedCount, type ReportPeriod, type ReportPeriodIso,
} from './common.js';

/** Relatório de exceções (SystemAlert): abertas e resolvidas no período, por categoria e hub, sem teto de 50. */

export const MAX_ALERTS = 20000;
export const NO_HUB_KEY = 'SEM_HUB';

export interface AlertInput {
    category: string;
    hubId: string | null;
    createdAt: Date;
    dueAt: Date | null;
    resolvedAt: Date | null;
    resolvedByUserId: string | null;
    resolutionNote: string | null;
}

export interface ExceptionCategoryRow {
    category: string;
    opened: number;
    resolved: number;
    avgHoursToResolve: number | null;
}

export interface ExceptionHubRow {
    hubId: string;
    hubName: string | null;
    opened: number;
    resolved: number;
    avgHoursToResolve: number | null;
}

export interface ExceptionsReport {
    period: ReportPeriodIso;
    coverage: { alertsAnalysed: number; truncated: boolean; limit: number };
    opened: number;
    resolved: number;
    resolvedBy: { system: number; person: number; unattributed: number };
    timeToResolve: { measured: number; avgHours: number | null; medianHours: number | null; p90Hours: number | null };
    withinDue: { measured: number; within: number; percent: number | null };
    /** Situação atual (não depende do período): exceções ainda não resolvidas. */
    backlogNow: { total: number; overdue: number };
    byCategory: ExceptionCategoryRow[];
    byHub: ExceptionHubRow[];
    excluded: ExcludedCount[];
}

const inRange = (d: Date | null, p: ReportPeriod): boolean => !!d && d >= p.from && d <= p.to;

/** Agregação pura. */
export function aggregateExceptions(
    alerts: AlertInput[],
    hubNames: Map<string, string>,
    backlogNow: { total: number; overdue: number },
    period: ReportPeriod,
    coverage: { fetched: number; limit: number; matching: number },
): ExceptionsReport {
    let opened = 0;
    let resolved = 0;
    let system = 0;
    let person = 0;
    let unattributed = 0;
    const hoursAll: number[] = [];
    let dueMeasured = 0;
    let dueWithin = 0;
    let noDue = 0;
    let negative = 0;

    interface Acc { opened: number; resolved: number; hours: number[] }
    const byCat = new Map<string, Acc>();
    const byHub = new Map<string, Acc>();
    const acc = (m: Map<string, Acc>, k: string): Acc => {
        let a = m.get(k);
        if (!a) { a = { opened: 0, resolved: 0, hours: [] }; m.set(k, a); }
        return a;
    };

    for (const a of alerts) {
        const hubKey = a.hubId ?? NO_HUB_KEY;
        const cat = acc(byCat, a.category);
        const hub = acc(byHub, hubKey);

        if (inRange(a.createdAt, period)) {
            opened += 1;
            cat.opened += 1;
            hub.opened += 1;
        }

        if (inRange(a.resolvedAt, period)) {
            resolved += 1;
            cat.resolved += 1;
            hub.resolved += 1;
            if (a.resolvedByUserId) person += 1;
            else if (a.resolutionNote) system += 1;
            else unattributed += 1;

            const ms = a.resolvedAt!.getTime() - a.createdAt.getTime();
            if (ms < 0) {
                negative += 1;
            } else {
                const h = ms / HOUR_MS;
                hoursAll.push(h);
                cat.hours.push(h);
                hub.hours.push(h);
            }
            if (!a.dueAt) {
                noDue += 1;
            } else {
                dueMeasured += 1;
                if (a.resolvedAt!.getTime() <= a.dueAt.getTime()) dueWithin += 1;
            }
        }
    }

    const avgOrNull = (h: number[]) => (h.length ? round1(average(h)!) : null);
    const median = percentile(hoursAll, 50);
    const p90 = percentile(hoursAll, 90);
    const avg = average(hoursAll);

    const excluded: ExcludedCount[] = [];
    if (unattributed) excluded.push({ reason: 'Resolvidas sem responsável nem nota (origem sistema × pessoa indefinida): ficam fora das duas contagens.', count: unattributed });
    if (negative) excluded.push({ reason: 'Resolvidas com data anterior à abertura (datas inconsistentes): fora do tempo até resolver.', count: negative });
    if (noDue) excluded.push({ reason: 'Resolvidas sem prazo (dueAt): fora do "% dentro do prazo".', count: noDue });

    return {
        period: periodToIso(period),
        coverage: { alertsAnalysed: coverage.fetched, truncated: coverage.matching > coverage.fetched, limit: coverage.limit },
        opened,
        resolved,
        resolvedBy: { system, person, unattributed },
        timeToResolve: {
            measured: hoursAll.length,
            avgHours: avg === null ? null : round1(avg),
            medianHours: median === null ? null : round1(median),
            p90Hours: p90 === null ? null : round1(p90),
        },
        withinDue: { measured: dueMeasured, within: dueWithin, percent: percentOf(dueWithin, dueMeasured) },
        backlogNow,
        byCategory: [...byCat.entries()]
            .map(([category, a]) => ({ category, opened: a.opened, resolved: a.resolved, avgHoursToResolve: avgOrNull(a.hours) }))
            .filter((r) => r.opened || r.resolved)
            .sort((a, b) => b.opened - a.opened || a.category.localeCompare(b.category)),
        byHub: [...byHub.entries()]
            .map(([hubId, a]) => ({
                hubId, hubName: hubNames.get(hubId) ?? null, opened: a.opened, resolved: a.resolved, avgHoursToResolve: avgOrNull(a.hours),
            }))
            .filter((r) => r.opened || r.resolved)
            .sort((a, b) => b.opened - a.opened || a.hubId.localeCompare(b.hubId)),
        excluded,
    };
}

type Db = typeof prisma;

export async function loadExceptionsReport(period: ReportPeriod, db: Db = prisma, now: Date = new Date()): Promise<ExceptionsReport> {
    const range = { gte: period.from, lte: period.to };
    const where = { OR: [{ createdAt: range }, { resolvedAt: range }] };
    const [matching, rows, backlogTotal, backlogOverdue] = await Promise.all([
        db.systemAlert.count({ where }),
        db.systemAlert.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: MAX_ALERTS,
            select: { category: true, hubId: true, createdAt: true, dueAt: true, resolvedAt: true, resolvedByUserId: true, resolutionNote: true },
        }),
        db.systemAlert.count({ where: { status: { not: 'RESOLVED' } } }),
        db.systemAlert.count({ where: { status: { not: 'RESOLVED' }, dueAt: { lt: now } } }),
    ]);
    const hubIds = [...new Set(rows.map((r) => r.hubId).filter((h): h is string => !!h))];
    const hubs = hubIds.length ? await db.hub.findMany({ where: { id: { in: hubIds } }, select: { id: true, name: true } }) : [];
    return aggregateExceptions(
        rows,
        new Map(hubs.map((h) => [h.id, h.name])),
        { total: backlogTotal, overdue: backlogOverdue },
        period,
        { fetched: rows.length, limit: MAX_ALERTS, matching },
    );
}
