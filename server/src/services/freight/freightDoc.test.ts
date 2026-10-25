import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeFreightFromTable, informedFreight, orderFreightParams, type PricingTableLike } from './freightPricing.js';
import { allowedDocTypes, choosePricingTable, freightDocState, payerChangeBlock, payerRole, type TableCandidate } from './freightDocRules.js';
import { pickEmitter, type FreightContext, type FreightOrder } from './freightContext.js';
import { suggestFreight, summarizeDocuments } from './freightSuggestion.js';
import { buildCoverageIndex } from '../hubCargo/consolidationQueue.js';

const baseTable: PricingTableLike = {
    freightUnit: 'RS_KG',
    freightValue: 2,
    minFreightValue: 50,
    minFreightRanges: [],
    adValoremPercent: 3,
    grisPercent: 1,
    tollValue: 0.1,
    tollUnit: 'RS_KG',
    dispatchFee: 10,
    otherFees: 5,
    icmsIncluded: false,
    icmsPercent: 12,
    cubeFactor: 300,
};

describe('computeFreightFromTable', () => {
    it('peso efetivo = maior entre real e cubado; ad valorem/GRIS por R$ 1.000; ICMS por fora', () => {
        // 0,5 m³ × 300 = 150 kg cubado > 100 kg real
        const r = computeFreightFromTable(baseTable, { volumes: 2, weight: 100, cubage: 0.5, nfValue: 10_000 });
        assert.equal(r.effectiveWeight, 150);
        assert.equal(r.breakdown.freightBase, 300);
        assert.equal(r.breakdown.adValorem, 30);
        assert.equal(r.breakdown.gris, 10);
        assert.equal(r.breakdown.toll, 15);
        const subtotal = 300 + 30 + 10 + 15 + 10 + 5;
        assert.equal(Math.round(r.total * 100) / 100, Math.round(subtotal * 1.12 * 100) / 100);
    });

    it('frete mínimo por faixa de peso vence o frete-peso pequeno', () => {
        const table = { ...baseTable, minFreightRanges: [{ minWeight: 0, maxWeight: 100, value: 180 }] };
        const r = computeFreightFromTable(table, { volumes: 1, weight: 10, cubage: null, nfValue: 0 });
        assert.equal(r.breakdown.freightBase, 180);
    });

    it('frete informado soma os componentes e ignora negativos', () => {
        assert.deepEqual(informedFreight({ freightBase: 100.555, toll: 20, icms: -5 }), {
            total: 120.56,
            breakdown: { freightBase: 100.56, adValorem: 0, gris: 0, toll: 20, dispatch: 0, others: 0, icms: 0 },
        });
    });

    it('parâmetros do pedido vêm das NFs; sem NF, dos dados da coleta', () => {
        assert.deepEqual(orderFreightParams({ invoicesRel: [{ volumes: 3, weight: 120, cubedVolume: 0.4, value: 4500 }], collectionData: null }), {
            volumes: 3,
            weight: 120,
            cubage: 0.4,
            nfValue: 4500,
        });
        assert.equal(orderFreightParams({ invoicesRel: [], collectionData: { weight: 7 } }).weight, 7);
    });
});

const t = (over: Partial<TableCandidate>): TableCandidate => ({
    id: 'x',
    description: 'x',
    type: 'GENERAL',
    clientId: null,
    accountId: null,
    routeId: null,
    priority: 0,
    ...over,
});

describe('choosePricingTable', () => {
    const tables = [
        t({ id: 'geral', type: 'GENERAL' }),
        t({ id: 'geral-rota', type: 'GENERAL', routeId: 'r1' }),
        t({ id: 'esp', type: 'SPECIAL', clientId: 'c1' }),
        t({ id: 'esp-rota', type: 'SPECIAL', clientId: 'c1', routeId: 'r1' }),
        t({ id: 'esp-conta', type: 'SPECIAL', accountId: 'a9', priority: 5 }),
    ];

    it('ordem: especial do pagador na rota → especial do pagador → geral da rota → geral', () => {
        assert.equal(choosePricingTable(tables, { payerClientId: 'c1', payerAccountId: null, routeId: 'r1' })?.tableId, 'esp-rota');
        assert.equal(choosePricingTable(tables, { payerClientId: 'c1', payerAccountId: null, routeId: 'r2' })?.tableId, 'esp');
        assert.equal(choosePricingTable(tables, { payerClientId: 'c2', payerAccountId: null, routeId: 'r1' })?.source, 'general_route');
        assert.equal(choosePricingTable(tables, { payerClientId: null, payerAccountId: null, routeId: null })?.tableId, 'geral');
    });

    it('tabela especial da conta (vários CNPJs) vale para o pagador da conta', () => {
        const choice = choosePricingTable(tables, { payerClientId: 'c7', payerAccountId: 'a9', routeId: null });
        assert.equal(choice?.tableId, 'esp-conta');
        assert.equal(choice?.method, 'ESPECIAL');
    });

    it('sem nenhuma tabela aplicável → informado (null)', () => {
        assert.equal(choosePricingTable([t({ type: 'SPECIAL', clientId: 'outro' })], { payerClientId: 'c1', payerAccountId: null, routeId: null }), null);
    });
});

