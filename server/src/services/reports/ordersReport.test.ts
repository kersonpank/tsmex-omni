import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateOrders, loadOrdersReport, resolveDeliveredAt, sumDeliveredUnits, type OrderInput } from './ordersReport.js';

const period = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-30T23:59:59Z') };
const d = (s: string) => new Date(s);

const order = (over: Partial<OrderInput> = {}): OrderInput => ({
    orderId: 'o1', enteredAt: d('2026-11-01T00:00:00Z'), deliveredAt: d('2026-11-03T00:00:00Z'),
    expectedUnits: 10, deliveredUnits: 10, destinationIbge: '2100000', legs: [], ...over,
});

describe('resolveDeliveredAt / sumDeliveredUnits', () => {
    it('prefere a perna ENTREGA concluída e cai para a tentativa DELIVERED', () => {
        const legs = [
            { sequence: 1, legType: 'TRANSFERENCIA' as const, destHubId: 'h1', startedAt: null, completedAt: d('2026-11-02T00:00:00Z') },
            { sequence: 2, legType: 'ENTREGA' as const, destHubId: null, startedAt: null, completedAt: d('2026-11-05T00:00:00Z') },
        ];
        assert.equal(resolveDeliveredAt(legs, [])!.toISOString(), '2026-11-05T00:00:00.000Z');
        const attempts = [{ result: 'DELIVERED' as const, deliveredQuantity: 3, occurredAt: d('2026-11-06T00:00:00Z') }];
        assert.equal(resolveDeliveredAt([legs[0]], attempts)!.toISOString(), '2026-11-06T00:00:00.000Z');
        assert.equal(resolveDeliveredAt([legs[0]], []), null);
    });

    it('soma volumes entregues e devolve null sem tentativas', () => {
        assert.equal(sumDeliveredUnits([]), null);
        assert.equal(sumDeliveredUnits([
            { result: 'PARTIAL', deliveredQuantity: 4, occurredAt: d('2026-11-02T00:00:00Z') },
            { result: 'FAILED', deliveredQuantity: 0, occurredAt: d('2026-11-03T00:00:00Z') },
            { result: 'DELIVERED', deliveredQuantity: 6, occurredAt: d('2026-11-04T00:00:00Z') },
        ]), 10);
    });
});

describe('aggregateOrders', () => {
    it('calcula lead time, no prazo, completo e tempo parado por hub, contando exclusões', () => {
        const coverage = new Map([['2100000', 3], ['2200000', 1]]);
        const hubs = new Map([['h1', 'Hub Um']]);
        const orders: OrderInput[] = [
            // 48h, prazo 3 dias: no prazo; completo; parado 6h no h1
            order({
                legs: [
                    { sequence: 1, legType: 'TRANSFERENCIA', destHubId: 'h1', startedAt: d('2026-11-01T01:00:00Z'), completedAt: d('2026-11-01T10:00:00Z') },
                    { sequence: 2, legType: 'ENTREGA', destHubId: null, startedAt: d('2026-11-01T16:00:00Z'), completedAt: d('2026-11-03T00:00:00Z') },
                ],
            }),
            // 96h, prazo 1 dia: atrasado; incompleto (8 de 10); parado 12h no h1
            order({
                orderId: 'o2', deliveredAt: d('2026-11-05T00:00:00Z'), destinationIbge: '2200000', deliveredUnits: 8,
                legs: [
                    { sequence: 1, legType: 'TRANSFERENCIA', destHubId: 'h1', startedAt: null, completedAt: d('2026-11-02T00:00:00Z') },
                    { sequence: 2, legType: 'ENTREGA', destHubId: null, startedAt: d('2026-11-02T12:00:00Z'), completedAt: d('2026-11-05T00:00:00Z') },
                ],
            }),
            // sem cobertura de referência e sem tentativa
            order({ orderId: 'o3', destinationIbge: '9999999', deliveredUnits: null, deliveredAt: d('2026-11-02T00:00:00Z') }),
            // datas inconsistentes
            order({ orderId: 'o4', deliveredAt: d('2026-10-30T00:00:00Z') }),
        ];
        const r = aggregateOrders(orders, coverage, hubs, period, { ordersDelivered: 4, fetched: 4, limit: 5000 });

        assert.equal(r.coverage.ordersAnalysed, 4);
        assert.equal(r.coverage.truncated, false);
        assert.deepEqual(r.leadTime, { measured: 3, avgHours: 56, medianHours: 48, p90Hours: 96 });
        assert.deepEqual([r.onTime.measured, r.onTime.onTime, r.onTime.percent], [2, 1, 50]);
        assert.match(r.onTime.note, /não é o prazo prometido/i);
        assert.deepEqual([r.complete.measured, r.complete.complete, r.complete.percent], [3, 2, 66.67]);
        assert.equal(r.stoppedByHub.length, 1);
        // o1: 10h -> 16h = 6h; o2: 00h -> 12h = 12h
        assert.deepEqual(r.stoppedByHub[0], { hubId: 'h1', hubName: 'Hub Um', samples: 2, totalHours: 18, avgHours: 9 });
        assert.deepEqual(r.excluded.map((e) => e.count), [1, 1, 1]);
    });
});

describe('loadOrdersReport', () => {
    it('monta as entradas a partir do banco e usa a cobertura de menor prioridade', async () => {
        const db = {
            order: {
                count: async () => 1,
                findMany: async () => [{
                    id: 'o1', createdAt: d('2026-11-01T00:00:00Z'), enteredAtHubAt: null, fimIbgeCode: '2100000',
                    demand: { units: 5 },
                    legs: [{ sequence: 1, legType: 'ENTREGA', destHubId: null, startedAt: null, completedAt: d('2026-11-02T00:00:00Z') }],
                    deliveryAttempts: [{ result: 'DELIVERED', deliveredQuantity: 5, occurredAt: d('2026-11-02T00:00:00Z') }],
                }],
            },
            hubCoverage: {
                findMany: async () => [{ cityIbgeCode: '2100000', leadTimeDays: 2 }, { cityIbgeCode: '2100000', leadTimeDays: 9 }],
            },
            hub: { findMany: async () => [] },
        } as any;
        const r = await loadOrdersReport(period, db);
        assert.deepEqual([r.onTime.measured, r.onTime.onTime], [1, 1]);
        assert.equal(r.complete.percent, 100);
        assert.equal(r.leadTime.avgHours, 24);
    });
});
