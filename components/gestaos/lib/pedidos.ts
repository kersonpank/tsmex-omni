import type { OrderListItem, OrderStatus } from '../../../types/index';
import { cityOnly } from './format';
import type { Tone } from './trips';

/** Regras puras da tela Pedidos: situação traduzida, filtros do servidor, onde está a carga e paginação. */

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
    PENDING: 'Aguardando',
    AT_HUB: 'No hub',
    IN_TRANSIT: 'Em trânsito',
    OUT_FOR_DELIVERY: 'Saiu para entrega',
    DELIVERED: 'Entregue',
    CANCELLED: 'Cancelado',
};

const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
    PENDING: 'yellow',
    AT_HUB: 'neutral',
    IN_TRANSIT: 'royal',
    OUT_FOR_DELIVERY: 'royal',
    DELIVERED: 'neutral',
    CANCELLED: 'neutral',
};

export function orderStatusLabel(status: string | null | undefined): string {
    return ORDER_STATUS_LABEL[status as OrderStatus] ?? 'Situação desconhecida';
}

export function orderStatusTone(status: string | null | undefined): Tone {
    return ORDER_STATUS_TONE[status as OrderStatus] ?? 'neutral';
}

export type OrderFilter = 'all' | 'AT_HUB' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'PENDING';

export const ORDER_FILTERS: Array<{ id: OrderFilter; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'AT_HUB', label: 'No hub' },
    { id: 'IN_TRANSIT', label: 'Em trânsito' },
    { id: 'OUT_FOR_DELIVERY', label: 'Saiu para entrega' },
    { id: 'DELIVERED', label: 'Entregue' },
    { id: 'PENDING', label: 'Aguardando' },
];

export const PAGE_SIZE = 50;

/** Filtros que vão ao servidor, iguais para a lista e para os totais (aggregate). */
export function orderFilterParams(query: string, filter: OrderFilter): { q?: string; status?: string } {
    const q = query.trim();
    return { ...(q ? { q } : {}), ...(filter !== 'all' ? { status: filter } : {}) };
}

export function pageRange(offset: number, shown: number, total: number): string {
    if (total <= 0 || shown <= 0) return '0 de 0';
    return `${offset + 1}–${offset + shown} de ${total}`;
}

/** Cidade/UF de uma pessoa do pedido; sem cadastro, cai no texto livre da demanda. */
export function placeOf(person: { legalName?: string; city?: string | null; state?: string | null } | null | undefined, fallback?: string | null): string {
    if (person?.city) return person.state ? `${person.city}/${person.state}` : person.city;
    return fallback ? cityOnly(fallback) : '—';
}

/** Onde a carga está agora, em uma expressão curta. */
export function orderWhere(order: Pick<OrderListItem, 'status' | 'currentHub'>): string {
    switch (order.status) {
        case 'IN_TRANSIT':
            return 'Na estrada';
        case 'OUT_FOR_DELIVERY':
            return 'Em rota de entrega';
        case 'DELIVERED':
            return 'Entregue ao destinatário';
        case 'CANCELLED':
            return 'Cancelado';
        case 'AT_HUB':
            return order.currentHub?.name ?? 'No hub';
        default:
            return order.currentHub?.name ?? 'Ainda sem hub';
    }
}

export function parseOrderPage(value: string | null): number {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : 0;
}
