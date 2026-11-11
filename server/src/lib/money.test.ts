import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { roundMoney, sumMoney } from './money.js';

describe('money', () => {
    it('arredonda para 2 casas', () => {
        assert.equal(roundMoney(509.4700000001), 509.47);
        assert.equal(roundMoney(1.005), 1.01);
        assert.equal(roundMoney(0.1 + 0.2), 0.3);
        assert.equal(roundMoney(Number.NaN), 0);
    });
    it('soma em centavos', () => {
        assert.equal(sumMoney([0.1, 0.2, 0.3]), 0.6);
        assert.equal(sumMoney([]), 0);
    });
});
