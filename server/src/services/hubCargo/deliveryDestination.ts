import prisma from '../../lib/prisma.js';
import { parseCityState } from '../acbr/acbrIbge.js';

/**
 * Destino de uma viagem de entrega: a cidade onde os pedidos escolhidos serão entregues
 * (Order.fimPrestacao / Order.fimIbgeCode), nunca a cidade do próprio hub.
 */
export interface DeliveryPoint {
    fimPrestacao?: string | null;
    fimIbgeCode?: string | null;
    weightKg: number;
}

export interface DeliveryDestination {
    city: string;
    state: string;
    cityIbgeCode: string;
    /** "Santa Inês, MA" ou "Santa Inês, MA +2 cidades" quando há outras cidades de entrega. */
    label: string;
    otherCities: number;
}

/** Catálogo IBGE (código -> nome/UF oficial); quando ausente cai no texto do pedido. */
export type CityCatalog = Map<string, { city: string; state: string }>;

export function pickDeliveryDestination(points: DeliveryPoint[], catalog: CityCatalog = new Map()): DeliveryDestination | null {
    const byCity = new Map<string, { city: string; state: string; weight: number }>();
    for (const point of points) {
        const ibge = point.fimIbgeCode?.trim();
        // O código IBGE é sempre escolhido, nunca inferido do nome da cidade.
        if (!ibge || !/^\d{7}$/.test(ibge)) continue;
        const known = catalog.get(ibge);
        const parsed = point.fimPrestacao ? parseCityState(point.fimPrestacao) : null;
        const city = known?.city ?? parsed?.city;
        const state = known?.state ?? parsed?.state;
        if (!city || !state) continue;
        const entry = byCity.get(ibge) ?? { city, state, weight: 0 };
        entry.weight += Math.max(0, point.weightKg);
        byCity.set(ibge, entry);
    }
    if (byCity.size === 0) return null;
    const ranked = [...byCity.entries()].sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]));
    const [cityIbgeCode, main] = ranked[0];
    const otherCities = ranked.length - 1;
    const base = `${main.city}, ${main.state}`;
    return {
        city: main.city,
        state: main.state,
        cityIbgeCode,
        otherCities,
        label: otherCities > 0 ? `${base} +${otherCities} ${otherCities === 1 ? 'cidade' : 'cidades'}` : base,
    };
}

export async function resolveDeliveryDestination(orderIds: string[]): Promise<DeliveryDestination | null> {
    if (orderIds.length === 0) return null;
    const orders = await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { fimPrestacao: true, fimIbgeCode: true, demand: { select: { weight: true, cubedWeight: true } } },
    });
    const codes = [...new Set(orders.map((o) => o.fimIbgeCode).filter((c): c is string => Boolean(c)))];
    const cities = codes.length
        ? await prisma.city.findMany({ where: { ibgeCode: { in: codes } }, include: { state: true } })
        : [];
    const catalog: CityCatalog = new Map(cities.map((c) => [c.ibgeCode, { city: c.name, state: c.state.code }]));
    return pickDeliveryDestination(
        orders.map((o) => ({
            fimPrestacao: o.fimPrestacao,
            fimIbgeCode: o.fimIbgeCode,
            weightKg: Math.max(o.demand?.weight ?? 0, o.demand?.cubedWeight ?? 0),
        })),
        catalog,
    );
}
