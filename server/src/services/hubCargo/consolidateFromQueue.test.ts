import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { feedbackActionFor, ordersOutsideQueue } from './consolidateFromQueue.js';

describe('feedbackActionFor — sugerido (fila) × final (viagem)', () => {
    it('mesmo conjunto, em qualquer ordem → ACCEPTED', () => {
        assert.equal(feedbackActionFor(['a', 'b', 'c'], ['c', 'a', 'b']), 'ACCEPTED');
    });

    it('operador tirou pedido da sugestão → MODIFIED', () => {
        assert.equal(feedbackActionFor(['a', 'b', 'c'], ['a', 'b']), 'MODIFIED');
    });

    it('motor recusou um pedido (capacidade) e o final ficou menor → MODIFIED', () => {
        assert.equal(feedbackActionFor(['a', 'b'], ['a']), 'MODIFIED');
    });

    it('duplicata no final não engana a comparação', () => {
        assert.equal(feedbackActionFor(['a', 'b'], ['a', 'a']), 'MODIFIED');
    });
});

describe('ordersOutsideQueue', () => {
    it('aponta pedidos escolhidos que não estão mais na fila', () => {
        assert.deepEqual(ordersOutsideQueue(['a', 'b'], ['a', 'x']), ['x']);
    });

    it('subconjunto da fila é válido', () => {
        assert.deepEqual(ordersOutsideQueue(['a', 'b', 'c'], ['c']), []);
    });
});
