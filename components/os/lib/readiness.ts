import type { FreightDocState } from '../../../types/index';

/**
 * Regras puras de "pronto para viajar" do TSM O.S. (sem React, sem rede): estado do documento
 * do frete, encaixe no veículo e checklist do pedido. Spec 2026-10-20 §5–§6.
 */

export type DocTone = 'ok' | 'warn' | 'bad' | 'neutral';

export function docBadge(state: FreightDocState | undefined | null): { tone: DocTone; label: string } {
    switch (state) {
        case 'emitted':
            return { tone: 'ok', label: 'documentado' };
        case 'in_flight':
            return { tone: 'warn', label: 'documento enviando' };
        case 'rejected':
            return { tone: 'bad', label: 'documento rejeitado' };
        default:
            return { tone: 'bad', label: 'sem documento' };
    }
}

/** Só pedido documentado viaja: os demais começam desmarcados na montagem da viagem. */
export function isDocumented(state: FreightDocState | undefined | null): boolean {
    return state === 'emitted';
}

export function splitByDoc<T extends { freightDocState?: FreightDocState }>(orders: T[]): { documented: T[]; undocumented: T[] } {
    const documented: T[] = [];
    const undocumented: T[] = [];
    for (const order of orders) (isDocumented(order.freightDocState) ? documented : undocumented).push(order);
    return { documented, undocumented };
}

export type VehicleFit = 'ok' | 'weight' | 'volume';

/** Cabe se o peso e (quando o tipo tem limite de m³) o volume cabem. Peso é avaliado primeiro. */
export function vehicleFit(weightKg: number, volumeM3: number, type: { maxWeight: number; maxVolume?: number | null }): VehicleFit {
    if (weightKg > type.maxWeight) return 'weight';
    if (type.maxVolume != null && type.maxVolume > 0 && volumeM3 > type.maxVolume) return 'volume';
    return 'ok';
}

export interface OrderLike {
    id?: string;
    nfNumber?: string | null;
    freightDocState?: FreightDocState;
    demand?: { orderNumber?: number | null } | null;
}

export function orderLabel(order: { nfNumber?: string | null; demand?: { orderNumber?: number | null } | null } | null | undefined, fallbackId?: string): string {
    const number = order?.demand?.orderNumber;
    const base = number ? `Pedido ${number}` : fallbackId ? `Pedido ${fallbackId.slice(0, 8)}` : 'Pedido';
    return order?.nfNumber ? `${base} · NF ${order.nfNumber}` : base;
}

/** Pedidos da viagem cujo documento do frete ainda não está emitido. */
export function legsWithoutDoc<L extends { orderId: string; order?: OrderLike | null }>(legs: L[]): L[] {
    return legs.filter((leg) => !isDocumented(leg.order?.freightDocState));
}

export interface ReadinessItem {
    key: 'stock' | 'document';
    label: string;
    ok: boolean;
}

/** Checklist "Pronto para viajar?" do pedido. Itens sem dado disponível no cliente ficam de fora. */
export function orderReadiness(input: { inStock?: boolean | null; docState?: FreightDocState | null }): { items: ReadinessItem[]; ready: boolean } {
    const items: ReadinessItem[] = [];
    if (input.inStock != null) {
        items.push({ key: 'stock', label: input.inStock ? 'Em estoque neste hub' : 'Não está em estoque neste hub', ok: input.inStock });
    }
    if (input.docState != null) {
        const documented = isDocumented(input.docState);
        items.push({
            key: 'document',
            label: documented ? 'Documento do frete emitido' : docBadge(input.docState).label === 'documento enviando' ? 'Documento do frete em envio' : 'Documento do frete pendente',
            ok: documented,
        });
    }
    return { items, ready: items.length > 0 && items.every((i) => i.ok) };
}
