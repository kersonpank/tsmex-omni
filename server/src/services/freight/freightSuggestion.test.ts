import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCoverageIndex } from '../hubCargo/consolidationQueue.js';
import type { FreightContext, FreightOrder } from './freightContext.js';
import { computeFreightFromTable } from './freightPricing.js';
import { suggestFreight } from './freightSuggestion.js';

const hubs = [
    { id: 'gru', name: 'Guarulhos', code: 'SP-GRU', state: 'SP', cityIbgeCode: '3518800', active: true },
    { id: 'imp', name: 'Imperatriz', code: 'IMP-MA', state: 'MA', cityIbgeCode: '2105302', active: true },
    { id: 'for', name: 'Fortaleza', code: 'FOR-CE', state: 'CE', cityIbgeCode: '2304400', active: true },
];

function table(id: string, over: Partial<FreightContext['tables'][number]> = {}): FreightContext['tables'][number] {
    return {
        id,
        description: `Tabela ${id}`,
        type: 'GENERAL',
        clientId: null,
        accountId: null,
        routeId: 'gru-imp',
        priority: 0,
        freightUnit: 'RS_KG',
        freightValue: 2,
        minFreightValue: null,
        minFreightRanges: [],
        adValoremPercent: null,
        grisPercent: null,
        tollValue: null,
        tollUnit: null,
        dispatchFee: null,
        otherFees: null,
        icmsIncluded: true,
        icmsPercent: null,
        cubeFactor: null,
        ...over,
    };
}

function fixture(): { order: FreightOrder; ctx: FreightContext } {
    const order = {
        id: 'o1',
        freightTerm: 'CIF',
        currentHubId: 'gru',
        routeId: null,
        fimIbgeCode: '2112803',
        fimPrestacao: 'Viana, MA',
        destinatarioPerson: { id: 'dest', legalName: 'Destinatário', state: 'MA', city: 'Viana', cityIbgeCode: '2112803', clients: [] },
        remetentePerson: { id: 'rem', legalName: 'Remetente', clients: [{ id: 'payer', accountId: 'account' }] },
        consignatarioPerson: null,
        collectionData: { volumes: 2, weight: 100, nfValue: 5000 },
        invoicesRel: [],
        freightCalculations: [],
        invoices: [],
        invoiceItems: [],
    } as unknown as FreightOrder;
    const ctx: FreightContext = {
        hub: { ...hubs[0], personId: 'hub-person' } as FreightContext['hub'],
        emitter: null,
        coverage: buildCoverageIndex(hubs, []),
        hubs: [...hubs],
        citiesByIbge: new Map([
            ['2112803', { name: 'Viana', state: 'MA' }],
            ['2109604', { name: 'Rosário', state: 'MA' }],
        ]),
        routes: [
            { id: 'gru-imp', name: 'GRU → IMP', originCode: 'SP-GRU', destCode: 'IMP-MA' },
            { id: 'gru-for', name: 'GRU → FOR', originCode: 'SP-GRU', destCode: 'FOR-CE' },
        ],
        tables: [table('geral-imp'), table('geral-for', { routeId: 'gru-for' })],
    };
    return { order, ctx };
}

