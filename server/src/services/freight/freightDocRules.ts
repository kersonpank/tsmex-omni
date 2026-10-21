import type { FreightCalcStatus } from '@prisma/client';

/**
 * Regras puras do DOCUMENTO DO FRETE do pedido (CT-e, DC-e ou minuta) — o documento nasce no
 * pedido, logo depois da entrada, antes de qualquer carregamento (NORTE #30).
 */

export type FreightDocType = 'CTE' | 'DCE' | 'MINUTA';
export type FreightTermValue = 'CIF' | 'FOB' | 'REDESPACHO';

/** Documento válido emitido — o pedido está documentado. */
export const EMITTED_STATUSES: FreightCalcStatus[] = ['CTE_AUTHORIZED', 'MINUTA_EMITTED', 'DCE_AUTHORIZED'];
/** Já entregue ao provedor fiscal: não pode ser recriado nem duplicado. */
export const IN_FLIGHT_STATUSES: FreightCalcStatus[] = [
    'CTE_READY',
    'CTE_SENT',
    'CTE_PROCESSING',
    'CTE_PENDING_RECONCILIATION',
    'DCE_READY',
    'DCE_SENT',
];
/** Documento que conta como "o pedido tem frete documentado ou a caminho". */
export const ACTIVE_DOC_STATUSES: FreightCalcStatus[] = [...EMITTED_STATUSES, ...IN_FLIGHT_STATUSES];
/** Cálculo ainda editável/reaproveitável pelo preparo automático. */
export const REUSABLE_STATUSES: FreightCalcStatus[] = ['DRAFT', 'CALCULATED', 'CTE_REJECTED', 'DCE_REJECTED'];

export type FreightDocState = 'emitted' | 'in_flight' | 'rejected' | 'draft' | 'none';

export function freightDocState(calcs: { status: FreightCalcStatus }[]): FreightDocState {
    if (calcs.some((c) => EMITTED_STATUSES.includes(c.status))) return 'emitted';
    if (calcs.some((c) => IN_FLIGHT_STATUSES.includes(c.status))) return 'in_flight';
    if (calcs.some((c) => c.status === 'CTE_REJECTED' || c.status === 'DCE_REJECTED')) return 'rejected';
    if (calcs.some((c) => c.status === 'DRAFT' || c.status === 'CALCULATED')) return 'draft';
    return 'none';
}

/** Tipos possíveis para o pedido: o fiscal permitido pelas notas + minuta (sempre possível). */
export function allowedDocTypes(fiscal: 'CTE' | 'DCE' | null): { allowed: FreightDocType[]; recommended: FreightDocType } {
    if (fiscal === 'CTE') return { allowed: ['CTE', 'MINUTA'], recommended: 'CTE' };
    if (fiscal === 'DCE') return { allowed: ['DCE', 'MINUTA'], recommended: 'DCE' };
    return { allowed: ['MINUTA'], recommended: 'MINUTA' };
}

export interface TableCandidate {
    id: string;
    description: string;
    type: 'SPECIAL' | 'GENERAL';
    clientId: string | null;
    accountId: string | null;
    routeId: string | null;
    priority: number;
}

export type PricingSource = 'payer_special_route' | 'payer_special' | 'general_route' | 'general';

export interface PricingChoice {
    method: 'ESPECIAL' | 'TARIFA_GERAL';
    tableId: string;
    tableLabel: string;
    routeId: string | null;
    source: PricingSource;
}

/**
 * Tabela que vale para o pedido, nesta ordem: especial do pagador na rota → especial do pagador
 * sem rota → geral da rota → geral sem rota. Especial vale pelo cliente ou pela conta (Account,
 * tabela compartilhada entre CNPJs). Empate: maior prioridade. Nenhuma → frete informado.
 */
export function choosePricingTable(
    tables: TableCandidate[],
    ctx: { payerClientId: string | null; payerAccountId: string | null; routeId: string | null },
): PricingChoice | null {
    const byPriority = (list: TableCandidate[]) => [...list].sort((a, b) => b.priority - a.priority)[0];
    const isPayers = (t: TableCandidate) =>
        t.type === 'SPECIAL' &&
        ((ctx.payerClientId != null && t.clientId === ctx.payerClientId) ||
            (ctx.payerAccountId != null && t.accountId === ctx.payerAccountId));
    const steps: { source: PricingSource; pick: (t: TableCandidate) => boolean }[] = [
        { source: 'payer_special_route', pick: (t) => isPayers(t) && ctx.routeId != null && t.routeId === ctx.routeId },
        { source: 'payer_special', pick: (t) => isPayers(t) && t.routeId == null },
        { source: 'general_route', pick: (t) => t.type === 'GENERAL' && ctx.routeId != null && t.routeId === ctx.routeId },
        { source: 'general', pick: (t) => t.type === 'GENERAL' && t.routeId == null },
    ];
    for (const step of steps) {
        const table = byPriority(tables.filter(step.pick));
        if (table) {
            return {
                method: table.type === 'SPECIAL' ? 'ESPECIAL' : 'TARIFA_GERAL',
                tableId: table.id,
                tableLabel: table.description,
                routeId: step.source === 'general_route' || step.source === 'payer_special_route' ? ctx.routeId : null,
                source: step.source,
            };
        }
    }
    return null;
}

/** Pagador (tomador) do frete pelo termo: CIF → remetente, FOB → destinatário, REDESPACHO → consignatário. */
export function payerRole(term: FreightTermValue | null | undefined): 'remetente' | 'destinatario' | 'consignatario' {
    if (term === 'FOB') return 'destinatario';
    if (term === 'REDESPACHO') return 'consignatario';
    return 'remetente';
}

/**
 * Quem paga pode mudar enquanto o pedido não tiver fatura (decisão do fundador). Com CT-e já
 * autorizado ou a caminho da SEFAZ, o tomador está no documento fiscal: trocar exige cancelar ou
 * substituir o CT-e antes — divergência nunca silenciosa (NORTE #26).
 */
export function payerChangeBlock(input: {
    invoiced: boolean;
    calcs: { status: FreightCalcStatus; documentType: FreightDocType; cteNumber?: string | null }[];
}): string | null {
    if (input.invoiced) return 'Pedido já faturado: o pagador do frete não pode mais mudar.';
    const fiscal = input.calcs.find(
        (c) => c.documentType !== 'MINUTA' && (EMITTED_STATUSES.includes(c.status) || IN_FLIGHT_STATUSES.includes(c.status)),
    );
    if (fiscal) {
        const number = fiscal.cteNumber ? ` nº ${fiscal.cteNumber}` : '';
        return `O ${fiscal.documentType === 'DCE' ? 'DC-e' : 'CT-e'}${number} já saiu com o pagador atual. Para trocar, cancele ou substitua o documento antes (fale com a torre).`;
    }
    return null;
}
