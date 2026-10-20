import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildCoverageIndex,
    groupOrdersByNextHop,
    resolveNextHop,
    IMPLICIT_PRIORITY,
    type QueueOrderInput,
} from './consolidationQueue.js';

const GRU = { id: 'gru', name: 'HUB Guarulhos', code: 'GRU-SP', cityIbgeCode: '3518800', active: true };
const IMP = { id: 'imp', name: 'HUB Imperatriz', code: 'IMP-MA', cityIbgeCode: '2105302', active: true };
const SLZ = { id: 'slz', name: 'HUB São Luís', code: 'SLZ-MA', cityIbgeCode: '2111300', active: true };
const ACAILANDIA = '2100055';

function order(partial: Partial<QueueOrderInput>): QueueOrderInput {
    return {
        id: Math.random().toString(36).slice(2),
        orderNumber: 1,
        nfNumber: null,
        fimIbgeCode: null,
        sinceAt: new Date('2026-10-01T10:00:00Z'),
        destinationLabel: null,
        weightKg: 100,
        volumeM3: 1,
        valueBRL: 1000,
        ...partial,
    };
}

describe('buildCoverageIndex', () => {
    it('cidade do próprio hub vale como cobertura implícita, perdendo da explícita', () => {
        const index = buildCoverageIndex([GRU, IMP], [
            { hubId: 'gru', cityIbgeCode: IMP.cityIbgeCode!, priority: 10, leadTimeDays: null },
        ]);
        const targets = index.get(IMP.cityIbgeCode!)!;
        assert.equal(targets[0].hubId, 'gru'); // explícita (prioridade 10) vence
        assert.equal(targets[1].hubId, 'imp');
        assert.equal(targets[1].priority, IMPLICIT_PRIORITY);
        assert.equal(targets[1].implicit, true);
    });

    it('hub inativo não entra na tabela de roteamento', () => {
        const index = buildCoverageIndex(
            [{ ...IMP, active: false }],
            [{ hubId: 'imp', cityIbgeCode: ACAILANDIA, priority: 1, leadTimeDays: 2 }],
        );
        assert.equal(index.get(ACAILANDIA), undefined);
        assert.equal(index.get(IMP.cityIbgeCode!), undefined);
    });
});

describe('resolveNextHop', () => {
    const index = buildCoverageIndex([GRU, IMP], [
        { hubId: 'imp', cityIbgeCode: ACAILANDIA, priority: 1, leadTimeDays: 2 },
    ]);

    it('destino coberto por outro hub → TRANSFER para ele', () => {
        const hop = resolveNextHop(index, ACAILANDIA, 'gru');
        assert.equal(hop.kind, 'TRANSFER');
        assert.equal(hop.kind === 'TRANSFER' && hop.target.hubId, 'imp');
    });

    it('destino coberto pelo hub atual → LOCAL (distribuição daqui)', () => {
        assert.equal(resolveNextHop(index, ACAILANDIA, 'imp').kind, 'LOCAL');
    });

    it('sem IBGE ou sem cobertura → UNROUTED (o buraco fica visível, nunca some)', () => {
        assert.equal(resolveNextHop(index, null, 'gru').kind, 'UNROUTED');
        assert.equal(resolveNextHop(index, '9999999', 'gru').kind, 'UNROUTED');
    });
});

describe('groupOrdersByNextHop', () => {
    const index = buildCoverageIndex([GRU, IMP, SLZ], [
        { hubId: 'imp', cityIbgeCode: ACAILANDIA, priority: 1, leadTimeDays: 2 },
    ]);

    it('agrupa por próximo salto com agregados e mais antigo primeiro dentro do grupo', () => {
        const groups = groupOrdersByNextHop(
            [
                order({ id: 'a', fimIbgeCode: IMP.cityIbgeCode, weightKg: 300, sinceAt: new Date('2026-10-03') }),
                order({ id: 'b', fimIbgeCode: ACAILANDIA, weightKg: 200, sinceAt: new Date('2026-10-01') }),
                order({ id: 'c', fimIbgeCode: SLZ.cityIbgeCode, weightKg: 100 }),
                order({ id: 'd', fimIbgeCode: null }),
            ],
            index,
            'gru',
        );
        // Açailândia roteia via IMP (explícita) e junta com o pedido de Imperatriz (implícita).
        const imp = groups.find((g) => g.destHubId === 'imp')!;
        assert.equal(imp.orders.length, 2);
        assert.equal(imp.totalWeightKg, 500);
        assert.equal(imp.orders[0].orderId, 'b'); // mais antigo primeiro
        assert.equal(imp.oldestSinceAt, new Date('2026-10-01').toISOString());

        const slz = groups.find((g) => g.destHubId === 'slz')!;
        assert.equal(slz.orders.length, 1);

        // Ordenação: TRANSFER por peso desc, UNROUTED por último.
        assert.deepEqual(groups.map((g) => g.kind), ['TRANSFER', 'TRANSFER', 'UNROUTED']);
        assert.equal(groups[0].destHubId, 'imp');
    });

    it('pedido para a própria cidade do hub vira grupo LOCAL', () => {
        const groups = groupOrdersByNextHop(
            [order({ fimIbgeCode: IMP.cityIbgeCode })],
            index,
            'imp',
        );
        assert.equal(groups[0].kind, 'LOCAL');
        assert.equal(groups[0].destHubId, null);
    });
});
