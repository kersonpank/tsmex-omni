import prisma from '../../lib/prisma.js';
import { HUB_CARGO_ACTIVE_MANIFEST_STATUSES } from './hubCargoPolicy.js';
import { freightDocState, type FreightDocState } from '../freight/freightDocRules.js';

/**
 * Fila de consolidação por próximo salto (G1 — ver kersonpank/ex, TEIA-E-RODA.md).
 * Decisão local do nó: para cada pedido em estoque, "dado o destino final, qual o
 * melhor próximo salto a partir daqui?" — respondido pela tabela de roteamento
 * (HubCoverage; cidade do próprio hub vale como cobertura implícita).
 */

export interface CoverageTarget {
    hubId: string;
    hubName: string;
    hubCode: string;
    priority: number;
    leadTimeDays: number | null;
    implicit: boolean;
}

export type CoverageIndex = Map<string, CoverageTarget[]>;

interface HubRow {
    id: string;
    name: string;
    code: string;
    cityIbgeCode: string | null;
    active: boolean;
}

interface CoverageRow {
    hubId: string;
    cityIbgeCode: string;
    priority: number;
    leadTimeDays: number | null;
}

/** Prioridade implícita (cidade do próprio hub) perde de qualquer linha explícita. */
export const IMPLICIT_PRIORITY = 10_000;

export function buildCoverageIndex(hubs: HubRow[], rows: CoverageRow[]): CoverageIndex {
    const byId = new Map(hubs.filter((h) => h.active).map((h) => [h.id, h]));
    const index: CoverageIndex = new Map();
    const push = (city: string, target: CoverageTarget) => {
        const list = index.get(city) ?? [];
        list.push(target);
        index.set(city, list);
    };
    for (const row of rows) {
        const hub = byId.get(row.hubId);
        if (!hub) continue;
        push(row.cityIbgeCode, {
            hubId: hub.id,
            hubName: hub.name,
            hubCode: hub.code,
            priority: row.priority,
            leadTimeDays: row.leadTimeDays,
            implicit: false,
        });
    }
    for (const hub of byId.values()) {
        if (!hub.cityIbgeCode) continue;
        const existing = index.get(hub.cityIbgeCode) ?? [];
        if (existing.some((t) => t.hubId === hub.id)) continue;
        push(hub.cityIbgeCode, {
            hubId: hub.id,
            hubName: hub.name,
            hubCode: hub.code,
            priority: IMPLICIT_PRIORITY,
            leadTimeDays: null,
            implicit: true,
        });
    }
    for (const list of index.values()) {
        list.sort((a, b) => a.priority - b.priority || a.hubCode.localeCompare(b.hubCode));
    }
    return index;
}

export type NextHop =
    | { kind: 'TRANSFER'; target: CoverageTarget }
    | { kind: 'LOCAL' }
    | { kind: 'UNROUTED' };

export function resolveNextHop(index: CoverageIndex, cityIbgeCode: string | null | undefined, currentHubId: string): NextHop {
    if (!cityIbgeCode) return { kind: 'UNROUTED' };
    const target = (index.get(cityIbgeCode) ?? [])[0];
    if (!target) return { kind: 'UNROUTED' };
    if (target.hubId === currentHubId) return { kind: 'LOCAL' };
    return { kind: 'TRANSFER', target };
}

export interface QueueOrderInput {
    id: string;
    orderNumber: number | null;
    nfNumber: string | null;
    fimIbgeCode: string | null;
    sinceAt: Date;
    destinationLabel: string | null;
    weightKg: number;
    volumeM3: number;
    valueBRL: number;
    /** Estado do documento do frete (CT-e/DC-e/minuta). Ausente = sem documento. */
    freightDocState?: FreightDocState;
}

export interface QueueOrderItem {
    orderId: string;
    orderNumber: number | null;
    nfNumber: string | null;
    destination: string | null;
    weightKg: number;
    volumeM3: number;
    valueBRL: number;
    freightDocState: FreightDocState;
    sinceAt: string;
}

