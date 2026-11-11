import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateGatewayAssignment } from './hubGateway.js';

const hubs = [
    { id: 'a', active: true, gatewayHubId: null },
    { id: 'b', active: true, gatewayHubId: 'a' },
    { id: 'c', active: true, gatewayHubId: 'b' },
    { id: 'off', active: false, gatewayHubId: null },
];

describe('validateGatewayAssignment', () => {
    it('aceita tronco válido, null e hub novo', () => {
        assert.doesNotThrow(() => validateGatewayAssignment('c', 'a', hubs));
        assert.doesNotThrow(() => validateGatewayAssignment('a', null, hubs));
        assert.doesNotThrow(() => validateGatewayAssignment(null, 'b', hubs));
    });
    it('rejeita inexistente, inativo, o próprio hub e ciclo com 400', () => {
        for (const [id, gw, msg] of [
            ['c', 'zzz', /não existe/],
            ['c', 'off', /inativo/],
            ['c', 'c', /próprio/],
            ['a', 'c', /ciclo/],
            ['a', 'b', /ciclo/],
        ] as const) {
            assert.throws(() => validateGatewayAssignment(id, gw, hubs), (e: any) => e.statusCode === 400 && msg.test(e.message));
        }
    });
});
