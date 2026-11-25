import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import {
    buildCoverageIndex,
    buildRouteIndex,
    getConsolidationQueues,
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
        assert.deepEqual(groups[2].routeBreakdown, []);
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

describe('quebra da fila por rota do hub final', () => {
    const CODO = '2103307';

    it('separa dois hubs finais e duas rotas no mesmo TRANSFER, mantendo os totais do grupo', () => {
        const coverage = buildCoverageIndex([GRU, SLZ, { ...IMP, gatewayHubId: SLZ.id }], [
            { hubId: IMP.id, cityIbgeCode: ACAILANDIA, priority: 1, leadTimeDays: 2 },
            { hubId: SLZ.id, cityIbgeCode: CODO, priority: 1, leadTimeDays: 4 },
        ]);
        const routes = buildRouteIndex([
            {
                id: 'oeste', hubId: IMP.id, name: 'Rota Oeste',
                stops: [{ cityIbgeCode: ACAILANDIA, sequence: 2 }, { cityIbgeCode: IMP.cityIbgeCode, sequence: 1 }],
            },
            { id: 'leste', hubId: SLZ.id, name: 'Rota Leste', stops: [{ cityIbgeCode: CODO, sequence: 1 }] },
        ]);
        const groups = groupOrdersByNextHop([
            order({ id: 'codo', fimIbgeCode: CODO, finalCityLabel: 'Codó/MA', weightKg: 50, volumeM3: 1.5 }),
            order({ id: 'ac1', fimIbgeCode: ACAILANDIA, finalCityLabel: 'Açailândia/MA', weightKg: 20.5, volumeM3: 0.25 }),
            order({ id: 'imperatriz', fimIbgeCode: IMP.cityIbgeCode, finalCityLabel: 'Imperatriz/MA', weightKg: 75, volumeM3: 0.5 }),
            order({ id: 'ac2', fimIbgeCode: ACAILANDIA, finalCityLabel: 'Açailândia/MA', weightKg: 19.5, volumeM3: 0.75 }),
        ], coverage, GRU.id, routes);

        assert.equal(groups.length, 1);
        const [group] = groups;
        assert.equal(group.key, 'TRANSFER:slz');
        assert.deepEqual(group.routeBreakdown, [
            {
                key: 'imp:oeste', finalHubId: IMP.id, finalHubName: IMP.name, routeId: 'oeste', routeName: 'Rota Oeste',
                ambiguous: false, orderIds: ['ac1', 'imperatriz', 'ac2'], orderCount: 3, weightKg: 115, volumeM3: 1.5,
                cities: ['Imperatriz/MA', 'Açailândia/MA'],
            },
            {
                key: 'slz:leste', finalHubId: SLZ.id, finalHubName: SLZ.name, routeId: 'leste', routeName: 'Rota Leste',
                ambiguous: false, orderIds: ['codo'], orderCount: 1, weightKg: 50, volumeM3: 1.5, cities: ['Codó/MA'],
            },
        ]);
        assert.equal(group.routeBreakdown.reduce((sum, route) => sum + route.weightKg, 0), group.totalWeightKg);
        assert.equal(group.routeBreakdown.reduce((sum, route) => sum + route.volumeM3, 0), group.totalVolumeM3);
    });

    it('usa a primeira rota ativa por nome em LOCAL e reúne cidades sem rota em ordem alfabética', () => {
        const coverage = buildCoverageIndex([IMP, SLZ], [
            { hubId: IMP.id, cityIbgeCode: ACAILANDIA, priority: 1, leadTimeDays: null },
            { hubId: IMP.id, cityIbgeCode: CODO, priority: 1, leadTimeDays: null },
        ]);
        const stops = [{ cityIbgeCode: ACAILANDIA, sequence: 1 }];
        const routes = buildRouteIndex([
            { id: 'z', hubId: IMP.id, name: 'Rota Z', stops },
            { id: 'b', hubId: IMP.id, name: 'Rota B', stops },
            { id: 'inactive', hubId: IMP.id, name: 'Rota A', stops, active: false },
            { id: 'other-hub', hubId: SLZ.id, name: 'Rota A', stops },
        ]);
        const [group] = groupOrdersByNextHop([
            order({ id: 'imperatriz', fimIbgeCode: IMP.cityIbgeCode, finalCityLabel: 'Imperatriz/MA' }),
            order({ id: 'ac', fimIbgeCode: ACAILANDIA, finalCityLabel: 'Açailândia/MA' }),
            order({ id: 'codo', fimIbgeCode: CODO, finalCityLabel: 'Codó/MA' }),
        ], coverage, IMP.id, routes);

        assert.equal(group.key, 'LOCAL');
        assert.deepEqual(group.routeBreakdown, [
            {
                key: 'imp:none', finalHubId: IMP.id, finalHubName: IMP.name, routeId: null, routeName: null,
                ambiguous: false, orderIds: ['imperatriz', 'codo'], orderCount: 2, weightKg: 200, volumeM3: 2,
                cities: ['Codó/MA', 'Imperatriz/MA'],
            },
            {
                key: 'imp:b', finalHubId: IMP.id, finalHubName: IMP.name, routeId: 'b', routeName: 'Rota B',
                ambiguous: true, orderIds: ['ac'], orderCount: 1, weightKg: 100, volumeM3: 1, cities: ['Açailândia/MA'],
            },
        ]);
        assert.equal(group.routeBreakdown.reduce((sum, route) => sum + route.weightKg, 0), group.totalWeightKg);
        assert.equal(group.routeBreakdown.reduce((sum, route) => sum + route.volumeM3, 0), group.totalVolumeM3);
    });
});

it('carrega as rotas ativas em uma consulta e usa as cidades cadastradas e as medidas da demanda', async (t) => {
    const originals = {
        orders: prisma.order.findMany,
        hubs: prisma.hub.findMany,
        coverage: prisma.hubCoverage.findMany,
        routes: prisma.hubRoute.findMany,
    };
    t.after(() => {
        prisma.order.findMany = originals.orders;
        prisma.hub.findMany = originals.hubs;
        prisma.hubCoverage.findMany = originals.coverage;
        prisma.hubRoute.findMany = originals.routes;
    });

    const storedOrder = (id: string, fimIbgeCode: string, weight: number, volume: number) => ({
        id,
        fimIbgeCode,
        enteredAtHubAt: null,
        createdAt: new Date('2026-10-01T10:00:00Z'),
        nfNumber: null,
        freightCalculations: [],
        demand: { orderNumber: 1, destination: 'A definir', weight, volume, nfValue: 1000 },
    });
    prisma.order.findMany = (async () => [
        storedOrder('ac', ACAILANDIA, 32.5, 1.25),
        storedOrder('imp', IMP.cityIbgeCode, 25, 0.5),
        storedOrder('slz', SLZ.cityIbgeCode, 40, 2),
    ]) as unknown as typeof originals.orders;
    prisma.hub.findMany = (async () => [
        { ...GRU, city: 'Guarulhos', state: 'SP' },
        { ...SLZ, city: 'São Luís', state: 'MA' },
        { ...IMP, city: 'Imperatriz', state: 'MA', gatewayHubId: SLZ.id },
    ]) as unknown as typeof originals.hubs;
    prisma.hubCoverage.findMany = (async () => [
        { hubId: IMP.id, cityIbgeCode: ACAILANDIA, cityName: 'Açailândia', state: 'MA', priority: 1, leadTimeDays: 2 },
    ]) as unknown as typeof originals.coverage;
    const findRoutes = t.mock.fn(async (args: Prisma.HubRouteFindManyArgs) => {
        assert.deepEqual(args.where, { active: true });
        assert.ok(args.select?.stops);
        return [
            { id: 'oeste', hubId: IMP.id, name: 'Rota Oeste', stops: [{ cityIbgeCode: ACAILANDIA, sequence: 1 }] },
            { id: 'leste', hubId: SLZ.id, name: 'Rota Leste', stops: [{ cityIbgeCode: SLZ.cityIbgeCode, sequence: 1 }] },
        ];
    });
    prisma.hubRoute.findMany = findRoutes as unknown as typeof originals.routes;

    const groups = await getConsolidationQueues(GRU.id);

    assert.equal(findRoutes.mock.callCount(), 1);
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.equal(group.key, 'TRANSFER:slz');
    assert.equal(group.totalWeightKg, 97.5);
    assert.equal(group.totalVolumeM3, 3.75);
    assert.deepEqual(group.routeBreakdown.map(({ key, cities, weightKg, volumeM3 }) => ({ key, cities, weightKg, volumeM3 })), [
        { key: 'slz:leste', cities: ['São Luís/MA'], weightKg: 40, volumeM3: 2 },
        { key: 'imp:oeste', cities: ['Açailândia/MA'], weightKg: 32.5, volumeM3: 1.25 },
        { key: 'imp:none', cities: ['Imperatriz/MA'], weightKg: 25, volumeM3: 0.5 },
    ]);
    assert.equal(group.orders[0].destination, 'A definir');
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
