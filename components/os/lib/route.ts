import type { Hub, ManifestStatus, ManifestTripType } from '../../../types/index';

/** Lógica pura do editor de rota (PATCH /manifests/:id/setup, só em DRAFT). */

export interface RouteCity {
    name: string;
    state: string;
    ibgeCode: string;
}

export interface RouteSetupPayload {
    origin?: string;
    originCity?: string;
    originState?: string;
    originCityIbgeCode?: string;
    destination?: string;
    destinationCity?: string;
    destinationState?: string;
    destinationCityIbgeCode?: string;
    destHubId?: string;
}

/** Transferências escolhem o hub de destino. */
export function tripUsesDestHub(tripType: ManifestTripType | undefined): boolean {
    return tripType === 'TRANSFER' || tripType === 'TRANSFER_DELIVERY';
}

/** A rota só muda com a viagem em rascunho: depois disso é preciso retirar a oferta ou reabrir. */
export function routeBlockedReason(status: ManifestStatus): string | null {
    if (status === 'DRAFT') return null;
    if (status === 'PENDING_ACCEPT') return 'A viagem já foi oferecida. Retire a oferta para editar a rota.';
    if (status === 'ACCEPTED') return 'O transportador já confirmou. Use "Reabrir planejamento" para editar a rota.';
    return 'Esta viagem não aceita mais alterações de rota.';
}

export function cityLabel(city: Pick<RouteCity, 'name' | 'state'>): string {
    return `${city.name}, ${city.state}`;
}

/**
 * Monta o corpo do PATCH /setup só com o que mudou (cidade + UF + IBGE juntos, como o servidor exige).
 * Retorna null quando não há nada a salvar.
 */
export function buildRoutePayload(input: {
    tripType: ManifestTripType | undefined;
    origin: RouteCity | null;
    destination: RouteCity | null;
    destHub: Pick<Hub, 'id' | 'city' | 'state' | 'cityIbgeCode'> | null;
}): RouteSetupPayload | null {
    const payload: RouteSetupPayload = {};
    if (input.origin) {
        payload.origin = cityLabel(input.origin);
        payload.originCity = input.origin.name;
        payload.originState = input.origin.state;
        payload.originCityIbgeCode = input.origin.ibgeCode;
    }
    if (tripUsesDestHub(input.tripType) && input.destHub) {
        payload.destHubId = input.destHub.id;
        if (input.tripType === 'TRANSFER' && !input.destination) {
            // Sem cidade informada, o servidor deriva destino/IBGE do hub; com IBGE no hub mandamos explícito.
            payload.destination = `${input.destHub.city}, ${input.destHub.state}`;
            if (input.destHub.cityIbgeCode) {
                payload.destinationCity = input.destHub.city;
                payload.destinationState = input.destHub.state;
                payload.destinationCityIbgeCode = input.destHub.cityIbgeCode;
            }
        }
    }
    if (input.destination) {
        payload.destination = cityLabel(input.destination);
        payload.destinationCity = input.destination.name;
        payload.destinationState = input.destination.state;
        payload.destinationCityIbgeCode = input.destination.ibgeCode;
    }
    return Object.keys(payload).length > 0 ? payload : null;
}

/** Resultado de /locations/cities → escolha de cidade (descarta o que veio sem IBGE ou UF). */
export function toRouteCity(hit: { ibgeCode?: string; name?: string; state?: { code?: string } | null }): RouteCity | null {
    if (!hit.ibgeCode || !hit.name || !hit.state?.code) return null;
    return { name: hit.name, state: hit.state.code, ibgeCode: String(hit.ibgeCode) };
}
