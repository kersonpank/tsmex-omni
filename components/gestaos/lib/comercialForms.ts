import type { Client, FreightUnit, MinFreightUnit, Opportunity, PricingRoute, PricingTable, PricingTableType, TollUnit } from '../../../types/index';
import { onlyDigits } from '../ui/form';

/** Regras puras de formulário e filtro do Comercial: oportunidades, tabelas de preço e rotas de preço. */

/* ---------- Conta (para nova oportunidade) ---------- */

export type ClientWithAccount = Client & { accountId?: string | null; tradeName?: string };

export interface AccountOption {
    accountId: string;
    label: string;
    document: string;
}

/** A API de contas só devolve a própria conta; o admin enxerga as contas pelos clientes (cada cliente carrega `accountId`). */
export function accountOptionsFromClients(clients: ClientWithAccount[]): AccountOption[] {
    const seen = new Map<string, AccountOption>();
    for (const client of clients) {
        if (!client.accountId || seen.has(client.accountId)) continue;
        seen.set(client.accountId, { accountId: client.accountId, label: client.tradeName || client.companyName, document: client.document ?? '' });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

const norm = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterAccountOptions(options: AccountOption[], query: string, limit = 8): AccountOption[] {
    const q = norm(query.trim());
    const digits = onlyDigits(query);
    if (!q) return options.slice(0, limit);
    return options.filter((o) => norm(o.label).includes(q) || (digits.length >= 3 && onlyDigits(o.document).includes(digits))).slice(0, limit);
}

/* ---------- Oportunidades ---------- */

export type OpportunityRow = Opportunity & {
    pipelineColumnId?: string | null;
    needsCollection?: boolean;
    account?: { name?: string | null; companies?: Array<{ legalName?: string | null }> } | null;
    cpfCnpjSender?: string | null;
};

export function opportunityAccountName(opp: Pick<OpportunityRow, 'account'>): string {
    return opp.account?.name || opp.account?.companies?.[0]?.legalName || 'Conta sem nome';
}

export function filterOpportunities(rows: OpportunityRow[], filter: { stage?: string; query?: string }): OpportunityRow[] {
    const q = norm((filter.query ?? '').trim());
    return rows.filter((o) => {
        if (filter.stage && o.stage !== filter.stage) return false;
        if (!q) return true;
        return [opportunityAccountName(o), o.origin, o.destination, o.commodity].some((part) => norm(part ?? '').includes(q));
    });
}

export const COMPLETENESS_LABEL: Record<Opportunity['completeness'], string> = { MINIMAL: 'Dados mínimos', INCOMPLETE: 'Incompleta', COMPLETE: 'Completa' };

export const OPPORTUNITY_TYPE_LABEL: Record<Opportunity['type'], string> = {
    QUOTE_ONLY: 'Só cotação',
    TRANSPORT: 'Transporte',
    COLLECTION: 'Coleta',
    BOTH: 'Transporte e coleta',
};

export const SOURCE_LABEL: Record<string, string> = {
    CHAT: 'Chat',
    WHATSAPP: 'WhatsApp',
    PHONE: 'Telefone',
    EMAIL: 'E-mail',
    MANUAL: 'Manual',
    FORM: 'Formulário',
    ENTRADA: 'Entrada no hub',
};

/** O servidor só converte oportunidade COMPLETE com origem, destino, peso, valor da nota e volumes. */
export function conversionBlocker(opp: Pick<OpportunityRow, 'stage' | 'completeness' | 'origin' | 'destination' | 'weight' | 'nfValue' | 'volumes'>): string | null {
    if (opp.stage === 'CONVERTED') return 'Esta oportunidade já virou demanda.';
    const missing: string[] = [];
    if (!opp.origin) missing.push('origem');
    if (!opp.destination) missing.push('destino');
    if (!opp.weight) missing.push('peso');
    if (!opp.nfValue) missing.push('valor da nota');
    if (!opp.volumes) missing.push('volumes');
    if (missing.length > 0) return `Para converter, falta: ${missing.join(', ')}.`;
    return null;
}

export interface OpportunityForm {
    origin: string;
    destination: string;
    commodity: string;
    weight: number | null;
    nfValue: number | null;
    volumes: number | null;
    quotedPrice: number | null;
    type: Opportunity['type'];
    needsCollection: boolean;
}

export const emptyOpportunityForm = (): OpportunityForm => ({
    origin: '',
    destination: '',
    commodity: '',
    weight: null,
    nfValue: null,
    volumes: null,
    quotedPrice: null,
    type: 'QUOTE_ONLY',
    needsCollection: false,
});

export function opportunityToForm(opp: OpportunityRow): OpportunityForm {
    return {
        origin: opp.origin ?? '',
        destination: opp.destination ?? '',
        commodity: opp.commodity ?? '',
        weight: opp.weight ?? null,
        nfValue: opp.nfValue ?? null,
        volumes: opp.volumes ?? null,
        quotedPrice: opp.quotedPrice ?? null,
        type: opp.type ?? 'QUOTE_ONLY',
        needsCollection: Boolean(opp.needsCollection),
    };
}

/** Só envia o que foi preenchido (o servidor rejeita `null` nesses campos). */
export function buildOpportunityFields(form: OpportunityForm): Record<string, unknown> {
    const out: Record<string, unknown> = { type: form.type, needsCollection: form.needsCollection };
    if (form.origin.trim()) out.origin = form.origin.trim();
    if (form.destination.trim()) out.destination = form.destination.trim();
    if (form.commodity.trim()) out.commodity = form.commodity.trim();
    if (form.weight != null && form.weight > 0) out.weight = form.weight;
    if (form.nfValue != null && form.nfValue > 0) out.nfValue = form.nfValue;
    if (form.volumes != null && form.volumes > 0) out.volumes = Math.round(form.volumes);
    if (form.quotedPrice != null && form.quotedPrice > 0) out.quotedPrice = form.quotedPrice;
    return out;
}

/** Mesmo corpo da gestão clássica (conta, sessão nova, origem manual) mais os campos opcionais que o servidor aceita. */
export function buildOpportunityCreate(accountId: string, form: OpportunityForm, sessionId: string): Record<string, unknown> {
    return { accountId, sessionId, source: 'MANUAL', conversationSnapshot: [], ...buildOpportunityFields(form) };
}

export function validateOpportunity(accountId: string | null | undefined, form: OpportunityForm, needsAccount: boolean): Record<string, string> {
    const errors: Record<string, string> = {};
    if (needsAccount && !accountId) errors.account = 'Escolha a conta da oportunidade.';
    if (form.weight != null && form.weight < 0) errors.weight = 'O peso não pode ser negativo.';
    if (form.nfValue != null && form.nfValue < 0) errors.nfValue = 'O valor não pode ser negativo.';
    return errors;
}

/** A coluna do funil que representa o estágio (a clássica arrasta por coluna; mover só o estágio deixaria o cartão no lugar antigo). */
export function columnForStage<T extends { id: string; stage: string | null; active?: boolean }>(columns: T[], stage: string): T | null {
    return columns.find((c) => c.stage === stage && c.active !== false) ?? null;
}

/* ---------- Tabelas de preço ---------- */

export const FREIGHT_UNIT_LABEL: Record<FreightUnit, string> = { RS_KG: 'R$ por kg', PERCENT: '% do valor da nota', RS_M3: 'R$ por m³', RS_UNIT: 'R$ por unidade' };
export const MIN_FREIGHT_UNIT_LABEL: Record<MinFreightUnit, string> = { RS: 'R$', KG: 'kg' };
export const TOLL_UNIT_LABEL: Record<TollUnit, string> = { RS_KG: 'R$ por kg', FIXED: 'R$ fixo' };
export const TABLE_TYPE_LABEL: Record<PricingTableType, string> = { GENERAL: 'Geral', SPECIAL: 'Especial por cliente' };

export interface RangeForm {
    minWeight: number | null;
    maxWeight: number | null;
    value: number | null;
}

export interface PricingTableForm {
    description: string;
    type: PricingTableType;
    clientId: string | null;
    routeId: string | null;
    freightValue: number | null;
    freightUnit: FreightUnit;
    minFreightValue: number | null;
    minFreightUnit: MinFreightUnit;
    adValoremPercent: number | null;
    grisPercent: number | null;
    adValoremThreshold: number | null;
    tollValue: number | null;
    tollUnit: TollUnit;
    dispatchFee: number | null;
    otherFees: number | null;
    cubeEnabled: boolean;
    cubeFactor: number | null;
    icmsIncluded: boolean;
    icmsPercent: number | null;
    ranges: RangeForm[];
    active: boolean;
    priority: number;
}

export const emptyTableForm = (): PricingTableForm => ({
    description: '',
    type: 'GENERAL',
    clientId: null,
    routeId: null,
    freightValue: null,
    freightUnit: 'RS_KG',
    minFreightValue: null,
    minFreightUnit: 'RS',
    adValoremPercent: null,
    grisPercent: null,
    adValoremThreshold: null,
    tollValue: null,
    tollUnit: 'RS_KG',
    dispatchFee: null,
    otherFees: null,
    cubeEnabled: false,
    cubeFactor: null,
    icmsIncluded: true,
    icmsPercent: null,
    ranges: [],
    active: true,
    priority: 0,
});

export function tableToForm(t: PricingTable): PricingTableForm {
    return {
        description: t.description,
        type: t.type,
        clientId: t.clientId ?? null,
        routeId: t.routeId ?? null,
        freightValue: t.freightValue ?? null,
        freightUnit: t.freightUnit,
        minFreightValue: t.minFreightValue ?? null,
        minFreightUnit: t.minFreightUnit ?? 'RS',
        adValoremPercent: t.adValoremPercent ?? null,
        grisPercent: t.grisPercent ?? null,
        adValoremThreshold: t.adValoremThreshold ?? null,
        tollValue: t.tollValue ?? null,
        tollUnit: t.tollUnit ?? 'RS_KG',
        dispatchFee: t.dispatchFee ?? null,
        otherFees: t.otherFees ?? null,
        cubeEnabled: t.cubeEnabled ?? false,
        cubeFactor: t.cubeFactor ?? null,
        icmsIncluded: t.icmsIncluded ?? false,
        icmsPercent: t.icmsPercent ?? null,
        ranges: (t.minFreightRanges ?? []).map((r) => ({ minWeight: r.minWeight, maxWeight: r.maxWeight ?? null, value: r.value })),
        active: t.active ?? true,
        priority: t.priority ?? 0,
    };
}

/** Mesma regra da clássica: a descrição é obrigatória. As faixas precisam de valor maior que zero (o servidor exige). */
export function validateTableForm(form: PricingTableForm): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!form.description.trim()) errors.description = 'Descrição é obrigatória.';
    for (const [index, range] of form.ranges.entries()) {
        if (range.value == null || range.value <= 0) {
            errors.ranges = `Faixa ${index + 1}: informe um valor maior que zero.`;
            break;
        }
        if (range.minWeight != null && range.minWeight < 0) {
            errors.ranges = `Faixa ${index + 1}: o peso inicial não pode ser negativo.`;
            break;
        }
    }
    return errors;
}

