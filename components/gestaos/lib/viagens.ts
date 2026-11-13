import type { Manifest, ManifestFiscalDocStatus, ManifestFiscalDocType, ManifestStopPurpose } from '../../../types/index';
import type { Mode } from './modes';
import { carrierLabel, openFiscalDocs, platesLabel, routeLabel, tripAttention, tripCode } from './trips';

/** Regras puras da tela Viagens: filtros de visualização, busca, linha do tempo e leitura da margem. */

export type TripFilter = 'all' | 'blocked' | 'attention' | 'road' | 'preparing' | 'done';

export const TRIP_FILTERS: Array<{ id: TripFilter; label: string }> = [
    { id: 'all', label: 'Todas' },
    { id: 'blocked', label: 'Travadas' },
    { id: 'attention', label: 'Atenção' },
    { id: 'road', label: 'Na estrada' },
    { id: 'preparing', label: 'Preparando' },
    { id: 'done', label: 'Concluídas' },
];

export function parseTripFilter(value: string | null): TripFilter {
    return TRIP_FILTERS.some((filter) => filter.id === value) ? (value as TripFilter) : 'all';
}

export function matchesTripFilter(trip: Manifest, filter: TripFilter, now: Date = new Date()): boolean {
    switch (filter) {
        case 'all':
            return true;
        case 'blocked':
            return tripAttention(trip, now).level === 2;
        case 'attention':
            return tripAttention(trip, now).level === 1;
        case 'road':
            return trip.status === 'IN_PROGRESS';
        case 'preparing':
            return trip.status === 'DRAFT' || trip.status === 'PENDING_ACCEPT' || trip.status === 'ACCEPTED';
        case 'done':
            return trip.status === 'COMPLETED';
    }
}

export function countTripsByFilter(trips: Manifest[], now: Date = new Date()): Record<TripFilter, number> {
    const counts: Record<TripFilter, number> = { all: 0, blocked: 0, attention: 0, road: 0, preparing: 0, done: 0 };
    for (const filter of TRIP_FILTERS) counts[filter.id] = trips.filter((trip) => matchesTripFilter(trip, filter.id, now)).length;
    return counts;
}

const fold = (text: string) =>
    text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();

/** Busca por rota, transportador, placa ou código da viagem (todas as palavras precisam aparecer). */
export function matchesTripQuery(trip: Manifest, query: string): boolean {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const haystack = fold([routeLabel(trip), trip.origin, trip.destination, carrierLabel(trip), platesLabel(trip), tripCode(trip), trip.id].join(' '));
    const compact = haystack.replace(/[\s-]+/g, '');
    return words.every((word) => haystack.includes(word) || compact.includes(word.replace(/-/g, '')));
}

export const DOC_STATUS_LABEL: Record<ManifestFiscalDocStatus, string> = {
    DRAFT: 'Em rascunho',
    READY: 'Pronto para envio',
    SENT: 'Em envio',
    REJECTED: 'Recusado',
    AUTHORIZED: 'Autorizado',
    CLOSED: 'Encerrado',
    CANCELLED: 'Cancelado',
};

export const DOC_TYPE_LABEL: Record<ManifestFiscalDocType, string> = { MDFE: 'MDF-e', CIOT: 'CIOT' };

export const STOP_PURPOSE_LABEL: Record<ManifestStopPurpose, string> = {
    PASSAGE: 'Passagem',
    OPERATIONAL: 'Parada operacional',
    TRANSFER: 'Transferência',
    COLLECTION: 'Coleta',
    DELIVERY: 'Entrega',
};

export interface Milestone {
    key: string;
    label: string;
    at: string | null;
    mode: Mode;
    /** Texto no lugar da data quando não há data a mostrar. */
    note?: string;
}

/** Marcos da viagem. Encerramento fiscal e título do transportador são do Autopilot (ver ROUTINES). */
export function tripMilestones(trip: Manifest): Milestone[] {
    const done = trip.status === 'COMPLETED';
    const closures = (trip.fiscalDocuments ?? []).filter((doc) => doc.status === 'CLOSED' && doc.closedAt).map((doc) => doc.closedAt as string);
    const closedAt = closures.length ? closures.slice().sort().slice(-1)[0] : null;
    const open = openFiscalDocs(trip).length > 0;
    return [
        { key: 'created', label: 'Viagem criada', at: trip.createdAt ?? null, mode: 'manual' },
        { key: 'offered', label: 'Oferta enviada ao transportador', at: trip.offeredAt ?? null, mode: 'manual' },
        { key: 'accepted', label: 'Transportador aceitou', at: trip.acceptedAt ?? null, mode: 'manual' },
        { key: 'started', label: 'Saiu para a estrada', at: trip.startedAt ?? null, mode: 'copilot' },
        { key: 'arrived', label: 'Chegou ao destino', at: trip.arrivedAt ?? null, mode: 'manual' },
        { key: 'completed', label: 'Viagem concluída', at: trip.completedAt ?? null, mode: 'manual' },
        { key: 'fiscal', label: 'MDF-e e CIOT encerrados', at: done && !open ? closedAt : null, mode: 'auto', note: open ? 'ainda aberto' : undefined },
        { key: 'payable', label: 'Título do transportador', at: null, mode: 'auto', note: done ? 'gerado após a conclusão' : undefined },
    ];
}

export interface MarginView {
    complete: boolean;
    /** Motivos, em linguagem simples, de a margem não ser fechada ou de ser estimada. */
    warnings: string[];
    revenueNet: number | null;
    linkCost: number | null;
    hubCost: number | null;
    margin: number | null;
    marginPercent: number | null;
    /** `true` quando a margem tem número a mostrar. */
    hasMargin: boolean;
}

/** Lê a margem que o servidor já calculou. Nada é recalculado nem inventado: incompleto fica incompleto. */
export function marginView(trip: Partial<Manifest>): MarginView {
    const complete = trip.costComplete !== false;
    const warnings: string[] = [];
    if (!complete) {
        warnings.push(
            trip.linkId || trip.link
                ? 'Falta o custo do transportador: lance a Carta Frete da viagem ou cadastre o acordo da rota. Sem ele a margem não é calculada.'
                : 'Falta o custo da viagem, então a margem não é calculada.',
        );
        for (const item of trip.missing ?? []) {
            if (/LinkPricingAgreement/i.test(item)) continue;
            warnings.push(item);
        }
    }
    if (trip.revenueEstimated) {
        const n = trip.ordersWithoutOfficialFreight ?? 0;
        warnings.push(`${n} ${n === 1 ? 'pedido sem' : 'pedidos sem'} CT-e, DC-e ou minuta emitido: a receita é estimada, não confirmada.`);
    }
    if ((trip.ordersWithoutFreightValue ?? 0) > 0) {
        const n = trip.ordersWithoutFreightValue as number;
        warnings.push(`${n} ${n === 1 ? 'pedido sem valor de frete' : 'pedidos sem valor de frete'}: nada foi somado na receita.`);
    }
    const hasMargin = complete && trip.margin != null;
    return {
        complete,
        warnings,
        revenueNet: trip.revenueNet ?? null,
        linkCost: complete ? trip.linkCost ?? null : null,
        hubCost: trip.hubCost ?? null,
        margin: hasMargin ? (trip.margin as number) : null,
        marginPercent: hasMargin ? trip.marginPercent ?? null : null,
        hasMargin,
    };
}

export function linkCostSourceLabel(source: Manifest['linkCostSource']): string | null {
    if (source === 'CARTA_FRETE') return 'Carta Frete';
    if (source === 'ACORDO') return 'acordo com o transportador';
    return null;
}
