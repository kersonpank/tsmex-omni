import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTripPriceEstimate } from './tripPriceEstimateService.js';

describe('buildTripPriceEstimate', () => {
    it('returns READY when customer revenue, Link freight, toll and ANTT floor are known', () => {
        const result = buildTripPriceEstimate({
            orderFreights: [800, 700],
            orderFreightMissingCount: 0,
            suggestedFreteBruto: 900,
            suggestedPedagio: 100,
            anttMinimumFreight: 850,
        });

        assert.equal(result.status, 'READY');
        assert.equal(result.commercialRevenue, 1500);
        assert.equal(result.suggestedTotalCost, 1000);
        assert.equal(result.floorComparison, 'ABOVE');
        assert.equal(result.marginEstimate, 500);
        assert.deepEqual(result.issues, []);
    });

    it('returns PARTIAL and never invents toll or total cost when route toll is unknown', () => {
        const result = buildTripPriceEstimate({
            orderFreights: [1000],
            orderFreightMissingCount: 0,
            suggestedFreteBruto: 750,
            suggestedPedagio: null,
            anttMinimumFreight: null,
        });

        assert.equal(result.status, 'PARTIAL');
        assert.equal(result.suggestedPedagio, null);
        assert.equal(result.suggestedTotalCost, null);
        assert.equal(result.marginEstimate, null);
        assert.equal(result.floorComparison, 'UNAVAILABLE');
        assert.ok(result.issues.some((item) => item.code === 'TOLL_UNAVAILABLE'));
        assert.ok(result.issues.some((item) => item.code === 'ANTT_FLOOR_UNAVAILABLE'));
    });

    it('flags BELOW when Link freight is below known ANTT floor without overwriting negotiation', () => {
        const result = buildTripPriceEstimate({
            orderFreights: [2000],
            orderFreightMissingCount: 0,
            suggestedFreteBruto: 900,
            suggestedPedagio: 0,
            anttMinimumFreight: 1100,
        });

        assert.equal(result.suggestedFreteBruto, 900);
        assert.equal(result.anttMinimumFreight, 1100);
        assert.equal(result.floorComparison, 'BELOW');
        assert.ok(result.issues.some((item) => item.code === 'ANTT_FLOOR_BELOW'));
    });

    it('keeps commercial revenue partial when orders have no official freight', () => {
        const result = buildTripPriceEstimate({
            orderFreights: [500],
            orderFreightMissingCount: 2,
            suggestedFreteBruto: null,
            suggestedPedagio: null,
            anttMinimumFreight: null,
        });

        assert.equal(result.status, 'PARTIAL');
        assert.equal(result.commercialRevenue, 500);
        assert.equal(result.suggestedFreteBruto, null);
        assert.equal(result.marginEstimate, null);
        assert.ok(result.issues.some((item) => item.code === 'ORDER_FREIGHT_MISSING'));
        assert.ok(result.issues.some((item) => item.code === 'LINK_FREIGHT_UNAVAILABLE'));
    });
});