const put = (out: Record<string, unknown>, key: string, value: number | null) => {
    if (value != null) out[key] = value;
};

/** Corpo igual ao da clássica; campos numéricos vazios são omitidos porque o servidor não aceita `null` neles. */
export function buildTablePayload(form: PricingTableForm): Record<string, unknown> {
    const out: Record<string, unknown> = {
        description: form.description.trim(),
        routeId: form.routeId || null,
        type: form.type,
        clientId: form.type === 'SPECIAL' ? form.clientId || null : null,
        freightUnit: form.freightUnit,
        minFreightUnit: form.minFreightUnit,
        tollUnit: form.tollUnit,
        cubeEnabled: form.cubeEnabled,
        icmsIncluded: form.icmsIncluded,
        active: form.active,
        priority: Math.round(form.priority || 0),
        minFreightRanges: form.ranges
            .filter((r) => r.value != null && r.value > 0)
            .map((r) => ({ minWeight: r.minWeight ?? 0, maxWeight: r.maxWeight != null && r.maxWeight > 0 ? r.maxWeight : undefined, value: r.value as number })),
    };
    put(out, 'freightValue', form.freightValue);
    put(out, 'minFreightValue', form.minFreightValue);
    put(out, 'adValoremPercent', form.adValoremPercent);
    put(out, 'grisPercent', form.grisPercent);
    put(out, 'adValoremThreshold', form.adValoremThreshold);
    put(out, 'tollValue', form.tollValue);
    put(out, 'dispatchFee', form.dispatchFee);
    put(out, 'otherFees', form.otherFees);
    if (form.cubeEnabled) put(out, 'cubeFactor', form.cubeFactor);
    put(out, 'icmsPercent', form.icmsPercent);
    return out;
}