export interface ConsolidationQueueGroup {
    key: string;
    kind: 'TRANSFER' | 'LOCAL' | 'UNROUTED';
    destHubId: string | null;
    destHubName: string | null;
    destHubCode: string | null;
    orders: QueueOrderItem[];
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValueBRL: number;
    oldestSinceAt: string;
}

export function groupOrdersByNextHop(
    orders: QueueOrderInput[],
    index: CoverageIndex,
    currentHubId: string,
): ConsolidationQueueGroup[] {
    const groups = new Map<string, ConsolidationQueueGroup>();
    for (const order of orders) {
        const hop = resolveNextHop(index, order.fimIbgeCode, currentHubId);
        const key = hop.kind === 'TRANSFER' ? `TRANSFER:${hop.target.hubId}` : hop.kind;
        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                kind: hop.kind,
                destHubId: hop.kind === 'TRANSFER' ? hop.target.hubId : null,
                destHubName: hop.kind === 'TRANSFER' ? hop.target.hubName : null,
                destHubCode: hop.kind === 'TRANSFER' ? hop.target.hubCode : null,
                orders: [],
                totalWeightKg: 0,
                totalVolumeM3: 0,
                totalValueBRL: 0,
                oldestSinceAt: order.sinceAt.toISOString(),
            };
            groups.set(key, group);
        }
        group.orders.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            nfNumber: order.nfNumber,
            destination: order.destinationLabel,
            weightKg: order.weightKg,
            volumeM3: order.volumeM3,
            valueBRL: order.valueBRL,
            freightDocState: order.freightDocState ?? 'none',
            sinceAt: order.sinceAt.toISOString(),
        });
        group.totalWeightKg += order.weightKg;
        group.totalVolumeM3 += order.volumeM3;
        group.totalValueBRL += order.valueBRL;
        if (order.sinceAt.toISOString() < group.oldestSinceAt) group.oldestSinceAt = order.sinceAt.toISOString();
    }
    const rank = { TRANSFER: 0, LOCAL: 1, UNROUTED: 2 } as const;
    return [...groups.values()]
        .map((g) => ({ ...g, orders: g.orders.sort((a, b) => a.sinceAt.localeCompare(b.sinceAt)) }))
        .sort((a, b) => rank[a.kind] - rank[b.kind] || b.totalWeightKg - a.totalWeightKg);
}

/** Pedidos em estoque neste hub, fora de viagem ativa, agrupados por próximo salto. */
export async function getConsolidationQueues(hubId: string): Promise<ConsolidationQueueGroup[]> {
    const [orders, hubs, coverage] = await Promise.all([
        prisma.order.findMany({
            where: {
                currentHubId: hubId,
                status: 'AT_HUB',
                legs: { none: { manifest: { status: { in: HUB_CARGO_ACTIVE_MANIFEST_STATUSES } } } },
            },
            select: {
                id: true,
                fimIbgeCode: true,
                enteredAtHubAt: true,
                createdAt: true,
                nfNumber: true,
                freightCalculations: { select: { status: true } },
                demand: {
                    select: { orderNumber: true, destination: true, weight: true, volume: true, nfValue: true },
                },
            },
        }),
        prisma.hub.findMany({ select: { id: true, name: true, code: true, cityIbgeCode: true, active: true } }),
        prisma.hubCoverage.findMany({
            where: { active: true },
            select: { hubId: true, cityIbgeCode: true, priority: true, leadTimeDays: true },
        }),
    ]);

    const index = buildCoverageIndex(hubs, coverage);
    const inputs: QueueOrderInput[] = orders.map((o) => ({
        id: o.id,
        orderNumber: o.demand?.orderNumber ?? null,
        nfNumber: o.nfNumber ?? null,
        fimIbgeCode: o.fimIbgeCode ?? null,
        sinceAt: o.enteredAtHubAt ?? o.createdAt,
        destinationLabel: o.demand?.destination ?? null,
        weightKg: o.demand?.weight ?? 0,
        volumeM3: o.demand?.volume ?? 0,
        valueBRL: o.demand?.nfValue ?? 0,
        freightDocState: freightDocState(o.freightCalculations),
    }));
    return groupOrdersByNextHop(inputs, index, hubId);
}
