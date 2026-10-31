import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseTripEmitter } from './resolveDefaultTripEmitter.js';

const e = (id: string, hubId: string | null, defaultForHub = false) => ({ id, hubId, defaultForHub });

describe('chooseTripEmitter', () => {
    it('usa o padrão do hub', () => {
        assert.equal(chooseTripEmitter([e('a', 'h'), e('b', 'h', true)], 'h')?.id, 'b');
    });
    it('usa o único emitente do hub', () => {
        assert.equal(chooseTripEmitter([e('a', 'h'), e('x', 'other')], 'h')?.id, 'a');
    });
    it('é ambíguo com vários no hub sem padrão', () => {
        assert.equal(chooseTripEmitter([e('a', 'h'), e('b', 'h')], 'h'), null);
    });
    it('cai no padrão geral', () => {
        assert.equal(chooseTripEmitter([e('g', null, true), e('x', 'other')], 'h')?.id, 'g');
    });
    it('cai no único ativo no total', () => {
        assert.equal(chooseTripEmitter([e('x', 'other')], 'h')?.id, 'x');
        assert.equal(chooseTripEmitter([e('x', 'o1'), e('y', 'o2')], 'h'), null);
    });
    it('sem emitentes devolve null', () => {
        assert.equal(chooseTripEmitter([], 'h'), null);
    });
});
