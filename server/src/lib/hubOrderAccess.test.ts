import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildHubOrderVisibilityWhere,
    hubCanAccessOrder,
    shouldApplyLinkOrderScope,
} from './hubOrderAccess.js';

const HUB = 'hub-a';
const OTHER = 'hub-b';

const baseOrder = {
    currentHubId: null as string | null,
    demand: null as { expectedHubId?: string | null } | null,
    legs: [] as any[] | null,
};

describe('hubOrderAccess', () => {
    it('permite quando currentHubId coincide', () => {
        assert.equal(hubCanAccessOrder(HUB, { ...baseOrder, currentHubId: HUB }), true);
    });

    it('permite quando expectedHubId da demanda coincide', () => {
        assert.equal(
            hubCanAccessOrder(HUB, { ...baseOrder, demand: { expectedHubId: HUB } }),
            true,
        );
    });

    it('permite quando manifest.hubId coincide na perna', () => {
        assert.equal(
            hubCanAccessOrder(HUB, { ...baseOrder, legs: [{ manifest: { hubId: HUB, destHubId: null } }] }),
            true,
        );
    });

    it('permite quando manifest.destHubId coincide na perna', () => {
        assert.equal(
            hubCanAccessOrder(HUB, { ...baseOrder, legs: [{ manifest: { hubId: OTHER, destHubId: HUB } }] }),
            true,
        );
    });

    it('nega pedido de outro CD sem vínculo', () => {
        assert.equal(
            hubCanAccessOrder(HUB, {
                currentHubId: OTHER,
                demand: { expectedHubId: OTHER },
                legs: [{ manifest: { hubId: OTHER, destHubId: OTHER } }],
            }),
            false,
        );
    });

    it('buildHubOrderVisibilityWhere monta OR com três critérios', () => {
        const w = buildHubOrderVisibilityWhere(HUB);
        assert.ok('OR' in w && Array.isArray(w.OR));
        assert.equal((w.OR as unknown[]).length, 3);
    });

    it('shouldApplyLinkOrderScope é falso quando usuário também é HUB', () => {
        assert.equal(shouldApplyLinkOrderScope(['LINK', 'HUB']), false);
        assert.equal(shouldApplyLinkOrderScope(['LINK']), true);
    });
});
