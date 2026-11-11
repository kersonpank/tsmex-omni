import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildCoverageIndex,
    groupOrdersByNextHop,
    resolveNextHop,
    resolveFinalHub,
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

describe('freightDocState na fila', () => {
    const index = buildCoverageIndex([GRU, IMP], [
        { hubId: 'imp', cityIbgeCode: ACAILANDIA, priority: 1, leadTimeDays: 2 },
    ]);

    it('item carrega o estado do documento do frete; ausente vira none', () => {
        const groups = groupOrdersByNextHop(
            [
                order({ id: 'a', fimIbgeCode: ACAILANDIA, freightDocState: 'emitted' }),
                order({ id: 'b', fimIbgeCode: ACAILANDIA, freightDocState: 'rejected' }),
                order({ id: 'c', fimIbgeCode: ACAILANDIA }),
            ],
            index,
            'gru',
        );
        const byId = Object.fromEntries(groups[0].orders.map((o) => [o.orderId, o.freightDocState]));
        assert.deepEqual(byId, { a: 'emitted', b: 'rejected', c: 'none' });
    });
});

describe('próximo salto por gateways (hub-and-spoke)', () => {
    const SMT = { id: 'smt', name: 'HUB São Mateus', code: 'SMT-MA', cityIbgeCode: '2109908', active: true };
    const hub = (h: typeof GRU, gatewayHubId: string | null) => ({ ...h, gatewayHubId });
    const next = (index: ReturnType<typeof buildCoverageIndex>, city: string, from: string) => {
        const hop = resolveNextHop(index, city, from);
        return hop.kind === 'TRANSFER' ? hop.target.hubId : hop.kind;
    };

    it('(a) SMT abastecida por SLZ: GRU→SLZ, SLZ→SMT, SMT→LOCAL', () => {
        const index = buildCoverageIndex([hub(GRU, null), hub(SLZ, null), hub(SMT, 'slz')], []);
        assert.equal(next(index, SMT.cityIbgeCode!, 'gru'), 'slz');
        assert.equal(next(index, SMT.cityIbgeCode!, 'slz'), 'smt');
        assert.equal(next(index, SMT.cityIbgeCode!, 'smt'), 'LOCAL');
        const hop = resolveNextHop(index, SMT.cityIbgeCode!, 'gru');
        assert.equal(hop.kind === 'TRANSFER' && hop.final.hubId, 'smt');
    });

    it('(b) sem gateways o comportamento é o de antes (direto ao hub responsável)', () => {
        const index = buildCoverageIndex([hub(GRU, null), hub(SLZ, null), hub(SMT, null)], []);
        assert.equal(next(index, SMT.cityIbgeCode!, 'gru'), 'smt');
        assert.equal(next(index, SMT.cityIbgeCode!, 'slz'), 'smt');
    });

    it('(c) cadeia de 3 níveis IMP ← ACA ← X', () => {
        const ACA = { id: 'aca', name: 'HUB Açailândia', code: 'ACA-MA', cityIbgeCode: ACAILANDIA, active: true };
        const index = buildCoverageIndex([hub(GRU, null), hub(SLZ, null), hub(ACA, 'slz'), hub(IMP, 'aca')], []);
        assert.equal(next(index, IMP.cityIbgeCode!, 'gru'), 'slz');
        assert.equal(next(index, IMP.cityIbgeCode!, 'slz'), 'aca');
        assert.equal(next(index, IMP.cityIbgeCode!, 'aca'), 'imp');
        assert.equal(next(index, IMP.cityIbgeCode!, 'imp'), 'LOCAL');
    });

    it('(d) ciclo A→B→A não trava e é tratado como sem gateway', () => {
        const index = buildCoverageIndex([hub(GRU, null), hub(SLZ, 'smt'), hub(SMT, 'slz')], []);
        assert.equal(next(index, SMT.cityIbgeCode!, 'gru'), 'smt');
        assert.equal(next(index, SMT.cityIbgeCode!, 'slz'), 'smt');
        assert.equal(next(index, GRU.cityIbgeCode!, 'smt'), 'gru');
    });

    it('(e) sentido inverso: SMT→cidade de GRU sobe pelo gateway de SMT', () => {
        const index = buildCoverageIndex([hub(GRU, null), hub(SLZ, null), hub(SMT, 'slz')], []);
        assert.equal(next(index, GRU.cityIbgeCode!, 'smt'), 'slz');
        assert.equal(next(index, GRU.cityIbgeCode!, 'slz'), 'gru');
    });

    it('gateway inativo é ignorado', () => {
        const index = buildCoverageIndex([hub(GRU, null), hub({ ...SLZ, active: false }, null), hub(SMT, 'slz')], []);
        assert.equal(next(index, SMT.cityIbgeCode!, 'gru'), 'smt');
    });

    it('fila agrupa pelo próximo salto e informa o hub final e o prazo', () => {
        const index = buildCoverageIndex(
            [hub(GRU, null), hub(SLZ, null), hub(SMT, 'slz')],
            [{ hubId: 'smt', cityIbgeCode: SMT.cityIbgeCode!, priority: 1, leadTimeDays: 4 }],
        );
        const groups = groupOrdersByNextHop(
            [order({ id: 'x', fimIbgeCode: SMT.cityIbgeCode }), order({ id: 'y', fimIbgeCode: SLZ.cityIbgeCode })],
            index,
            'gru',
        );
        assert.equal(groups.length, 1);
        const g = groups[0];
        assert.equal(g.key, 'TRANSFER:slz');
        assert.equal(g.destHubId, 'slz');
        const x = g.orders.find((o) => o.orderId === 'x')!;
        assert.equal(x.finalHubId, 'smt');
        assert.equal(x.finalHubCode, 'SMT-MA');
        assert.equal(x.leadTimeDays, 4);
        const y = g.orders.find((o) => o.orderId === 'y')!;
        assert.equal(y.finalHubId, null);
        assert.equal(g.finalHubId, null); // finais diferentes → sem final único no grupo
        const only = groupOrdersByNextHop([order({ fimIbgeCode: SMT.cityIbgeCode })], index, 'gru')[0];
        assert.equal(only.finalHubId, 'smt');
        assert.equal(only.leadTimeDays, 4);
    });
});

describe('resolveFinalHub', () => {
    it('é o hub responsável pela cidade, independente de gateways', () => {
        const SMT = { id: 'smt', name: 'HUB São Mateus', code: 'SMT-MA', cityIbgeCode: '2109908', active: true };
        const index = buildCoverageIndex([{ ...GRU, gatewayHubId: null }, { ...SLZ, gatewayHubId: null }, { ...SMT, gatewayHubId: 'slz' }], []);
        assert.equal(resolveFinalHub(index, SMT.cityIbgeCode)?.hubId, 'smt');
        assert.equal(resolveFinalHub(index, null), null);
    });
});
