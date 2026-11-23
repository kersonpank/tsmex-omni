import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateTrips, evaluatePunctuality, loadTripsReport, NO_CARRIER_KEY, type TripInput, type TripMarginInput } from './tripsReport.js';

const period = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-30T23:59:59Z') };
const d = (s: string) => new Date(s);

const margin = (over: Partial<TripMarginInput> = {}): TripMarginInput => ({
    costComplete: true, revenueNetCents: 100000, revenueRealizedCents: 100000, revenueEstimated: false,
    linkCostCents: 60000, hubCostCents: 10000, totalCostCents: 70000, marginCents: 30000, occupancyPercent: 80, ...over,
});

const trip = (over: Partial<TripInput> = {}): TripInput => ({
    manifestId: 'm1', routeLabel: 'A → B', carrierId: 'l1', carrierName: 'Link 1',
    completedAt: d('2026-11-10T12:00:00Z'), plannedArrivalAt: d('2026-11-10T10:00:00Z'), arrivedAt: d('2026-11-10T09:30:00Z'),
    stops: [], margin: margin(), ...over,
});

describe('evaluatePunctuality', () => {
    it('usa as paradas quando há previsão por parada', () => {
        const r = evaluatePunctuality({
            plannedArrivalAt: null, arrivedAt: null, completedAt: d('2026-11-10T12:00:00Z'),
            stops: [
                { sequence: 1, plannedArrivalAt: d('2026-11-10T08:00:00Z'), arrivedAt: d('2026-11-10T08:00:00Z'), completedAt: null },
                { sequence: 2, plannedArrivalAt: d('2026-11-10T10:00:00Z'), arrivedAt: null, completedAt: d('2026-11-10T10:45:00Z') },
            ],
        });
        assert.deepEqual(r, { measuredCheckpoints: 2, lateCheckpoints: 1, onTime: false, maxDelayMinutes: 45 });
    });

    it('cai para a previsão da viagem sem paradas e devolve null sem previsão', () => {
        assert.equal(evaluatePunctuality(trip())!.onTime, true);
        assert.equal(evaluatePunctuality(trip({ plannedArrivalAt: null })), null);
    });
});

describe('aggregateTrips', () => {
    it('soma margem só das viagens com custo completo e conta as excluídas', () => {
        const report = aggregateTrips([
            trip(),
            trip({
                manifestId: 'm2', arrivedAt: d('2026-11-10T11:00:00Z'),
                margin: margin({ revenueNetCents: 50000, linkCostCents: 20000, hubCostCents: 5000, marginCents: 25000, occupancyPercent: 60, revenueEstimated: true, revenueRealizedCents: 0 }),
            }),
            trip({
                manifestId: 'm3', carrierId: null, carrierName: null, routeLabel: 'C → D',
                margin: margin({ costComplete: false, linkCostCents: null, totalCostCents: null, marginCents: null }),
            }),
            trip({ manifestId: 'm4', margin: null, plannedArrivalAt: null }),
        ], period, { tripsInPeriod: 4, limit: 500 });

        assert.equal(report.period.from, '2026-11-01T00:00:00.000Z');
        assert.deepEqual(report.coverage, { tripsInPeriod: 4, tripsAnalysed: 4, truncated: false, limit: 500 });
        assert.equal(report.totals.trips, 4);
        assert.equal(report.totals.tripsWithMargin, 2);
        assert.equal(report.totals.revenueNetCents, 150000);
        assert.equal(report.totals.linkCostCents, 80000);
        assert.equal(report.totals.hubCostCents, 15000);
        assert.equal(report.totals.marginCents, 55000);
        assert.equal(report.totals.marginPercent, 36.67);
        assert.equal(report.totals.revenueRealizedCents, 100000);
        assert.equal(report.totals.tripsWithEstimatedRevenue, 1);
        // ocupação: m1 80, m2 60, m3 80 (custo incompleto mantém ocupação), m4 sem margem
        assert.equal(report.totals.avgOccupancyPercent, 73.33);
        // pontualidade: m1 no prazo, m2 atrasou 60 min, m3 no prazo, m4 sem previsão
        assert.equal(report.totals.onTimeMeasured, 3);
        assert.equal(report.totals.onTimeTrips, 2);
        assert.equal(report.totals.onTimePercent, 66.67);
        assert.deepEqual(report.excluded.map((e) => e.count), [1, 1, 1]);
        assert.match(report.excluded[0].reason, /custo/);
    });

    it('agrega por rota e por transportador, ordenado por margem', () => {
        const report = aggregateTrips([
            trip(),
            trip({ manifestId: 'm2', margin: margin({ marginCents: 10000 }) }),
            trip({ manifestId: 'm3', routeLabel: 'C → D', carrierId: null, carrierName: null, margin: margin({ marginCents: 99000, revenueNetCents: 200000 }) }),
        ], period, { tripsInPeriod: 3, limit: 500 });
        assert.deepEqual(report.byRoute.map((r) => [r.label, r.trips, r.marginCents]), [['C → D', 1, 99000], ['A → B', 2, 40000]]);
        const carrier = report.byCarrier.find((c) => c.key === 'l1')!;
        assert.equal(carrier.trips, 2);
        assert.equal(carrier.linkCostCents, 120000);
        assert.ok(report.byCarrier.some((c) => c.key === NO_CARRIER_KEY));
    });

    it('marca truncamento quando há mais viagens no período que as analisadas', () => {
        const report = aggregateTrips([trip()], period, { tripsInPeriod: 900, limit: 500 });
        assert.equal(report.coverage.truncated, true);
    });
});

describe('loadTripsReport', () => {
    it('reaproveita getManifestMargin (reais para centavos) e tolera falha por viagem', async () => {
        const db = {
            manifest: {
                count: async () => 2,
                findMany: async () => [
                    {
                        id: 'm1', origin: 'A', originCity: 'Cidade A', destination: 'B', destinationCity: null, linkId: 'l1', link: { name: 'Link 1' },
                        completedAt: d('2026-11-10T12:00:00Z'), plannedArrivalAt: null, arrivedAt: null, tripStops: [],
                    },
                    {
                        id: 'm2', origin: 'A', originCity: null, destination: 'B', destinationCity: null, linkId: null, link: null,
                        completedAt: d('2026-11-11T12:00:00Z'), plannedArrivalAt: null, arrivedAt: null, tripStops: [],
                    },
                ],
            },
        } as any;
        const getMargin = (async (id: string) => {
            if (id === 'm2') throw new Error('falha');
            return {
                revenue: 1000.1, revenueGross: 1100, icms: 99.9, revenueNet: 1000.1, revenueRealized: 1000.1, revenueEstimated: false,
                ordersWithoutOfficialFreight: 0, ordersWithoutFreightValue: 0, linkCost: 600.05, linkCostSource: 'ACORDO', hubCost: 100.1,
                totalCost: 700.15, margin: 299.95, marginPercent: 30, costComplete: true, missing: [],
                occupancyWeightPercent: 50, occupancyVolumePercent: 40, occupancyPercent: 50,
            };
        }) as any;
        const report = await loadTripsReport(period, { db, getMargin });
        assert.equal(report.trips[0].route, 'Cidade A → B');
        assert.equal(report.trips[0].marginCents, 29995);
        assert.equal(report.trips[0].revenueNetCents, 100010);
        assert.equal(report.totals.tripsWithMargin, 1);
        assert.ok(report.excluded.some((e) => /não pôde ser calculada/.test(e.reason) && e.count === 1));
    });
});
