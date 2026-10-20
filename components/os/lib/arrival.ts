import type { Manifest, ManifestStop } from '../../../types/index';

/**
 * Lógica pura do fluxo "Receber chegada" do TSM O.S. (sem React, sem rede),
 * para o TripReceivePage e testes. Ver kersonpank/ex → PLANO-TSM-OS-HUB.md (F1).
 */

/** Perna retornada pelo backend dentro do manifesto (o tipo global Manifest não a declara). */
export interface ArrivalLeg {
    id: string;
    orderId: string;
    legType?: 'COLETA' | 'TRANSFERENCIA' | 'ENTREGA';
    destHubId?: string | null;
    stopId?: string | null;
    completedAt?: string | null;
    order?: {
        id: string;
        status?: string;
        nfNumber?: string | null;
        demand?: { orderNumber?: number | null; destination?: string | null } | null;
    } | null;
}

export type ManifestWithLegs = Manifest & { legs?: ArrivalLeg[] };

/** Parada deste hub ainda não concluída (a descarga que o operador vai receber). */
export function arrivalStopForHub(manifest: ManifestWithLegs, hubId: string): ManifestStop | null {
    const stops = manifest.tripStops ?? [];
    return stops.find((s) => s.destHubId === hubId && !s.completedAt) ?? null;
}

/** A viagem está em rota e tem descarga pendente neste hub? */
export function isArrivingAtHub(manifest: ManifestWithLegs, hubId: string): boolean {
    if (manifest.status !== 'IN_PROGRESS') return false;
    if (arrivalStopForHub(manifest, hubId)) return true;
    // Sem paradas estruturadas: vale o destino principal da viagem.
    const hasHubStops = (manifest.tripStops ?? []).some((s) => s.destHubId);
    return !hasHubStops && manifest.destHubId === hubId;
}

export function arrivingManifests(manifests: ManifestWithLegs[], hubId: string): ManifestWithLegs[] {
    return manifests.filter((m) => isArrivingAtHub(m, hubId));
}

export interface UnloadItem {
    legId: string;
    orderId: string;
    nfNumber: string | null;
    orderNumber: number | null;
    destination: string | null;
}

/** Pedidos que descem neste hub: pernas de transferência destinadas a ele (ou à sua parada). */
export function ordersToUnload(manifest: ManifestWithLegs, hubId: string): UnloadItem[] {
    const stop = arrivalStopForHub(manifest, hubId);
    const legs = manifest.legs ?? [];
    const relevant = legs.filter((leg) => {
        if (leg.legType === 'ENTREGA') return false;
        if (stop && leg.stopId) return leg.stopId === stop.id;
        return leg.destHubId === hubId || (!leg.destHubId && manifest.destHubId === hubId);
    });
    return relevant.map((leg) => ({
        legId: leg.id,
        orderId: leg.orderId,
        nfNumber: leg.order?.nfNumber ?? null,
        orderNumber: leg.order?.demand?.orderNumber ?? null,
        destination: leg.order?.demand?.destination ?? null,
    }));
}

export type ConferenceMark = 'OK' | 'AVARIA' | 'FALTA';

export interface ConferenceSummary {
    total: number;
    marked: number;
    ok: number;
    avaria: number;
    falta: number;
    hasDivergence: boolean;
    allMarked: boolean;
}

export function summarizeConference(
    items: UnloadItem[],
    marks: Record<string, ConferenceMark | undefined>,
): ConferenceSummary {
    let ok = 0;
    let avaria = 0;
    let falta = 0;
    for (const item of items) {
        const mark = marks[item.orderId];
        if (mark === 'OK') ok += 1;
        else if (mark === 'AVARIA') avaria += 1;
        else if (mark === 'FALTA') falta += 1;
    }
    const marked = ok + avaria + falta;
    return {
        total: items.length,
        marked,
        ok,
        avaria,
        falta,
        hasDivergence: avaria + falta > 0,
        allMarked: marked === items.length && items.length > 0,
    };
}

/**
 * Regra central da estação: nunca encerrar em silêncio.
 * Só conclui com tudo conferido e, havendo divergência, com o reconhecimento explícito.
 */
export function canConclude(summary: ConferenceSummary, divergenceAcknowledged: boolean): boolean {
    if (!summary.allMarked) return false;
    if (summary.hasDivergence && !divergenceAcknowledged) return false;
    return true;
}

/** Texto do evento de divergência gravado no histórico do pedido (ator vem da sessão). */
export function divergenceDescription(
    mark: ConferenceMark,
    manifest: { origin: string; destination: string },
    note?: string,
): string {
    const kind = mark === 'FALTA' ? 'volume não chegou' : 'chegou com avaria';
    const suffix = note?.trim() ? ` — ${note.trim()}` : '';
    return `[DIVERGÊNCIA NA CHEGADA] ${kind} (viagem ${manifest.origin} → ${manifest.destination})${suffix}`;
}
