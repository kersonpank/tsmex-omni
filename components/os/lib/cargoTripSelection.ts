import type { ConsolidationQueueGroup } from '../../../types/index';

/** Revalida a seleção de estoque com a fila atual antes de abrir a montagem. */
export function buildStockTripSelection(groups: ConsolidationQueueGroup[], orderIds: string[]): {
    group: ConsolidationQueueGroup | null;
    missingOrderIds: string[];
} {
    const requested = [...new Set(orderIds)];
    const queued = new Map(groups.flatMap((group) => group.orders.map((order) => [order.orderId, order] as const)));
    const missingOrderIds = requested.filter((id) => !queued.has(id));
    if (requested.length === 0 || missingOrderIds.length > 0) return { group: null, missingOrderIds };

    const orders = requested.map((id) => queued.get(id)!).sort((a, b) => a.sinceAt.localeCompare(b.sinceAt));
    return {
        missingOrderIds: [],
        group: {
            key: 'stock-selection',
            kind: 'UNROUTED',
            destHubId: null,
            destHubName: null,
            destHubCode: null,
            orders,
            totalWeightKg: orders.reduce((sum, order) => sum + order.weightKg, 0),
            totalVolumeM3: orders.reduce((sum, order) => sum + order.volumeM3, 0),
            totalValueBRL: orders.reduce((sum, order) => sum + order.valueBRL, 0),
            oldestSinceAt: orders[0].sinceAt,
        },
    };
}