describe('estado do documento, tipos e pagador', () => {
    it('emitido vence a caminho, que vence rejeitado e rascunho', () => {
        assert.equal(freightDocState([{ status: 'CTE_REJECTED' }, { status: 'MINUTA_EMITTED' }]), 'emitted');
        assert.equal(freightDocState([{ status: 'CTE_SENT' }, { status: 'DRAFT' }]), 'in_flight');
        assert.equal(freightDocState([{ status: 'CTE_CANCELLED' }]), 'none');
    });

    it('CT-e com NF-e, DC-e com declaração; minuta sempre possível', () => {
        assert.deepEqual(allowedDocTypes('CTE'), { allowed: ['CTE', 'MINUTA'], recommended: 'CTE' });
        assert.deepEqual(allowedDocTypes(null), { allowed: ['MINUTA'], recommended: 'MINUTA' });
        assert.equal(payerRole('FOB'), 'destinatario');
        assert.equal(payerRole(null), 'remetente');
    });

    it('pagador muda sem fatura; com fatura ou CT-e já emitido, não', () => {
        assert.equal(payerChangeBlock({ invoiced: false, calcs: [{ status: 'MINUTA_EMITTED', documentType: 'MINUTA' }] }), null);
        assert.match(payerChangeBlock({ invoiced: true, calcs: [] }) ?? '', /faturado/);
        assert.match(payerChangeBlock({ invoiced: false, calcs: [{ status: 'CTE_AUTHORIZED', documentType: 'CTE', cteNumber: '77' }] }) ?? '', /CT-e nº 77/);
    });

    it('emitente: o padrão do hub antes de qualquer outro', () => {
        const list = [
            { id: 'global', hubId: null, defaultForHub: true },
            { id: 'outro-do-hub', hubId: 'h1', defaultForHub: false },
            { id: 'padrao-do-hub', hubId: 'h1', defaultForHub: true },
        ];
        assert.equal(pickEmitter(list, 'h1')?.id, 'padrao-do-hub');
        assert.equal(pickEmitter(list, 'h2')?.id, 'global');
    });
});

const person = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    documentType: 'CNPJ',
    document: id === 'rem' ? '11222333000181' : '45568955000188',
    legalName: id === 'rem' ? 'REMETENTE LTDA' : 'DESTINO LTDA',
    stateRegistration: '123456',
    address: 'Rua A',
    number: '1',
    city: 'Cidade',
    state: 'SP',
    cep: '01000000',
    cityIbgeCode: id === 'rem' ? '3518800' : '2105302',
    clients: [] as { id: string; accountId: string | null }[],
    ...over,
});

function fixture(over: { freightTerm?: 'CIF' | 'FOB'; payerClient?: boolean } = {}) {
    const order = {
        id: 'o1',
        nfNumber: '1234',
        freightTerm: over.freightTerm ?? 'CIF',
        currentHubId: 'gru',
        routeId: null,
        origemPrestacao: 'Guarulhos, SP',
        fimPrestacao: 'Imperatriz, MA',
        fimIbgeCode: '2105302',
        collectionData: null,
        remetentePerson: person('rem', { clients: over.payerClient ? [{ id: 'c1', accountId: null }] : [] }),
        destinatarioPerson: person('dest', { state: 'MA' }),
        consignatarioPerson: null,
        expedidorPerson: null,
        invoicesRel: [{ type: 'NFE', nfKey: '3'.repeat(44), nfNumber: '1234', volumes: 3, weight: 120, cubedVolume: 0, value: 4500 }],
        freightCalculations: [],
        invoices: [],
        invoiceItems: [],
        demand: { orderNumber: 77, nfNumber: '1234', destination: 'Imperatriz' },
    } as unknown as FreightOrder;
    const hub = { id: 'gru', code: 'SP-GRU', name: 'GRU', rntrc: '12345678', phone: null, personId: 'p-hub', person: person('hub') };
    const ctx = {
        hub,
        emitter: { id: 'em1', hubId: 'gru', active: true, provider: 'SIMULATED', environment: 'HOMOLOGACAO', displayName: 'TSM GRU', defaultCteCfop: '6353', defaultCteCst: '00', cteSeries: 1, rntrc: '12345678', person: person('hub', { legalName: 'TSM' }), hub },
        coverage: buildCoverageIndex(
            [
                { id: 'gru', name: 'GRU', code: 'SP-GRU', cityIbgeCode: '3518800', active: true },
                { id: 'imp', name: 'Imperatriz', code: 'IMP-MA', cityIbgeCode: '2105302', active: true },
            ],
            [],
        ),
        routes: [{ id: 'r1', name: 'GRU > IMP', originCode: 'SP-GRU', destCode: 'IMP-MA' }],
        tables: [
            { ...baseTable, ...t({ id: 'geral-rota', description: 'Tarifa GRU-IMP', routeId: 'r1' }) },
            { ...baseTable, freightValue: 1, ...t({ id: 'esp', description: 'Especial', type: 'SPECIAL', clientId: 'c1' }) },
        ],
    } as unknown as FreightContext;
    return { order, ctx };
}