describe('suggestFreight: rotas e opções de tabela', () => {
    it('sem cobertura, uma rota do hub para a UF do IBGE do destino é sugerida com todas as gerais', () => {
        const { order, ctx } = fixture();
        order.destinatarioPerson!.state = 'CE';
        order.fimPrestacao = 'Viana, CE';
        ctx.tables.push(table('geral-imp-2', { freightValue: 3 }), table('geral-imp-3', { freightValue: 4, priority: 2 }));

        const suggestion = suggestFreight(order, ctx);

        assert.deepEqual(suggestion.route, { id: 'gru-imp', label: 'GRU → IMP' });
        assert.equal(suggestion.routeSource, 'uf_fallback');
        assert.equal(suggestion.pricing?.tableId, 'geral-imp-3');
        assert.equal(suggestion.preview?.total, 400);
        assert.deepEqual(suggestion.tableOptions.map((option) => [option.tableId, option.routeId, option.total]), [
            ['geral-imp-3', 'gru-imp', 400],
            ['geral-imp', 'gru-imp', 200],
            ['geral-imp-2', 'gru-imp', 300],
        ]);
        assert.equal(suggestion.noPricingReason, null);
    });

    it('sem cidade no cadastro, usa a UF do destinatário antes da UF textual do fim da prestação', () => {
        const { order, ctx } = fixture();
        ctx.citiesByIbge.clear();
        order.destinatarioPerson!.state = ' ma ';
        order.fimPrestacao = 'Viana, CE';
        assert.equal(suggestFreight(order, ctx).route?.id, 'gru-imp');
    });

    it('sem UF cadastral, usa o fim da prestação no formato Cidade, UF', () => {
        const { order, ctx } = fixture();
        order.fimIbgeCode = null;
        order.destinatarioPerson!.state = null;
        order.fimPrestacao = 'Rosário, ma';
        assert.equal(suggestFreight(order, ctx).route?.id, 'gru-imp');
    });

    it('várias rotas da mesma UF oferecem todas as tabelas, sem escolher rota ou tabela automaticamente', () => {
        const { order, ctx } = fixture();
        ctx.hubs.push({ code: 'SLZ-MA', state: 'MA', active: true });
        ctx.routes.push({ id: 'gru-slz', name: 'GRU → SLZ', originCode: 'SP-GRU', destCode: 'SLZ-MA' });
        ctx.tables.push(table('geral-slz', { routeId: 'gru-slz', priority: 100, freightValue: 3 }));

        const suggestion = suggestFreight(order, ctx);

        assert.equal(suggestion.route, null);
        assert.equal(suggestion.routeSource, 'uf_fallback');
        assert.equal(suggestion.pricing, null);
        assert.equal(suggestion.preview, null);
        assert.deepEqual(suggestion.tableOptions.map((option) => [option.tableId, option.routeLabel]), [
            ['geral-slz', 'GRU → SLZ'],
            ['geral-imp', 'GRU → IMP'],
        ]);
        assert.equal(suggestion.noPricingReason, null);
    });

    it('mantém tabelas sem rota como recomendação mesmo com várias rotas candidatas', () => {
        const { order, ctx } = fixture();
        ctx.hubs.push({ code: 'SLZ-MA', state: 'MA', active: true });
        ctx.routes.push({ id: 'gru-slz', name: 'GRU → SLZ', originCode: 'SP-GRU', destCode: 'SLZ-MA' });
        ctx.tables.push(table('geral-sem-rota', { routeId: null }));

        const suggestion = suggestFreight(order, ctx);

        assert.equal(suggestion.route, null);
        assert.equal(suggestion.pricing?.tableId, 'geral-sem-rota');
        assert.equal(suggestion.pricing?.routeId, null);
        assert.equal(suggestion.tableOptions.length, 2);
    });

    it('inclui especiais do cliente e da conta na rota e sem rota, e todas as gerais aplicáveis, com preços próprios', () => {
        const { order, ctx } = fixture();
        ctx.tables.push(
            table('especial-rota', { type: 'SPECIAL', clientId: 'payer', priority: 1, freightValue: 1 }),
            table('especial-conta', { type: 'SPECIAL', accountId: 'account', routeId: null, freightValue: 1.5 }),
            table('especial-sem-rota', { type: 'SPECIAL', clientId: 'payer', routeId: null, freightValue: 1.2 }),
            table('geral-sem-rota', { routeId: null, freightUnit: 'PERCENT', freightValue: 3 }),
            table('especial-outro-cliente', { type: 'SPECIAL', clientId: 'other' }),
            table('especial-outra-rota', { type: 'SPECIAL', clientId: 'payer', routeId: 'gru-for' }),
        );

        const suggestion = suggestFreight(order, ctx);

        assert.equal(suggestion.pricing?.tableId, 'especial-rota');
        assert.equal(suggestion.tableOptions.length, 5);
        assert.deepEqual(suggestion.tableOptions.map((option) => [option.tableId, option.method, option.source, option.total]), [
            ['especial-rota', 'ESPECIAL', 'payer_special_route', 100],
            ['especial-conta', 'ESPECIAL', 'payer_special', 150],
            ['especial-sem-rota', 'ESPECIAL', 'payer_special', 120],
            ['geral-imp', 'TARIFA_GERAL', 'general_route', 200],
            ['geral-sem-rota', 'TARIFA_GERAL', 'general', 150],
        ]);
        for (const option of suggestion.tableOptions) {
            const source = ctx.tables.find((candidate) => candidate.id === option.tableId)!;
            assert.equal(option.total, computeFreightFromTable(source, suggestion.params).total);
            assert.equal(option.routeLabel, option.routeId == null ? null : 'GRU → IMP');
        }
    });

    it('rota pela cobertura prevalece sobre a rota do pedido e candidatas pela UF', () => {
        const { order, ctx } = fixture();
        ctx.coverage = buildCoverageIndex(hubs, [{ hubId: 'for', cityIbgeCode: '2112803', priority: 1, leadTimeDays: 2 }]);
        order.routeId = 'gru-imp';

        const suggestion = suggestFreight(order, ctx);

        assert.equal(suggestion.route?.id, 'gru-for');
        assert.equal(suggestion.routeSource, 'coverage');
        assert.deepEqual(suggestion.tableOptions.map((option) => option.tableId), ['geral-for']);
    });

    it('preserva a rota explícita do pedido quando não há rota pela cobertura', () => {
        const { order, ctx } = fixture();
        order.routeId = 'gru-for';

        const suggestion = suggestFreight(order, ctx);

        assert.equal(suggestion.route?.id, 'gru-for');
        assert.equal(suggestion.routeSource, 'order');
    });

    it('usa o fallback pela UF quando há cobertura mas falta a rota de preço para o hub coberto', () => {
        const { order, ctx } = fixture();
        ctx.coverage = buildCoverageIndex(
            [...hubs, { id: 'slz', name: 'São Luís', code: 'SLZ-MA', cityIbgeCode: null, active: true }],
            [{ hubId: 'slz', cityIbgeCode: '2112803', priority: 1, leadTimeDays: 2 }],
        );

        const suggestion = suggestFreight(order, ctx);

        assert.equal(suggestion.route?.id, 'gru-imp');
        assert.equal(suggestion.routeSource, 'uf_fallback');
    });

    it('ignora rotas que saem de outro hub e hubs de destino inativos', () => {
        const { order, ctx } = fixture();
        ctx.hubs.push({ code: 'SLZ-MA', state: 'MA', active: false });
        ctx.routes.push(
            { id: 'for-imp', name: 'FOR → IMP', originCode: 'FOR-CE', destCode: 'IMP-MA' },
            { id: 'gru-slz', name: 'GRU → SLZ', originCode: 'SP-GRU', destCode: 'SLZ-MA' },
        );

        assert.equal(suggestFreight(order, ctx).route?.id, 'gru-imp');
    });

    it('explica destino sem cobertura e sem rota de preço para a UF quando não há opções', () => {
        const { order, ctx } = fixture();
        ctx.routes = ctx.routes.filter((candidate) => candidate.id !== 'gru-imp');

        const suggestion = suggestFreight(order, ctx);

        assert.equal(suggestion.routeSource, null);
        assert.deepEqual(suggestion.tableOptions, []);
        assert.equal(suggestion.noPricingReason, 'Viana/MA não tem hub na cobertura e não há rota de preço para MA a partir deste hub. Defina a cobertura ou informe o valor.');
    });

    it('sem tabela na rota conhecida, explica a falta de tabela e mantém o valor informado disponível', () => {
        const { order, ctx } = fixture();
        ctx.tables = [];

        const suggestion = suggestFreight(order, ctx);

        assert.equal(suggestion.route?.id, 'gru-imp');
        assert.deepEqual(suggestion.tableOptions, []);
        assert.match(suggestion.noPricingReason ?? '', /Não há tabela de preço aplicável à rota GRU → IMP/);
        assert.ok(suggestion.blockers.some((blocker) => blocker.includes('informe o valor do frete')));
    });
});
