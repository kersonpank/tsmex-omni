import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOrderStatusWhereInput } from './orderStatusFilter.js';

describe('orderStatusFilter', () => {
    it('ignora status de Demand e mantém apenas OrderStatus', () => {
        const w = parseOrderStatusWhereInput('AT_HUB,IN_TRANSIT,ASSIGNED,COLLECTED');
        assert.deepEqual(w, { in: ['AT_HUB', 'IN_TRANSIT'] });
    });

    it('usa fallback quando nenhum status é válido', () => {
        assert.equal(parseOrderStatusWhereInput('ASSIGNED,COLLECTED'), 'AT_HUB');
    });

    it('aceita status único via query status', () => {
        assert.equal(parseOrderStatusWhereInput(undefined, 'IN_TRANSIT'), 'IN_TRANSIT');
    });
});
