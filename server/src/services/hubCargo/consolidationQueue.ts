import prisma from '../../lib/prisma.js';
import { HUB_CARGO_ACTIVE_MANIFEST_STATUSES } from './hubCargoPolicy.js';
import { freightDocState, type FreightDocState } from '../freight/freightDocRules.js';

/**
 * Fila de consolidação por próximo salto (G1 — ver kersonpank/ex, TEIA-E-RODA.md).
 * Decisão local do nó: para cada pedido em estoque, "dado o destino final, qual o
 * melhor próximo salto a partir daqui?".
 *  1) HubCoverage (cidade do próprio hub vale como cobertura implícita) diz qual hub D
 *     é responsável pela cidade final;
 *  2) Hub.gatewayHubId (topologia em árvore/hub-and-spoke) diz por onde se chega a D:
 *     caminho(D) = [D, gateway(D), gateway(gateway(D)), ...]. Sem gateways, o próximo
 *     salto é o próprio D.
 */

export interface CoverageTarget {
    hubId: string;
    hubName: string;
    hubCode: string;
    priority: number;
    leadTimeDays: number | null;
    implicit: boolean;
}

export interface CoverageHubInfo {
    id: string;
    name: string;
    code: string;
    gatewayHubId: string | null;
}

/** Cidade IBGE → hubs responsáveis (ordenados), mais os hubs ativos e seus gateways. */
export interface CoverageIndex extends Map<string, CoverageTarget[]> {
    hubs: Map<string, CoverageHubInfo>;
}

/** Limite de profundidade ao subir a cadeia de gateways (proteção contra ciclo). */
export const MAX_GATEWAY_DEPTH = 32;

interface HubRow {
    id: string;
    name: string;
    code: string;
    cityIbgeCode: string | null;
    active: boolean;
    gatewayHubId?: string | null;
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
    const index = new Map<string, CoverageTarget[]>() as CoverageIndex;
    index.hubs = new Map(
        [...byId.values()].map((h) => [h.id, { id: h.id, name: h.name, code: h.code, gatewayHubId: h.gatewayHubId ?? null }]),
    );
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
    /** `target` = próximo salto; `final` = hub responsável pela cidade final (igual a `target` quando direto). */
    | { kind: 'TRANSFER'; target: CoverageTarget; final: CoverageTarget }
    | { kind: 'LOCAL' }
    | { kind: 'UNROUTED' };

/** Hub responsável pela cidade final (menor prioridade; empate por código). Ignora gateways. */
export function resolveFinalHub(index: CoverageIndex, cityIbgeCode: string | null | undefined): CoverageTarget | null {
    if (!cityIbgeCode) return null;
    return (index.get(cityIbgeCode) ?? [])[0] ?? null;
}

/**
 * Cadeia [hub, gateway, gateway do gateway, ...] até a raiz. Gateway inativo/inexistente
 * encerra a cadeia; ciclo (ou profundidade excessiva) é tratado como "sem gateway".
 */
function gatewayChain(index: CoverageIndex, hubId: string): string[] {
    const chain = [hubId];
    const seen = new Set(chain);
    let current = index.hubs.get(hubId)?.gatewayHubId ?? null;
    while (current && index.hubs.has(current)) {
        if (seen.has(current) || chain.length >= MAX_GATEWAY_DEPTH) return [hubId];
        chain.push(current);
        seen.add(current);
        current = index.hubs.get(current)?.gatewayHubId ?? null;
    }
    return chain;
}

function targetForHub(index: CoverageIndex, hubId: string, final: CoverageTarget): CoverageTarget {
    if (hubId === final.hubId) return final;
    const info = index.hubs.get(hubId)!;
    return { hubId: info.id, hubName: info.name, hubCode: info.code, priority: IMPLICIT_PRIORITY, leadTimeDays: null, implicit: true };
}

/**
 * Próximo salto a partir do hub atual H rumo à cidade final:
 *  D = hub responsável; se H == D → LOCAL.
 *  chain(D) = [D, gateway(D), ...]. Se H está em chain(D) → o elemento imediatamente antes de H.
 *  Senão, se H tem gateway → gateway(H) (sobe rumo ao tronco); senão → topo de chain(D).
 */
export function resolveNextHop(index: CoverageIndex, cityIbgeCode: string | null | undefined, currentHubId: string): NextHop {
    const final = resolveFinalHub(index, cityIbgeCode);
    if (!final) return { kind: 'UNROUTED' };
    if (final.hubId === currentHubId) return { kind: 'LOCAL' };
    const chain = gatewayChain(index, final.hubId);
    const at = chain.indexOf(currentHubId);
    let nextId: string;
    if (at > 0) {
        nextId = chain[at - 1];
    } else {
        const own = gatewayChain(index, currentHubId);
        nextId = own.length > 1 ? own[1] : chain[chain.length - 1];
    }
    return { kind: 'TRANSFER', target: targetForHub(index, nextId, final), final };
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
    /** Hub final do pedido quando diferente do próximo salto ("via"); null se o salto já é o destino. */
    finalHubId: string | null;
    finalHubCode: string | null;
    finalHubName: string | null;
    /** Prazo cadastrado (HubCoverage) do hub final para a cidade — só informativo. */
    leadTimeDays: number | null;
}

export interface ConsolidationQueueGroup {
    key: string;
    kind: 'TRANSFER' | 'LOCAL' | 'UNROUTED';
    /** Próximo salto (não o hub final). */
    destHubId: string | null;
    destHubName: string | null;
    destHubCode: string | null;
    /** Hub final comum a todos os pedidos do grupo, quando diferente do próximo salto. */
    finalHubId: string | null;
    finalHubCode: string | null;
    finalHubName: string | null;
    /** Maior prazo cadastrado entre os pedidos do grupo (informativo). */
    leadTimeDays: number | null;
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
                finalHubId: null,
                finalHubCode: null,
                finalHubName: null,
                leadTimeDays: null,
                orders: [],
                totalWeightKg: 0,
                totalVolumeM3: 0,
                totalValueBRL: 0,
                oldestSinceAt: order.sinceAt.toISOString(),
            };
            groups.set(key, group);
        }
        const via = hop.kind === 'TRANSFER' && hop.final.hubId !== hop.target.hubId ? hop.final : null;
        const leadTimeDays = hop.kind === 'TRANSFER' ? hop.final.leadTimeDays : null;
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
            finalHubId: via?.hubId ?? null,
            finalHubCode: via?.hubCode ?? null,
            finalHubName: via?.hubName ?? null,
            leadTimeDays,
        });
        if (leadTimeDays != null && leadTimeDays > (group.leadTimeDays ?? -1)) group.leadTimeDays = leadTimeDays;
        group.totalWeightKg += order.weightKg;
        group.totalVolumeM3 += order.volumeM3;
        group.totalValueBRL += order.valueBRL;
        if (order.sinceAt.toISOString() < group.oldestSinceAt) group.oldestSinceAt = order.sinceAt.toISOString();
    }
    for (const g of groups.values()) {
        const finals = new Set(g.orders.map((o) => o.finalHubId));
        if (finals.size === 1) {
            const first = g.orders[0];
            g.finalHubId = first.finalHubId;
            g.finalHubCode = first.finalHubCode;
            g.finalHubName = first.finalHubName;
        }
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
        prisma.hub.findMany({ select: { id: true, name: true, code: true, cityIbgeCode: true, active: true, gatewayHubId: true } }),
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
