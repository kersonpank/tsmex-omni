import prisma from '../../lib/prisma.js';
import { getManifestMargin } from '../pricingService.js';
import {
    average, mapWithConcurrency, percentOf, periodToIso, reaisToCents, round2,
    type ExcludedCount, type ReportPeriod, type ReportPeriodIso,
} from './common.js';

/** Relatório de viagens concluídas: margem, ocupação, pontualidade e custo do transportador. */

export const MAX_TRIPS = 500;
const MARGIN_CONCURRENCY = 4;
export const NO_CARRIER_KEY = 'SEM_TRANSPORTADOR';

export interface TripMarginInput {
    costComplete: boolean;
    revenueNetCents: number;
    revenueRealizedCents: number;
    revenueEstimated: boolean;
    linkCostCents: number | null;
    hubCostCents: number;
    totalCostCents: number | null;
    marginCents: number | null;
    occupancyPercent: number | null;
}

export interface TripInput {
    manifestId: string;
    routeLabel: string;
    carrierId: string | null;
    carrierName: string | null;
    completedAt: Date;
    plannedArrivalAt: Date | null;
    arrivedAt: Date | null;
    stops: Array<{ sequence: number; plannedArrivalAt: Date | null; arrivedAt: Date | null; completedAt: Date | null }>;
    /** null = não foi possível calcular a margem (erro ao consultar). */
    margin: TripMarginInput | null;
}

export interface TripPunctuality {
    measuredCheckpoints: number;
    lateCheckpoints: number;
    onTime: boolean;
    maxDelayMinutes: number;
}

/** Pontualidade da viagem: cada parada com previsão é comparada à chegada real (ou conclusão). */
export function evaluatePunctuality(
    trip: Pick<TripInput, 'plannedArrivalAt' | 'arrivedAt' | 'completedAt' | 'stops'>,
): TripPunctuality | null {
    const checkpoints: Array<{ planned: Date; actual: Date }> = [];
    for (const stop of trip.stops) {
        const actual = stop.arrivedAt ?? stop.completedAt;
        if (stop.plannedArrivalAt && actual) checkpoints.push({ planned: stop.plannedArrivalAt, actual });
    }
    if (!checkpoints.length) {
        // Sem paradas planejadas: compara a previsão da viagem com a chegada real.
        const actual = trip.arrivedAt ?? trip.completedAt;
        if (trip.plannedArrivalAt && actual) checkpoints.push({ planned: trip.plannedArrivalAt, actual });
    }
    if (!checkpoints.length) return null;
    let late = 0;
    let maxDelay = 0;
    for (const c of checkpoints) {
        const delay = Math.round((c.actual.getTime() - c.planned.getTime()) / 60000);
        if (delay > 0) {
            late += 1;
            maxDelay = Math.max(maxDelay, delay);
        }
    }
    return { measuredCheckpoints: checkpoints.length, lateCheckpoints: late, onTime: late === 0, maxDelayMinutes: maxDelay };
}

export interface TripRow {
    manifestId: string;
    route: string;
    carrierId: string | null;
    carrierName: string | null;
    completedAt: string;
    costComplete: boolean | null;
    revenueNetCents: number | null;
    revenueEstimated: boolean | null;
    linkCostCents: number | null;
    hubCostCents: number | null;
    marginCents: number | null;
    marginPercent: number | null;
    occupancyPercent: number | null;
    onTime: boolean | null;
    maxDelayMinutes: number | null;
}

export interface TripGroup {
    key: string;
    label: string;
    trips: number;
    /** Viagens com custo completo (as únicas que entram nas somas abaixo). */
    tripsWithMargin: number;
    revenueNetCents: number;
    linkCostCents: number;
    hubCostCents: number;
    marginCents: number;
    marginPercent: number | null;
    avgOccupancyPercent: number | null;
    onTimeMeasured: number;
    onTimePercent: number | null;
}

export interface TripsReport {
    period: ReportPeriodIso;
    coverage: {
        tripsInPeriod: number;
        tripsAnalysed: number;
        truncated: boolean;
        limit: number;
    };
    totals: {
        trips: number;
        tripsWithMargin: number;
        revenueNetCents: number;
        revenueRealizedCents: number;
        tripsWithEstimatedRevenue: number;
        linkCostCents: number;
        hubCostCents: number;
        marginCents: number;
        marginPercent: number | null;
        avgOccupancyPercent: number | null;
        onTimeMeasured: number;
        onTimeTrips: number;
        onTimePercent: number | null;
    };
    byRoute: TripGroup[];
    byCarrier: TripGroup[];
    trips: TripRow[];
    excluded: ExcludedCount[];
}

