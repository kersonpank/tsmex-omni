import prisma from '../../lib/prisma.js';
import {
    average, HOUR_MS, DAY_MS, percentile, percentOf, periodToIso, round1,
    type ExcludedCount, type ReportPeriod, type ReportPeriodIso,
} from './common.js';

/** Relatório de pedidos entregues: lead time, no prazo (referência da cobertura), completo e tempo parado por hub. */

export const MAX_ORDERS = 5000;

export interface OrderLegInput {
    sequence: number;
    legType: 'COLETA' | 'TRANSFERENCIA' | 'ENTREGA';
    destHubId: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
}

export interface OrderAttemptInput {
    result: 'DELIVERED' | 'PARTIAL' | 'FAILED';
    deliveredQuantity: number | null;
    occurredAt: Date;
}

export interface OrderInput {
    orderId: string;
    enteredAt: Date;
    deliveredAt: Date;
    expectedUnits: number;
    /** Soma dos volumes entregues nas tentativas; null quando não há tentativa registrada. */
    deliveredUnits: number | null;
    destinationIbge: string | null;
    legs: OrderLegInput[];
}

/** Data efetiva da entrega: perna ENTREGA concluída; senão a última tentativa DELIVERED. */
export function resolveDeliveredAt(legs: OrderLegInput[], attempts: OrderAttemptInput[]): Date | null {
    const legDates = legs.filter((l) => l.legType === 'ENTREGA' && l.completedAt).map((l) => l.completedAt!.getTime());
    if (legDates.length) return new Date(Math.max(...legDates));
    const attemptDates = attempts.filter((a) => a.result === 'DELIVERED').map((a) => a.occurredAt.getTime());
    return attemptDates.length ? new Date(Math.max(...attemptDates)) : null;
}

export function sumDeliveredUnits(attempts: OrderAttemptInput[]): number | null {
    if (!attempts.length) return null;
    return attempts.reduce((sum, a) => sum + (a.deliveredQuantity ?? 0), 0);
}

export interface StoppedByHub {
    hubId: string;
    hubName: string | null;
    samples: number;
    totalHours: number;
    avgHours: number;
}

export interface OrdersReport {
    period: ReportPeriodIso;
    coverage: { ordersDelivered: number; ordersAnalysed: number; truncated: boolean; limit: number };
    leadTime: { measured: number; avgHours: number | null; medianHours: number | null; p90Hours: number | null };
    /** Referência: `leadTimeDays` da cobertura do hub de destino; o sistema não grava prazo prometido ao cliente. */
    onTime: { measured: number; onTime: number; percent: number | null; note: string };
    complete: { measured: number; complete: number; percent: number | null };
    stoppedByHub: StoppedByHub[];
    excluded: ExcludedCount[];
}

export const ON_TIME_NOTE =
    'Referência: prazo de entrega (leadTimeDays) da cobertura do hub de destino. Não é o prazo prometido ao cliente (o sistema não grava esse prazo).';

/** Agregação pura. `coverageDays` mapeia código IBGE do destino → prazo de referência em dias. */
export function aggregateOrders(
    orders: OrderInput[],
    coverageDays: Map<string, number>,
    hubNames: Map<string, string>,
    period: ReportPeriod,
    coverage: { ordersDelivered: number; fetched: number; limit: number },
): OrdersReport {
    const leadHours: number[] = [];
    let negativeLead = 0;
    let onTimeMeasured = 0;
    let onTimeCount = 0;
    let noReference = 0;
    let completeMeasured = 0;
    let completeCount = 0;
    let noQuantity = 0;
    const stopped = new Map<string, number[]>();

    for (const o of orders) {
        const leadMs = o.deliveredAt.getTime() - o.enteredAt.getTime();
        if (leadMs < 0) {
            negativeLead += 1;
        } else {
            leadHours.push(leadMs / HOUR_MS);
            const days = o.destinationIbge ? coverageDays.get(o.destinationIbge) : undefined;
            if (days === undefined) {
                noReference += 1;
            } else {
                onTimeMeasured += 1;
                if (leadMs <= days * DAY_MS) onTimeCount += 1;
            }
        }

        if (o.deliveredUnits === null) {
            noQuantity += 1;
        } else {
            completeMeasured += 1;
            if (o.deliveredUnits >= o.expectedUnits) completeCount += 1;
        }

        const legs = [...o.legs].sort((a, b) => a.sequence - b.sequence);
        for (let i = 0; i + 1 < legs.length; i += 1) {
            const prev = legs[i];
            const next = legs[i + 1];
            if (!prev.destHubId || !prev.completedAt || !next.startedAt) continue;
            const gap = next.startedAt.getTime() - prev.completedAt.getTime();
            if (gap < 0) continue;
            const list = stopped.get(prev.destHubId) ?? [];
            list.push(gap / HOUR_MS);
            stopped.set(prev.destHubId, list);
        }
    }

    const stoppedByHub: StoppedByHub[] = [...stopped.entries()]
        .map(([hubId, hours]) => ({
            hubId,
            hubName: hubNames.get(hubId) ?? null,
            samples: hours.length,
            totalHours: round1(hours.reduce((a, b) => a + b, 0)),
            avgHours: round1(average(hours)!),
        }))
        .sort((a, b) => b.avgHours - a.avgHours);

    const avg = average(leadHours);
    const median = percentile(leadHours, 50);
    const p90 = percentile(leadHours, 90);

    const excluded: ExcludedCount[] = [];
    if (negativeLead) excluded.push({ reason: 'Pedidos com entrega anterior à entrada (datas inconsistentes): fora do lead time e do prazo.', count: negativeLead });
    if (noReference) excluded.push({ reason: 'Pedidos sem prazo de referência na cobertura do destino: fora do "no prazo".', count: noReference });
    if (noQuantity) excluded.push({ reason: 'Pedidos sem tentativa de entrega registrada (sem quantidade entregue): fora do "completo".', count: noQuantity });

    return {
        period: periodToIso(period),
        coverage: {
            ordersDelivered: coverage.ordersDelivered,
            ordersAnalysed: orders.length,
            truncated: coverage.ordersDelivered > coverage.fetched,
            limit: coverage.limit,
        },
        leadTime: {
            measured: leadHours.length,
            avgHours: avg === null ? null : round1(avg),
            medianHours: median === null ? null : round1(median),
            p90Hours: p90 === null ? null : round1(p90),
        },
        onTime: { measured: onTimeMeasured, onTime: onTimeCount, percent: percentOf(onTimeCount, onTimeMeasured), note: ON_TIME_NOTE },
        complete: { measured: completeMeasured, complete: completeCount, percent: percentOf(completeCount, completeMeasured) },
        stoppedByHub,
        excluded,
    };
}

