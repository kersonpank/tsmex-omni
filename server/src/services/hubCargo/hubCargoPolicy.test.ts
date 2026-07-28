import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getManifestOrderEligibility } from './hubCargoPolicy.js';

const manifest = {
    id: 'manifest-1',
    status: 'DRAFT' as const,
    hubId: 'hub-1',
    startsWithCollection: false,
};

const stockOrder = {
    status: 'AT_HUB' as const,
    currentHubId: 'hub-1',
    demand: { expectedHubId: 'hub-1' },
};

describe('getManifestOrderEligibility', () => {
    it('aceita estoque fisicamente no Hub de origem', () => {
        const result = getManifestOrderEligibility(manifest, stockOrder);
        assert.equal(result.eligible, true);
        assert.equal(result.allocationMode, 'HUB_STOCK');
    });

    it('rejeita pedido em outro Hub para viagem comum', () => {
        const result = getManifestOrderEligibility(manifest, {
            ...stockOrder,
            currentHubId: 'hub-2',
        });
        assert.equal(result.eligible, false);
        assert.equal(result.code, 'ORDER_NOT_AT_ORIGIN_HUB');
    });

    it('aceita pedido pendente em viagem iniciada por coleta', () => {
        const result = getManifestOrderEligibility(
            { ...manifest, startsWithCollection: true },
            {
                status: 'PENDING',
                currentHubId: null,
                demand: { expectedHubId: 'hub-1' },
            },
        );
        assert.equal(result.eligible, true);
        assert.equal(result.allocationMode, 'COLLECTION');
    });

    it('rejeita coleta esperada em outro Hub', () => {
        const result = getManifestOrderEligibility(
            { ...manifest, startsWithCollection: true },
            {
                status: 'PENDING',
                currentHubId: null,
                demand: { expectedHubId: 'hub-2' },
            },
        );
        assert.equal(result.eligible, false);
        assert.equal(result.code, 'ORDER_EXPECTED_AT_ANOTHER_HUB');
    });

    it('rejeita pedido presente em outra viagem ativa', () => {
        const result = getManifestOrderEligibility(manifest, stockOrder, {
            manifestId: 'manifest-2',
        });
        assert.equal(result.eligible, false);
        assert.equal(result.code, 'ORDER_IN_ANOTHER_ACTIVE_TRIP');
        assert.equal(result.conflictingManifestId, 'manifest-2');
    });
});