interface Acc {
    key: string;
    label: string;
    trips: number;
    withMargin: number;
    revenue: number;
    linkCost: number;
    hubCost: number;
    margin: number;
    occupancy: number[];
    onTimeMeasured: number;
    onTime: number;
}

const newAcc = (key: string, label: string): Acc => ({
    key, label, trips: 0, withMargin: 0, revenue: 0, linkCost: 0, hubCost: 0, margin: 0, occupancy: [], onTimeMeasured: 0, onTime: 0,
});

function addToAcc(acc: Acc, trip: TripInput, punctuality: TripPunctuality | null): void {
    acc.trips += 1;
    const m = trip.margin;
    if (m && m.costComplete && m.marginCents !== null) {
        acc.withMargin += 1;
        acc.revenue += m.revenueNetCents;
        acc.linkCost += m.linkCostCents ?? 0;
        acc.hubCost += m.hubCostCents;
        acc.margin += m.marginCents;
    }
    if (m && m.occupancyPercent !== null) acc.occupancy.push(m.occupancyPercent);
    if (punctuality) {
        acc.onTimeMeasured += 1;
        if (punctuality.onTime) acc.onTime += 1;
    }
}

function toGroup(acc: Acc): TripGroup {
    const occ = average(acc.occupancy);
    return {
        key: acc.key,
        label: acc.label,
        trips: acc.trips,
        tripsWithMargin: acc.withMargin,
        revenueNetCents: acc.revenue,
        linkCostCents: acc.linkCost,
        hubCostCents: acc.hubCost,
        marginCents: acc.margin,
        marginPercent: percentOf(acc.margin, acc.revenue),
        avgOccupancyPercent: occ === null ? null : round2(occ),
        onTimeMeasured: acc.onTimeMeasured,
        onTimePercent: percentOf(acc.onTime, acc.onTimeMeasured),
    };
}

/** Agregação pura: sem acesso ao banco. */
export function aggregateTrips(
    trips: TripInput[],
    period: ReportPeriod,
    coverage: { tripsInPeriod: number; limit: number },
): TripsReport {
    const total = newAcc('TOTAL', 'Total');
    const byRoute = new Map<string, Acc>();
    const byCarrier = new Map<string, Acc>();
    let realized = 0;
    let estimatedTrips = 0;
    let incompleteCost = 0;
    let marginUnavailable = 0;
    let punctualityUnmeasurable = 0;
    const rows: TripRow[] = [];

    for (const trip of trips) {
        const punctuality = evaluatePunctuality(trip);
        if (!punctuality) punctualityUnmeasurable += 1;

        const carrierKey = trip.carrierId ?? NO_CARRIER_KEY;
        const carrierLabel = trip.carrierName ?? 'Sem transportador (frota própria do hub)';
        if (!byRoute.has(trip.routeLabel)) byRoute.set(trip.routeLabel, newAcc(trip.routeLabel, trip.routeLabel));
        if (!byCarrier.has(carrierKey)) byCarrier.set(carrierKey, newAcc(carrierKey, carrierLabel));
        for (const acc of [total, byRoute.get(trip.routeLabel)!, byCarrier.get(carrierKey)!]) addToAcc(acc, trip, punctuality);

        const m = trip.margin;
        if (!m) marginUnavailable += 1;
        else if (!m.costComplete) incompleteCost += 1;
        else {
            realized += m.revenueRealizedCents;
            if (m.revenueEstimated) estimatedTrips += 1;
        }

        const withMargin = !!m && m.costComplete && m.marginCents !== null;
        rows.push({
            manifestId: trip.manifestId,
            route: trip.routeLabel,
            carrierId: trip.carrierId,
            carrierName: trip.carrierName,
            completedAt: trip.completedAt.toISOString(),
            costComplete: m ? m.costComplete : null,
            revenueNetCents: m ? m.revenueNetCents : null,
            revenueEstimated: m ? m.revenueEstimated : null,
            linkCostCents: withMargin ? m!.linkCostCents : null,
            hubCostCents: m ? m.hubCostCents : null,
            marginCents: withMargin ? m!.marginCents : null,
            marginPercent: withMargin ? percentOf(m!.marginCents!, m!.revenueNetCents) : null,
            occupancyPercent: m ? m.occupancyPercent : null,
            onTime: punctuality ? punctuality.onTime : null,
            maxDelayMinutes: punctuality ? punctuality.maxDelayMinutes : null,
        });
    }

    const totalGroup = toGroup(total);
    const sortGroups = (a: TripGroup, b: TripGroup) =>
        b.marginCents - a.marginCents || b.trips - a.trips || a.label.localeCompare(b.label, 'pt-BR');

    const excluded: ExcludedCount[] = [];
    if (incompleteCost) excluded.push({ reason: 'Viagens com custo do transportador incompleto (sem acordo de preço): fora das somas de margem.', count: incompleteCost });
    if (marginUnavailable) excluded.push({ reason: 'Viagens cuja margem não pôde ser calculada: fora das somas de margem.', count: marginUnavailable });
    if (punctualityUnmeasurable) excluded.push({ reason: 'Viagens sem previsão de chegada ou sem chegada registrada: fora da pontualidade.', count: punctualityUnmeasurable });

    return {
        period: periodToIso(period),
        coverage: {
            tripsInPeriod: coverage.tripsInPeriod,
            tripsAnalysed: trips.length,
            truncated: coverage.tripsInPeriod > trips.length,
            limit: coverage.limit,
        },
        totals: {
            trips: totalGroup.trips,
            tripsWithMargin: totalGroup.tripsWithMargin,
            revenueNetCents: totalGroup.revenueNetCents,
            revenueRealizedCents: realized,
            tripsWithEstimatedRevenue: estimatedTrips,
            linkCostCents: totalGroup.linkCostCents,
            hubCostCents: totalGroup.hubCostCents,
            marginCents: totalGroup.marginCents,
            marginPercent: totalGroup.marginPercent,
            avgOccupancyPercent: totalGroup.avgOccupancyPercent,
            onTimeMeasured: total.onTimeMeasured,
            onTimeTrips: total.onTime,
            onTimePercent: totalGroup.onTimePercent,
        },
        byRoute: [...byRoute.values()].map(toGroup).sort(sortGroups),
        byCarrier: [...byCarrier.values()].map(toGroup).sort(sortGroups),
        trips: rows,
        excluded,
    };
}

