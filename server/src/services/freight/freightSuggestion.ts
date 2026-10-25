import type { FreightCalcStatus, Person } from '@prisma/client';
import { getFiscalDocModeForFreight } from '../fiscal/fiscalDocPolicy.js';
import { buildCteEmissionInputFromRecords } from '../fiscal/cteEmissionInputBuilder.js';
import { resolveNextHop } from '../hubCargo/consolidationQueue.js';
import { computeFreightFromTable, orderFreightParams, type FreightBreakdown } from './freightPricing.js';
import {
    allowedDocTypes,
    choosePricingTable,
    freightDocState,
    isPendingReconciliationWithoutSubmission,
    payerChangeBlock,
    payerRole,
    type FreightDocState,
    type FreightDocType,
    type FreightTermValue,
    type PricingChoice,
} from './freightDocRules.js';
import type { FreightContext, FreightOrder } from './freightContext.js';

/**
 * Sugestão do DOCUMENTO DO FRETE de um pedido: quem paga, CT-e/DC-e/minuta, emitente, tabela de
 * preço e a prévia do valor — o operador vê, resolve o que faltar e emite com um toque (L1→L2).
 */

export interface FreightDocumentSummary {
    id: string;
    documentType: FreightDocType;
    status: FreightCalcStatus;
    canResend: boolean;
    number: string | null;
    freightTotal: number;
    calculationMethod: string;
    pricingLabel: string | null;
    statusReason: string | null;
    accessKey: string | null;
    attempt: { count: number; max: number } | null;
    createdAt: string;
}

export interface FreightSuggestion {
    orderId: string;
    orderNumber: number | null;
    nfNumber: string | null;
    freightTerm: FreightTermValue;
    payer: { role: 'remetente' | 'destinatario' | 'consignatario'; personId: string; name: string; document: string; isClient: boolean } | null;
    payerChange: { allowed: boolean; reason: string | null };
    docs: { allowed: FreightDocType[]; recommended: FreightDocType; reason: string };
    emitter: { id: string; name: string; provider: string; environment: string } | null;
    route: { id: string; label: string } | null;
    pricing: PricingChoice | null;
    preview: { total: number; breakdown: FreightBreakdown; effectiveWeight: number } | null;
    params: { volumes: number; weight: number; nfValue: number };
    /** O que impede emitir o documento recomendado agora (vazio = pronto para emitir). */
    blockers: string[];
    /** Campos fiscais que faltam (ex.: cfop, cst) — a tela oferece o campo. */
    missingFields: string[];
    state: FreightDocState;
    documents: FreightDocumentSummary[];
    parties: { remetente: Person | null; destinatario: Person | null; consignatario: Person | null };
}

const NO_FREIGHT_ISSUE = 'CT-e precisa de valor de frete maior que zero.';

function stripClients<T extends { clients?: unknown } | null>(person: T): Person | null {
    if (!person) return null;
    const { clients: _clients, ...rest } = person as T & { clients?: unknown };
    return rest as unknown as Person;
}

export function summarizeDocuments(order: FreightOrder): FreightDocumentSummary[] {
    return order.freightCalculations.map((c) => ({
        id: c.id,
        documentType: c.documentType as FreightDocType,
        status: c.status,
        canResend: c.documentType === 'CTE' && isPendingReconciliationWithoutSubmission(c),
        number: c.cteNumber ?? c.dceNumber ?? c.minutaNumber ?? null,
        freightTotal: c.freightTotal,
        calculationMethod: c.calculationMethod,
        pricingLabel: c.pricingTable?.description ?? null,
        statusReason: c.cteStatusReason ?? c.dceStatusReason ?? null,
        accessKey: c.cteAccessKey ?? c.dceAccessKey ?? null,
        attempt: c.cteEmissionJobs[0] ? { count: c.cteEmissionJobs[0].attemptCount, max: c.cteEmissionJobs[0].maxAttempts } : null,
        createdAt: c.createdAt.toISOString(),
    }));
}

