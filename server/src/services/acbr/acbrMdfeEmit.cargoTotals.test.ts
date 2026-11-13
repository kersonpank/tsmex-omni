import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveMdfeCargoTotals } from './acbrMdfeEmit.js';
import { sumDistinctOrderWeight } from '../manifestFiscalClosureService.js';

describe('MDF-e: fonte dos totais da carga por emitente', () => {
    // Contador da viagem com peso taxado (cubado maior que o real) e pedidos com peso real.
    const tripTotals = { totalValue: 3500, totalWeight: 350 };
    const orders = [{ nfValue: 1000, weight: 100 }, { nfValue: 2000, weight: 180 }];

    it('uma UF com TRIP_COUNTER usa os totais da viagem', () => {
        assert.deepEqual(resolveMdfeCargoTotals({ multiUf: false, source: 'TRIP_COUNTER', tripTotals, orders }), { totalValue: 3500, totalWeight: 350 });
    });

    it('uma UF sem fonte definida mantém os totais da viagem', () => {
        assert.deepEqual(resolveMdfeCargoTotals({ multiUf: false, tripTotals, orders }), { totalValue: 3500, totalWeight: 350 });
        assert.deepEqual(resolveMdfeCargoTotals({ multiUf: false, source: null, tripTotals, orders }), { totalValue: 3500, totalWeight: 350 });
    });

    it('uma UF com ORDER_REAL_WEIGHT soma valor da NF e peso real dos pedidos', () => {
        assert.deepEqual(resolveMdfeCargoTotals({ multiUf: false, source: 'ORDER_REAL_WEIGHT', tripTotals, orders }), { totalValue: 3000, totalWeight: 280 });
    });

    it('várias UFs somam os pedidos do documento nos dois modos', () => {
        assert.deepEqual(resolveMdfeCargoTotals({ multiUf: true, source: 'TRIP_COUNTER', tripTotals, orders }), { totalValue: 3000, totalWeight: 280 });
        assert.deepEqual(resolveMdfeCargoTotals({ multiUf: true, source: 'ORDER_REAL_WEIGHT', tripTotals, orders }), { totalValue: 3000, totalWeight: 280 });
    });

    it('encerramento do CIOT: pedido em mais de uma perna conta uma vez', () => {
        const leg = (orderId: string, weight: number) => ({ orderId, order: { demand: { weight } } });
        assert.equal(sumDistinctOrderWeight([leg('o1', 100), leg('o1', 100), leg('o2', 180)]), 280);
        assert.equal(sumDistinctOrderWeight([]), 0);
    });
});