describe('summarizeDocuments: reenvio do CT-e', () => {
    function document(over: Partial<FreightOrder['freightCalculations'][number]> = {}) {
        const { order } = fixture();
        order.freightCalculations = [{
            id: 'calc-1',
            documentType: 'CTE',
            status: 'CTE_PENDING_RECONCILIATION',
            cteNumber: '21794',
            freightTotal: 120,
            calculationMethod: 'INFORMADO',
            pricingTable: null,
            cteStatusReason: 'Falha antes do envio.',
            cteEmissionJobs: [],
            createdAt: new Date('2026-10-20T12:00:00Z'),
            ...over,
        } as FreightOrder['freightCalculations'][number]];
        return summarizeDocuments(order)[0];
    }

    const job = (providerDocId: string | null) => ({ phase: 'PENDING_RECONCILIATION' as const, attemptCount: 3, maxAttempts: 3, providerDocId });

    it('permite reenviar CT-e em reconciliação sem job de submissão', () => {
        const doc = document();
        assert.equal(doc.canResend, true);
        assert.equal(doc.statusReason, 'Falha antes do envio.');
    });

    it('permite reenviar quando o job mais recente não tem providerDocId', () => {
        assert.equal(document({ cteEmissionJobs: [job(null), job('doc-antigo')] }).canResend, true);
    });

    it('bloqueia reenvio quando o job mais recente já foi submetido', () => {
        assert.equal(document({ cteEmissionJobs: [job('doc-atual'), job(null)] }).canResend, false);
    });

    it('não oferece reenvio para outros tipos de documento ou estados', () => {
        assert.equal(document({ documentType: 'MINUTA' }).canResend, false);
        assert.equal(document({ documentType: 'DCE' }).canResend, false);
        for (const status of ['CALCULATED', 'CTE_READY', 'CTE_SENT', 'CTE_PROCESSING', 'CTE_AUTHORIZED', 'CTE_REJECTED'] as const) {
            assert.equal(document({ status }).canResend, false, status);
        }
    });
});

describe('suggestFreight', () => {
    it('rota pela cobertura do destino; geral da rota quando o pagador não tem tabela; CT-e pronto', () => {
        const { order, ctx } = fixture();
        const s = suggestFreight(order, ctx);
        assert.equal(s.route?.id, 'r1');
        assert.equal(s.pricing?.tableId, 'geral-rota');
        assert.equal(s.docs.recommended, 'CTE');
        assert.ok((s.preview?.total ?? 0) > 0);
        assert.deepEqual(s.blockers, []);
        assert.equal(s.payer?.name, 'REMETENTE LTDA');
    });

    it('pagador cliente com tabela especial: a especial vence', () => {
        const { order, ctx } = fixture({ payerClient: true });
        assert.equal(suggestFreight(order, ctx).pricing?.tableId, 'esp');
    });

    it('FOB: o destinatário paga; sem IE do tomador, a pendência aparece antes de emitir', () => {
        const { order, ctx } = fixture({ freightTerm: 'FOB' });
        (order.destinatarioPerson as unknown as { stateRegistration: string | null }).stateRegistration = null;
        const s = suggestFreight(order, ctx);
        assert.equal(s.payer?.role, 'destinatario');
        assert.ok(s.blockers.some((b) => b.startsWith('Destinatário')));
    });

    it('sem tabela: pede o valor informado, sem reclamar de "frete zero" do preflight', () => {
        const { order, ctx } = fixture();
        (ctx as unknown as { tables: unknown[] }).tables = [];
        const s = suggestFreight(order, ctx);
        assert.equal(s.pricing, null);
        assert.deepEqual(s.blockers, ['Sem tabela de preço para este pedido: informe o valor do frete.']);
    });
});
