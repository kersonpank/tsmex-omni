import type { Hub, HubExceptionItem, Manifest, OperationsSummaryData } from '../../../types/index';
import { isLiveTrip } from './trips';

/** Leitura da rede por hub: estoque, exceções e viagens que saem e chegam. Regras puras. */

export interface HubRow {
    hub: Hub;
    /** Pedidos em estoque neste hub. */
    stock: number;
    /** Exceções abertas deste hub. */
    exceptions: number;
    /** Dessas, as que já venceram o prazo. */
    overdue: number;
    /** Viagens com origem aqui que ainda não saíram ou estão na estrada. */
    departing: number;
    /** Viagens na estrada com destino aqui. */
    arriving: number;
    /** Nome do hub que abastece este (gatewayHubId), quando existe. */
    gatewayName: string | null;
}

export interface RedeTotals {
    activeHubs: number;
    stock: number;
    inTransit: number;
    aged7d: number;
}

export function buildHubRows(
    hubs: Hub[],
    summary: Pick<OperationsSummaryData, 'estoque'> | null | undefined,
    exceptions: Pick<HubExceptionItem, 'hubId' | 'overdue'>[] | null | undefined,
    trips: Manifest[] | null | undefined,
): HubRow[] {
    const stockByHub = new Map<string, number>();
    for (const entry of summary?.estoque?.porHub ?? []) stockByHub.set(entry.hubId, entry.count);

    const exByHub = new Map<string, { total: number; overdue: number }>();
    for (const item of exceptions ?? []) {
        if (!item.hubId) continue;
        const current = exByHub.get(item.hubId) ?? { total: 0, overdue: 0 };
        current.total += 1;
        if (item.overdue) current.overdue += 1;
        exByHub.set(item.hubId, current);
    }

    const departing = new Map<string, number>();
    const arriving = new Map<string, number>();
    for (const trip of trips ?? []) {
        if (!isLiveTrip(trip) || trip.status === 'COMPLETED') continue;
        if (trip.hubId) departing.set(trip.hubId, (departing.get(trip.hubId) ?? 0) + 1);
        if (trip.destHubId && trip.status === 'IN_PROGRESS') arriving.set(trip.destHubId, (arriving.get(trip.destHubId) ?? 0) + 1);
    }

    const nameById = new Map(hubs.map((hub) => [hub.id, hub.name]));

    return hubs
        .map<HubRow>((hub) => {
            const ex = exByHub.get(hub.id);
            return {
                hub,
                stock: stockByHub.get(hub.id) ?? 0,
                exceptions: ex?.total ?? 0,
                overdue: ex?.overdue ?? 0,
                departing: departing.get(hub.id) ?? 0,
                arriving: arriving.get(hub.id) ?? 0,
                gatewayName: hub.gatewayHubId ? nameById.get(hub.gatewayHubId) ?? null : null,
            };
        })
        .sort((a, b) => Number(b.hub.active) - Number(a.hub.active) || b.overdue - a.overdue || b.exceptions - a.exceptions || a.hub.name.localeCompare(b.hub.name, 'pt-BR'));
}

export function redeTotals(hubs: Hub[], summary: Pick<OperationsSummaryData, 'estoque'> | null | undefined): RedeTotals {
    return {
        activeHubs: hubs.filter((hub) => hub.active).length,
        stock: summary?.estoque?.pedidosNoCd ?? 0,
        inTransit: summary?.estoque?.pedidosEmTransito ?? 0,
        aged7d: summary?.estoque?.agingMais7d ?? 0,
    };
}
