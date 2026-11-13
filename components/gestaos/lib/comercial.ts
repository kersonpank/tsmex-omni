import type { Demand, DemandStatus, Opportunity } from '../../../types/index';

/** Regras puras da tela Comercial: status traduzidos, cotação e funil de oportunidades. */

export const DEMAND_STATUS_LABEL: Record<DemandStatus, string> = {
    AWAITING_ARRIVAL: 'Aguardando chegada',
    PENDING: 'Aguardando cotação',
    QUOTED: 'Cotada',
    APPROVED: 'Aprovada',
    ASSIGNED: 'Em manifesto',
    COLLECTED: 'Coletada',
    IN_TRANSIT: 'Em trânsito',
    AT_HUB: 'No hub',
    OUT_FOR_DELIVERY: 'Saiu para entrega',
    DELIVERED: 'Entregue',
    CANCELLED: 'Cancelada',
};

export function demandStatusLabel(status: string | null | undefined): string {
    return status ? DEMAND_STATUS_LABEL[status as DemandStatus] ?? 'Situação desconhecida' : '—';
}

export type QuoteView = 'PENDING' | 'QUOTED' | 'APPROVED' | 'ALL';

/** Filtro enviado à API: `ALL` não manda status. */
export function quoteViewStatus(view: QuoteView): string | undefined {
    return view === 'ALL' ? undefined : view;
}

/** Nome do cliente da demanda, do mais específico ao mais genérico. */
export function demandClientName(demand: Pick<Demand, 'client'>): string {
    const client = demand.client;
    if (!client) return 'Cliente não informado';
    return client.tradeName || client.companyName || client.person?.tradeName || client.person?.legalName || 'Cliente não informado';
}

export type QuoteParse = { ok: true; value: number } | { ok: false; error: string };

/** Mesma regra do servidor (`price > 0`); aceita vírgula decimal, como se digita no Brasil. */
export function parseQuotePrice(raw: string): QuoteParse {
    const text = raw.trim();
    if (!text) return { ok: false, error: 'Informe o valor da cotação.' };
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    const value = Number(normalized);
    if (!Number.isFinite(value)) return { ok: false, error: 'Valor inválido. Use apenas números.' };
    if (value <= 0) return { ok: false, error: 'O valor da cotação precisa ser maior que zero.' };
    return { ok: true, value: Math.round(value * 100) / 100 };
}

/* ---------- Funil ---------- */

export const STAGE_ORDER: Opportunity['stage'][] = ['QUOTE', 'FOLLOW_UP', 'COLLECTION_REQUESTED', 'CONVERTED', 'LOST'];

export const STAGE_LABEL: Record<Opportunity['stage'], string> = {
    QUOTE: 'Cotação',
    FOLLOW_UP: 'Acompanhamento',
    COLLECTION_REQUESTED: 'Coleta solicitada',
    CONVERTED: 'Convertida em demanda',
    LOST: 'Perdida',
};

export function stageLabel(stage: string | null | undefined): string {
    return stage ? STAGE_LABEL[stage as Opportunity['stage']] ?? 'Outro estágio' : 'Sem estágio';
}

export interface FunnelStage {
    stage: string;
    label: string;
    count: number;
    /** Soma dos valores cotados; `null` quando nenhuma oportunidade do estágio traz valor. */
    value: number | null;
}

/** Agrupa por estágio na ordem do funil (estágios vazios incluídos); estágio desconhecido vai ao fim. */
export function groupOpportunities(opportunities: Array<Pick<Opportunity, 'stage' | 'quotedPrice'>>): FunnelStage[] {
    const groups = new Map<string, FunnelStage>();
    for (const stage of STAGE_ORDER) groups.set(stage, { stage, label: stageLabel(stage), count: 0, value: null });
    for (const item of opportunities) {
        const key = item.stage || 'UNKNOWN';
        let group = groups.get(key);
        if (!group) {
            group = { stage: key, label: stageLabel(item.stage), count: 0, value: null };
            groups.set(key, group);
        }
        group.count += 1;
        const price = Number(item.quotedPrice);
        if (item.quotedPrice != null && Number.isFinite(price) && price > 0) group.value = (group.value ?? 0) + price;
    }
    return [...groups.values()];
}