export function suggestFreight(order: FreightOrder, ctx: FreightContext): FreightSuggestion {
    const mode = getFiscalDocModeForFreight(order);
    const docs = allowedDocTypes(mode.allowed);
    const freightTerm = (order.freightTerm ?? 'CIF') as FreightTermValue;
    const role = payerRole(freightTerm);
    const payerPerson =
        role === 'remetente' ? order.remetentePerson : role === 'destinatario' ? order.destinatarioPerson : order.consignatarioPerson ?? order.destinatarioPerson;
    const payerClient = payerPerson?.clients?.[0] ?? null;

    // Rota de preço = hub atual → hub que cobre o destino final (tabela de roteamento da teia).
    const destIbge = order.fimIbgeCode ?? order.destinatarioPerson?.cityIbgeCode ?? null;
    const hop = resolveNextHop(ctx.coverage, destIbge, ctx.hub.id);
    const destCode = hop.kind === 'TRANSFER' ? hop.target.hubCode : hop.kind === 'LOCAL' ? ctx.hub.code : null;
    const route =
        (destCode ? ctx.routes.find((r) => r.originCode === ctx.hub.code && r.destCode === destCode) : undefined) ??
        (order.routeId ? ctx.routes.find((r) => r.id === order.routeId) : undefined) ??
        null;

    const pricing = choosePricingTable(ctx.tables, {
        payerClientId: payerClient?.id ?? null,
        payerAccountId: payerClient?.accountId ?? null,
        routeId: route?.id ?? null,
    });
    const params = orderFreightParams(order);
    const table = pricing ? ctx.tables.find((t) => t.id === pricing.tableId) : undefined;
    const computed = table ? computeFreightFromTable(table, params) : null;

    const blockers: string[] = [];
    let missingFields: string[] = [];
    if (!computed || computed.total <= 0) blockers.push('Sem tabela de preço para este pedido: informe o valor do frete.');
    if (mode.allowed === null && order.invoicesRel.length > 0) blockers.push(mode.reason);
    if (docs.recommended === 'CTE') {
        const { preflight } = buildCteEmissionInputFromRecords({
            order,
            hub: ctx.hub,
            calc: {
                id: 'preview',
                documentType: 'CTE',
                freightTotal: computed?.total ?? 0,
                fiscalEmitterId: ctx.emitter?.id ?? null,
                fiscalEmitter: ctx.emitter,
                originCity: order.origemPrestacao,
                destCity: order.fimPrestacao,
                cfop: null,
                cst: null,
                ...params,
                effectiveWeight: computed?.effectiveWeight ?? null,
            },
        });
        blockers.push(...preflight.issues.filter((issue) => issue !== NO_FREIGHT_ISSUE));
        missingFields = preflight.missingFields.filter((f) => f !== 'freightTotal');
    } else if (!ctx.emitter && !ctx.hub.personId) {
        blockers.push('Hub sem CNPJ cadastrado para emitir a minuta. Fale com a torre.');
    }

    const block = payerChangeBlock({
        invoiced: order.invoices.length > 0 || order.invoiceItems.length > 0,
        calcs: order.freightCalculations.map((c) => ({ status: c.status, documentType: c.documentType as FreightDocType, cteNumber: c.cteNumber })),
    });

    return {
        orderId: order.id,
        orderNumber: order.demand?.orderNumber ?? null,
        nfNumber: order.nfNumber ?? order.demand?.nfNumber ?? null,
        freightTerm,
        payer: payerPerson
            ? { role, personId: payerPerson.id, name: payerPerson.legalName, document: payerPerson.document, isClient: Boolean(payerClient) }
            : null,
        payerChange: { allowed: block === null, reason: block },
        docs: { ...docs, reason: mode.reason },
        emitter: ctx.emitter
            ? {
                  id: ctx.emitter.id,
                  name: ctx.emitter.displayName ?? ctx.emitter.person.legalName,
                  provider: ctx.emitter.provider,
                  environment: ctx.emitter.environment,
              }
            : null,
        route: route ? { id: route.id, label: route.name } : null,
        pricing,
        preview: computed ? { total: computed.total, breakdown: computed.breakdown, effectiveWeight: computed.effectiveWeight } : null,
        params: { volumes: params.volumes, weight: params.weight, nfValue: params.nfValue },
        blockers: Array.from(new Set(blockers)),
        missingFields,
        state: freightDocState(order.freightCalculations),
        documents: summarizeDocuments(order),
        parties: {
            remetente: stripClients(order.remetentePerson),
            destinatario: stripClients(order.destinatarioPerson),
            consignatario: stripClients(order.consignatarioPerson),
        },
    };
}