/** Resumo do frete da tabela em uma linha. */
export function freightSummary(t: Pick<PricingTable, 'freightValue' | 'freightUnit'>): string {
    if (t.freightValue == null) return 'Sem valor de frete';
    const value = t.freightValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    return t.freightUnit === 'PERCENT' ? `${value}% do valor da nota` : `R$ ${value} ${FREIGHT_UNIT_LABEL[t.freightUnit].replace('R$ ', '')}`;
}

export function filterTables<T extends Pick<PricingTable, 'description' | 'active'>>(rows: T[], query: string, activeOnly: boolean): T[] {
    const q = norm(query.trim());
    return rows.filter((t) => (!activeOnly || t.active) && (!q || norm(t.description).includes(q)));
}

/* ---------- Rotas de preço ---------- */

export interface RouteForm {
    name: string;
    originCode: string;
    originName: string;
    destCode: string;
    destName: string;
}

export const emptyRouteForm = (): RouteForm => ({ name: '', originCode: '', originName: '', destCode: '', destName: '' });

export const routeToForm = (r: PricingRoute): RouteForm => ({ name: r.name, originCode: r.originCode, originName: r.originName, destCode: r.destCode, destName: r.destName });

/** A clássica e o servidor exigem os cinco campos. */
export function validateRouteForm(form: RouteForm): Record<string, string> {
    const errors: Record<string, string> = {};
    const required: Array<[keyof RouteForm, string]> = [
        ['name', 'Informe o nome da rota.'],
        ['originName', 'Informe a cidade de origem.'],
        ['originCode', 'Informe o código da origem.'],
        ['destName', 'Informe a cidade de destino.'],
        ['destCode', 'Informe o código do destino.'],
    ];
    for (const [key, message] of required) if (!form[key].trim()) errors[key] = message;
    return errors;
}

export function buildRoutePayload(form: RouteForm): RouteForm {
    return { name: form.name.trim(), originCode: form.originCode.trim(), originName: form.originName.trim(), destCode: form.destCode.trim(), destName: form.destName.trim() };
}

/** Primeira mensagem de erro de um conjunto de campos, ou null. */
export function firstError(errors: Record<string, string>): string | null {
    const key = Object.keys(errors)[0];
    return key ? errors[key] : null;
}
