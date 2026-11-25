import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BREAKDOWN_KEYS, computeFreightFromTable, computeIcms, informedFreight, orderFreightParams, type FreightCityFee, type PricingTableLike } from './freightPricing.js';
import { ACTIVE_DOC_STATUSES, EMITTED_STATUSES, REUSABLE_STATUSES, allowedDocTypes, choosePricingTable, freightDocState, isPendingReconciliationWithoutSubmission, payerChangeBlock, payerRole, type TableCandidate } from './freightDocRules.js';
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

const cityFee: FreightCityFee = {
    role: 'destino', cityIbgeCode: '2105302', cityName: 'Imperatriz', state: 'MA',
    unit: 'PERCENT_FREIGHT', value: 2, fixed: 15,
};

describe('computeIcms', () => {
    it('calcula o percentual sobre o subtotal, inclusive em tabelas sem unidade', () => {
        assert.equal(computeIcms(1000, { icmsIncluded: false, icmsUnit: 'PERCENT', icmsPercent: 12 }), 120);
        assert.equal(computeIcms(1000, { icmsIncluded: false, icmsPercent: 12 }), 120);
    });

    it('calcula o ICMS por dentro com um divisor', () => {
        assert.equal(computeIcms(880, { icmsIncluded: false, icmsUnit: 'DIVISOR', icmsPercent: 0.88 }), 120);
    });

    it('usa o valor fixo independentemente do subtotal', () => {
        assert.equal(computeIcms(0, { icmsIncluded: false, icmsUnit: 'FIXED', icmsPercent: 18.5 }), 18.5);
        assert.equal(computeIcms(1000, { icmsIncluded: false, icmsUnit: 'FIXED', icmsPercent: 18.5 }), 18.5);
    });

    it('não acrescenta ICMS quando já está incluso para qualquer unidade', () => {
        for (const icmsUnit of ['PERCENT', 'DIVISOR', 'FIXED'] as const) {
            assert.equal(computeIcms(1000, { icmsIncluded: true, icmsUnit, icmsPercent: 0.88 }), 0);
        }
    });

    it('interrompe o cálculo quando o divisor é inválido ou estoura o limite numérico', () => {
        const calc = (icmsPercent: number | null) => computeIcms(1000, { icmsIncluded: false, icmsUnit: 'DIVISOR', icmsPercent });
        for (const value of [null, 0, -0.88, 1, 1.12]) {
            assert.throws(() => calc(value), /Divisor do ICMS deve ficar entre 0 e 1/);
        }
        assert.throws(() => calc(Number.MIN_VALUE), /fora do limite do cálculo/);
    });
});

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

    it('aplica o divisor depois de somar todas as parcelas do frete', () => {
        const table: PricingTableLike = { ...baseTable, freightValue: 5.4, icmsUnit: 'DIVISOR', icmsPercent: 0.88 };
        const result = computeFreightFromTable(table, { volumes: 2, weight: 100, cubage: 0.5, nfValue: 10_000 });

        assert.deepEqual(result.breakdown, { freightBase: 810, adValorem: 30, gris: 10, toll: 15, dispatch: 10, others: 5, icms: 120 });
        assert.equal(result.total, 1000);
    });

    it('preserva o quociente do divisor antes do arredondamento monetário', () => {
        const table: PricingTableLike = {
            ...baseTable,
            freightUnit: 'RS_UNIT',
            freightValue: 0.03,
            minFreightValue: null,
            adValoremPercent: null,
            grisPercent: null,
            tollValue: null,
            dispatchFee: null,
            otherFees: null,
            icmsUnit: 'DIVISOR',
            icmsPercent: 0.10526315789473685,
        };

        const result = computeFreightFromTable(table, { volumes: 1, weight: 1, nfValue: 100 });

        assert.equal(result.total, 0.285);
    });

    it('frete mínimo por faixa de peso vence o frete-peso pequeno', () => {
        const table = { ...baseTable, minFreightRanges: [{ minWeight: 0, maxWeight: 100, value: 180 }] };
        const r = computeFreightFromTable(table, { volumes: 1, weight: 10, cubage: null, nfValue: 0 });
        assert.equal(r.breakdown.freightBase, 180);
    });

    it('calcula cada unidade da TDE com a mesma base do frete e soma o valor fixo', () => {
        const params = { volumes: 2, weight: 100, cubage: 0.5, nfValue: 10_000 };
        const table = { ...baseTable, icmsIncluded: true };
        const expected = { PERCENT_FREIGHT: 22.4, PERCENT_FREIGHT_BASE: 21, PERCENT_NF: 215, RS_KG: 315 } as const;
        for (const [unit, amount] of Object.entries(expected)) {
            const result = computeFreightFromTable(table, params, [{ ...cityFee, unit: unit as FreightCityFee['unit'] }]);

            assert.equal(result.effectiveWeight, 150);
            assert.equal(result.breakdown.cityFee, amount, unit);
            assert.equal(result.breakdown.cityFeeDetails?.[0].amount, amount, unit);
            assert.equal(result.total, 370 + amount, unit);
        }
    });

    it('inclui TDE fixa no subtotal antes do ICMS percentual ou por divisor', () => {
        const table = {
            ...baseTable, freightUnit: 'RS_UNIT', freightValue: 800, adValoremPercent: null, grisPercent: null,
            tollValue: null, dispatchFee: null, otherFees: null,
        } as const;
        const params = { volumes: 1, weight: 100, nfValue: 200 };
        const fees = [{ ...cityFee, value: 0, fixed: 80 }];
        const percent = computeFreightFromTable({ ...table, icmsUnit: 'PERCENT', icmsPercent: 12 }, params, fees);
        const divisor = computeFreightFromTable({ ...table, icmsUnit: 'DIVISOR', icmsPercent: 0.88 }, params, fees);
        const fixed = computeFreightFromTable({ ...table, icmsUnit: 'FIXED', icmsPercent: 100 }, params, fees);

        assert.equal(percent.breakdown.icms, 105.6);
        assert.equal(percent.total, 985.6);
        assert.equal(divisor.breakdown.icms, 120);
        assert.equal(divisor.total, 1000);
        assert.equal(fixed.breakdown.icms, 100);
        assert.equal(fixed.total, 980);
    });

    it('fecha as parcelas e as duas linhas de TDE em centavos', () => {
        const table = {
            ...baseTable, freightUnit: 'RS_UNIT', freightValue: 12.345, minFreightValue: null,
            adValoremPercent: null, grisPercent: null, tollValue: null, dispatchFee: 0.005, otherFees: null,
        } as const;
        const destination = { ...cityFee, unit: 'RS_KG', fixed: 0, value: 0.01 } as const;
        const origin = { ...destination, role: 'origem', cityIbgeCode: '3518800', cityName: 'Guarulhos', state: 'SP' } as const;
        const result = computeFreightFromTable(table, { volumes: 1, weight: 1.5, nfValue: 0 }, [destination, origin]);

        assert.equal(result.breakdown.freightBase, 12.35);
        assert.equal(result.breakdown.dispatch, 0.01);
        assert.deepEqual(result.breakdown.cityFeeDetails?.map((fee) => fee.amount), [0.02, 0.02]);
        assert.equal(result.breakdown.cityFee, 0.04);
        assert.equal(result.breakdown.icms, 1.49);
        assert.equal(result.total, 13.89);
        const componentCents = BREAKDOWN_KEYS.reduce((cents, key) => cents + Math.round((result.breakdown[key] ?? 0) * 100), 0);
        assert.equal(result.total, componentCents / 100);
    });

    it('arredonda meio centavo de ICMS para cima nas tarifas com TDE', () => {
        const table = {
            ...baseTable, freightUnit: 'RS_UNIT', minFreightValue: null,
            adValoremPercent: null, grisPercent: null, tollValue: null, dispatchFee: null, otherFees: null,
        } as const;
        const params = { volumes: 1, weight: 1, nfValue: 0 };
        const percent = computeFreightFromTable(
            { ...table, freightValue: 0.6, icmsUnit: 'PERCENT', icmsPercent: 5 },
            params,
            [{ ...cityFee, value: 0, fixed: 0.1 }],
        );
        const divisor = computeFreightFromTable(
            { ...table, freightValue: 0.05, icmsUnit: 'DIVISOR', icmsPercent: 0.8 },
            params,
            [{ ...cityFee, value: 0, fixed: 0.01 }],
        );

        assert.equal(percent.breakdown.icms, 0.04);
        assert.equal(percent.total, 0.74);
        assert.equal(divisor.breakdown.icms, 0.02);
        assert.equal(divisor.total, 0.08);
    });

    it('recusa valores de TDE que excedem a precisão em centavos', () => {
        const table = { ...baseTable, icmsIncluded: true };
        const params = { volumes: 1, weight: 10, nfValue: 0 };
        const largeFee = { ...cityFee, value: 0, fixed: 80_000_000_000_000 };

        assert.throws(() => computeFreightFromTable(table, params, [{ ...largeFee, fixed: 1e35 }]), /limite de precisão/);
        assert.throws(() => computeFreightFromTable(table, params, [largeFee, largeFee]), /limite de precisão/);
    });

    it('frete informado soma os componentes e ignora negativos', () => {
        const input = { freightBase: 100.555, toll: 20, cityFee: 100, icms: -5 };
        assert.deepEqual(informedFreight(input), {
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

    it('CT-e cancelado = sem documento ativo (pode preparar outro); cancelamento em andamento ainda segura o pedido', () => {
        assert.equal(ACTIVE_DOC_STATUSES.includes('CTE_CANCELLED'), false);
        assert.equal(EMITTED_STATUSES.includes('CTE_CANCELLED'), false);
        assert.equal(REUSABLE_STATUSES.includes('CTE_CANCELLED'), false);
        assert.equal(ACTIVE_DOC_STATUSES.includes('CTE_CANCEL_PENDING'), true);
        assert.equal(EMITTED_STATUSES.includes('CTE_CANCEL_PENDING'), false, 'pendente não é faturável');
        assert.equal(freightDocState([{ status: 'CTE_CANCEL_PENDING' }]), 'in_flight');
        assert.equal(freightDocState([{ status: 'CTE_CANCELLED' }, { status: 'CTE_AUTHORIZED' }]), 'emitted');
        const cancelled = { status: 'CTE_CANCELLED' as const, documentType: 'CTE' as const, cteNumber: '5' };
        assert.equal(payerChangeBlock({ invoiced: false, calcs: [cancelled] }), null, 'depois de cancelar, o pagador volta a poder mudar');
        assert.match(payerChangeBlock({ invoiced: false, calcs: [{ ...cancelled, status: 'CTE_CANCEL_PENDING' }] }) ?? '', /CT-e nº 5/);
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
        coveragePricingByCity: new Map(),
        coverageCityFeesByCity: new Map(),
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

    it('expõe a conferência automática: providerDown só depois de 3 conferências sem resposta do provedor e sem id', () => {
        const j = (attemptCount: number, providerDocId: string | null) => ({ phase: 'PENDING_RECONCILIATION' as const, attemptCount, maxAttempts: 24, providerDocId });
        assert.deepEqual(document({ cteEmissionJobs: [j(0, null)] }).reconcile, { hasProviderId: false, failedChecks: 0, providerDown: false });
        assert.deepEqual(document({ cteEmissionJobs: [j(2, null)] }).reconcile, { hasProviderId: false, failedChecks: 2, providerDown: false });
        assert.deepEqual(document({ cteEmissionJobs: [j(3, null)] }).reconcile, { hasProviderId: false, failedChecks: 3, providerDown: true });
        assert.deepEqual(document({ cteEmissionJobs: [j(24, 'doc-1')] }).reconcile, { hasProviderId: true, failedChecks: 0, providerDown: false });
        assert.equal(document({ status: 'CTE_AUTHORIZED' }).reconcile, null);
    });

    it('bloqueia reenvio em reconciliação sem job comprovadamente seguro', () => {
        const doc = document();
        assert.equal(doc.canResend, false);
        assert.equal(doc.statusReason, 'Falha antes do envio.');
    });

    it('bloqueia reenvio quando o job mais recente não tem providerDocId mas não tem guarda', () => {
        assert.equal(document({ cteEmissionJobs: [job(null), job('doc-antigo')] }).canResend, false);
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

    it('exige guarda v1, submit nulo, fase terminal e prova independente de ausência de worker', () => {
        const guarded: { providerDocId: string | null; phase: string; submissionGuardVersion: number | null; submitStartedAt: Date | null } = {
            providerDocId: null, phase: 'PENDING_RECONCILIATION', submissionGuardVersion: 1, submitStartedAt: null,
        };
        const calc = (changes: Partial<typeof guarded> = {}) => ({ status: 'CTE_PENDING_RECONCILIATION', cteEmissionJobs: [{ ...guarded, ...changes }] });
        assert.equal(isPendingReconciliationWithoutSubmission(calc()), false);
        assert.equal(isPendingReconciliationWithoutSubmission(calc(), true), true);
        assert.equal(isPendingReconciliationWithoutSubmission(calc({ submissionGuardVersion: null }), true), false);
        assert.equal(isPendingReconciliationWithoutSubmission(calc({ submitStartedAt: new Date() }), true), false);
        assert.equal(isPendingReconciliationWithoutSubmission(calc({ phase: 'QUEUED' }), true), false);
        assert.equal(isPendingReconciliationWithoutSubmission(calc({ providerDocId: 'doc-1' }), true), false);
        assert.equal(isPendingReconciliationWithoutSubmission({ status: 'CTE_PENDING_RECONCILIATION', cteEmissionJobs: [] }, true), false);
    });
});

describe('suggestFreight', () => {
    it('CFOP do emitente incompatível com as UFs da prestação é derivado sozinho (sem pedir escolha)', () => {
        const { order, ctx } = fixture();
        ctx.emitter!.defaultCteCfop = '5353';
        const suggestion = suggestFreight(order, ctx);
        assert.ok(!suggestion.blockers.some((issue) => issue.includes('SEFAZ 519')));
        assert.ok(!suggestion.missingFields.includes('cfop'));
        assert.equal(ctx.emitter!.defaultCteCfop, '5353');
    });

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