type Db = typeof prisma;

export async function loadOrdersReport(period: ReportPeriod, db: Db = prisma): Promise<OrdersReport> {
    const where = {
        status: 'DELIVERED' as const,
        OR: [
            { legs: { some: { legType: 'ENTREGA' as const, completedAt: { gte: period.from, lte: period.to } } } },
            { deliveryAttempts: { some: { result: 'DELIVERED' as const, occurredAt: { gte: period.from, lte: period.to } } } },
        ],
    };
    const [ordersDelivered, rows] = await Promise.all([
        db.order.count({ where }),
        db.order.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            take: MAX_ORDERS,
            select: {
                id: true, createdAt: true, enteredAtHubAt: true, fimIbgeCode: true,
                demand: { select: { units: true } },
                legs: { select: { sequence: true, legType: true, destHubId: true, startedAt: true, completedAt: true } },
                deliveryAttempts: { select: { result: true, deliveredQuantity: true, occurredAt: true } },
            },
        }),
    ]);

    const inputs: OrderInput[] = [];
    let outOfPeriod = 0;
    for (const r of rows) {
        const deliveredAt = resolveDeliveredAt(r.legs, r.deliveryAttempts);
        if (!deliveredAt || deliveredAt < period.from || deliveredAt > period.to) {
            outOfPeriod += 1;
            continue;
        }
        inputs.push({
            orderId: r.id,
            enteredAt: r.enteredAtHubAt ?? r.createdAt,
            deliveredAt,
            expectedUnits: r.demand.units,
            deliveredUnits: sumDeliveredUnits(r.deliveryAttempts),
            destinationIbge: r.fimIbgeCode,
            legs: r.legs,
        });
    }

    const ibgeCodes = [...new Set(inputs.map((i) => i.destinationIbge).filter((c): c is string => !!c))];
    const hubIds = [...new Set(inputs.flatMap((i) => i.legs.map((l) => l.destHubId)).filter((c): c is string => !!c))];
    const [coverageRows, hubs] = await Promise.all([
        ibgeCodes.length
            ? db.hubCoverage.findMany({
                where: { active: true, leadTimeDays: { not: null }, cityIbgeCode: { in: ibgeCodes } },
                orderBy: [{ priority: 'asc' }, { leadTimeDays: 'asc' }],
                select: { cityIbgeCode: true, leadTimeDays: true },
            })
            : Promise.resolve([]),
        hubIds.length ? db.hub.findMany({ where: { id: { in: hubIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const coverageDays = new Map<string, number>();
    for (const c of coverageRows) {
        // Primeira linha de cada cidade (menor prioridade numérica) é a referência.
        if (!coverageDays.has(c.cityIbgeCode) && c.leadTimeDays !== null) coverageDays.set(c.cityIbgeCode, c.leadTimeDays);
    }
    const hubNames = new Map(hubs.map((h) => [h.id, h.name]));

    const report = aggregateOrders(inputs, coverageDays, hubNames, period, { ordersDelivered, fetched: rows.length, limit: MAX_ORDERS });
    if (outOfPeriod) {
        report.excluded.push({
            reason: 'Pedidos cuja data efetiva de entrega (perna de entrega) cai fora do período: fora do relatório.',
            count: outOfPeriod,
        });
    }
    return report;
}
