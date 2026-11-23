import type { Manifest, ManifestStop } from '../../../types/index';
import type { ArrivalLeg, ManifestWithLegs, UnloadItem } from '../../os/lib/arrival';

/**
 * Chegada, conferência e entrega pela torre (sem React, sem rede). A regra de negócio é a do TSM O.S.
 * (`components/os/lib/arrival.ts` e `delivery.ts`); aqui só se generaliza "o hub da pessoa" para
 * "cada ponto de descarga da viagem", já que a torre não pertence a um hub.
 */

export interface UnloadPoint {
    /** Parada estruturada; `null` quando a viagem não tem paradas com hub (vale o destino da viagem). */
    stop: ManifestStop | null;
    label: string;
    items: UnloadItem[];
    arrivedAt: string | null;
    completedAt: string | null;
}

const hasHub = (stop: ManifestStop) => Boolean(stop.destHubId) && stop.purpose !== 'DELIVERY';

export const isTransferTrip = (trip: Pick<Manifest, 'tripType'>) => trip.tripType !== 'DELIVERY';
export const isDeliveryTrip = (trip: Pick<Manifest, 'tripType'>) => trip.tripType === 'DELIVERY' || trip.tripType === 'TRANSFER_DELIVERY';

function toItem(leg: ArrivalLeg): UnloadItem {
    return {
        legId: leg.id,
        orderId: leg.orderId,
        nfNumber: leg.order?.nfNumber ?? leg.order?.invoices?.[0]?.nfNumber ?? null,
        nfKeys: (leg.order?.invoices ?? []).map((invoice) => invoice.nfKey).filter((key): key is string => Boolean(key)),
        orderNumber: leg.order?.demand?.orderNumber ?? null,
        destination: leg.order?.demand?.destination ?? null,
    };
}

/** Pedidos que descem numa parada (mesma regra do O.S.: perna ligada à parada, ou ao hub dela). */
export function unloadItemsForStop(trip: ManifestWithLegs, stop: ManifestStop | null): UnloadItem[] {
    const legs = trip.legs ?? [];
    const relevant = legs.filter((leg) => {
        if (leg.legType === 'ENTREGA') return false;
        if (!stop) return !leg.destHubId || leg.destHubId === trip.destHubId;
        if (leg.stopId) return leg.stopId === stop.id;
        return leg.destHubId === stop.destHubId || (!leg.destHubId && trip.destHubId === stop.destHubId);
    });
    return relevant.map(toItem);
}

/** Pontos de descarga da viagem, na ordem do percurso. Viagem só de entrega não tem. */
export function unloadPoints(trip: ManifestWithLegs): UnloadPoint[] {
    if (!isTransferTrip(trip)) return [];
    const stops = [...(trip.tripStops ?? [])].filter(hasHub).sort((a, b) => a.sequence - b.sequence);
    if (stops.length === 0) {
        if (!trip.destHubId && !trip.destination) return [];
        return [{ stop: null, label: trip.destination ?? 'Destino da viagem', items: unloadItemsForStop(trip, null), arrivedAt: trip.arrivedAt ?? null, completedAt: trip.status === 'COMPLETED' ? trip.completedAt ?? trip.updatedAt : null }];
    }
    return stops.map((stop) => ({
        stop,
        label: stop.destHub?.name ?? stop.destinationLabel ?? stop.destCity ?? 'Parada',
        items: unloadItemsForStop(trip, stop),
        arrivedAt: stop.arrivedAt ?? null,
        completedAt: stop.completedAt ?? null,
    }));
}

/** Mensagem para quando o servidor recusa por a viagem ter mudado (409): atualizar, não repetir. */
export const STALE_TRIP_MESSAGE = 'A viagem mudou enquanto você trabalhava. Atualize a tela, confira o estado e só então repita.';

export function isConflict(cause: unknown): boolean {
    return (cause as { response?: { status?: number } } | null)?.response?.status === 409;
}

/** Texto legível do erro de API: 409 vira "a viagem mudou"; senão a mensagem do servidor; senão o fallback. */
export function docaErrorMessage(cause: unknown, fallback: string): string {
    if (isConflict(cause)) return STALE_TRIP_MESSAGE;
    const data = (cause as { response?: { data?: { error?: string; message?: string } } } | null)?.response?.data;
    return data?.error ?? data?.message ?? fallback;
}

export interface DivergenceInput {
    mark: 'OK' | 'AVARIA' | 'FALTA' | undefined;
    note: string | undefined;
}

/** Divergência (avaria ou não chegou) exige nota com ao menos 3 caracteres. */
export function divergenceNoteProblem(input: DivergenceInput): string | null {
    if (input.mark !== 'AVARIA' && input.mark !== 'FALTA') return null;
    return (input.note ?? '').trim().length >= 3 ? null : 'Conte o que aconteceu (mínimo de 3 caracteres).';
}

export type ConcludeKind = 'stop' | 'trip';

/** Concluir uma parada estruturada ou a viagem inteira (sem paradas com hub). */
export const concludeKindFor = (point: UnloadPoint): ConcludeKind => (point.stop ? 'stop' : 'trip');

/** Avarias com foto: depois da conclusão a foto vai ao histórico do pedido. */
export function damagePhotos(items: UnloadItem[], marks: Record<string, string | undefined>, photos: Record<string, string | undefined>): Array<{ orderId: string; photoUrl: string }> {
    return items
        .filter((item) => marks[item.orderId] === 'AVARIA' && photos[item.orderId])
        .map((item) => ({ orderId: item.orderId, photoUrl: photos[item.orderId] as string }));
}
