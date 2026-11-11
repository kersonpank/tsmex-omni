import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitCentsAcrossLegs } from './revenueSplit.js';

describe('splitCentsAcrossLegs', () => {
    it('perna única recebe tudo', () => {
        const r = splitCentsAcrossLegs(50947, [{ key: 'a', sequence: 1, allocatedCost: null }]);
        assert.equal(r.get('a'), 50947);
    });

    it('sem custo em alguma perna: partes iguais (resto de centavo vai para a primeira perna)', () => {
        const r = splitCentsAcrossLegs(10001, [
            { key: 'b', sequence: 2, allocatedCost: 40 },
            { key: 'a', sequence: 1, allocatedCost: null },
        ]);
        assert.equal(r.get('a'), 5001);
        assert.equal(r.get('b'), 5000);
    });

    it('todas com custo: proporcional ao custo alocado', () => {
        const r = splitCentsAcrossLegs(100000, [
            { key: 'tronco', sequence: 1, allocatedCost: 300 },
            { key: 'entrega', sequence: 2, allocatedCost: 100 },
        ]);
        assert.equal(r.get('tronco'), 75000);
        assert.equal(r.get('entrega'), 25000);
    });

    it('custos todos zero: cai em partes iguais', () => {
        const r = splitCentsAcrossLegs(1000, [
            { key: 'a', sequence: 1, allocatedCost: 0 },
            { key: 'b', sequence: 2, allocatedCost: 0 },
        ]);
        assert.equal(r.get('a'), 500);
        assert.equal(r.get('b'), 500);
    });

    it('é determinístico: a ordem de entrada não muda o resultado', () => {
        const legs = [
            { key: 'x', sequence: 1, allocatedCost: 33.33 },
            { key: 'y', sequence: 2, allocatedCost: 33.33 },
            { key: 'z', sequence: 3, allocatedCost: 33.34 },
        ];
        const a = splitCentsAcrossLegs(50947, legs);
        const b = splitCentsAcrossLegs(50947, [...legs].reverse());
        assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
    });

    it('propriedade: a soma das partes é sempre exatamente o total', () => {
        let seed = 12345;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        for (let i = 0; i < 500; i++) {
            const n = 1 + Math.floor(rnd() * 5);
            const withCosts = rnd() > 0.4;
            const legs = Array.from({ length: n }, (_, k) => ({
                key: `l${k}`,
                sequence: k + 1,
                allocatedCost: withCosts ? Math.round(rnd() * 100000) / 100 : rnd() > 0.5 ? null : 10,
            }));
            const total = Math.floor(rnd() * 5_000_000);
            const parts = splitCentsAcrossLegs(total, legs);
            const sum = [...parts.values()].reduce((a, b) => a + b, 0);
            assert.equal(sum, total, `total=${total} legs=${JSON.stringify(legs)}`);
            for (const v of parts.values()) assert.ok(Number.isInteger(v) && v >= 0);
        }
    });
});