type Db = typeof prisma;

export interface TripsReportDeps {
    db?: Db;
    getMargin?: typeof getManifestMargin;
}

/** Carrega as viagens concluídas no período e reaproveita `getManifestMargin` (não duplica a conta). */
export async function loadTripsReport(period: ReportPeriod, deps: TripsReportDeps = {}): Promise<TripsReport> {
    const db = deps.db ?? prisma;
    const getMargin = deps.getMargin ?? getManifestMargin;
    const where = { status: 'COMPLETED' as const, completedAt: { gte: period.from, lte: period.to } };

    const [tripsInPeriod, manifests] = await Promise.all([
        db.manifest.count({ where }),
        db.manifest.findMany({
            where,
            orderBy: { completedAt: 'desc' },
            take: MAX_TRIPS,
            select: {
                id: true, origin: true, originCity: true, destination: true, destinationCity: true,
                linkId: true, link: { select: { name: true } },
                completedAt: true, plannedArrivalAt: true, arrivedAt: true,
                tripStops: {
                    select: { sequence: true, plannedArrivalAt: true, arrivedAt: true, completedAt: true },
                    orderBy: { sequence: 'asc' },
                },
            },
        }),
    ]);

    const inputs = await mapWithConcurrency(manifests, MARGIN_CONCURRENCY, async (m): Promise<TripInput> => {
        let margin: TripMarginInput | null = null;
        try {
            const r = await getMargin(m.id);
            margin = {
                costComplete: r.costComplete,
                revenueNetCents: reaisToCents(r.revenueNet),
                revenueRealizedCents: reaisToCents(r.revenueRealized),
                revenueEstimated: r.revenueEstimated,
                linkCostCents: r.linkCost === null ? null : reaisToCents(r.linkCost),
                hubCostCents: reaisToCents(r.hubCost),
                totalCostCents: r.totalCost === null ? null : reaisToCents(r.totalCost),
                marginCents: r.margin === null ? null : reaisToCents(r.margin),
                occupancyPercent: r.occupancyPercent,
            };
        } catch {
            margin = null;
        }
        return {
            manifestId: m.id,
            routeLabel: `${m.originCity || m.origin} → ${m.destinationCity || m.destination}`,
            carrierId: m.linkId,
            carrierName: m.link?.name ?? null,
            completedAt: m.completedAt!,
            plannedArrivalAt: m.plannedArrivalAt,
            arrivedAt: m.arrivedAt,
            stops: m.tripStops,
            margin,
        };
    });

    return aggregateTrips(inputs, period, { tripsInPeriod, limit: MAX_TRIPS });
}
