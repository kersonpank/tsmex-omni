import type { CreateManifestRequest, Hub, Manifest, ManifestReadiness, ManifestReadinessIssue, ManifestStatus, ManifestTripType } from '../../../types/index';
import { groupIssues, type TripGroupKey } from '../../os/lib/trip';
import { cityOnly } from './format';

/** Regras puras da página de trabalho da viagem: formulário de criação, etapas e o que cada estado permite. */

export type NewTripType = Exclude<ManifestTripType, 'REGIONAL_DISTRIBUTION'>;

export const NEW_TRIP_TYPES: Array<{ value: NewTripType; label: string; helper: string }> = [
    { value: 'TRANSFER', label: 'Transferência', helper: 'Entre filiais ou hubs' },
    { value: 'DELIVERY', label: 'Entrega', helper: 'Direto até o destino final' },
    { value: 'TRANSFER_DELIVERY', label: 'Mista', helper: 'Passa por um hub e segue até a cidade final' },
];

export const usesDestHub = (type: NewTripType): boolean => type === 'TRANSFER' || type === 'TRANSFER_DELIVERY';
export const usesDestCity = (type: NewTripType): boolean => type !== 'TRANSFER';

export interface CityPick {
    city: string;
    state: string;
    ibgeCode: string;
}

export interface NewTripValues {
    tripType: NewTripType;
    hubId: string | null;
    destHubId: string | null;
    destCity: CityPick | null;
    startsWithCollection: boolean;
    originCity: CityPick | null;
    vehicleTypeId: string | null;
}

export type NewTripErrors = Partial<Record<'hubId' | 'destHubId' | 'destCity' | 'originCity' | 'vehicleTypeId', string>>;

const cityLabel = (city: Pick<CityPick, 'city' | 'state'>) => `${city.city}, ${city.state}`;

/** Mesmas travas da criação clássica: IBGE de origem/destino confirmado, hub de destino nos tipos com transferência. */
export function validateNewTrip(values: NewTripValues, hubs: Hub[]): NewTripErrors {
    const errors: NewTripErrors = {};
    const hub = hubs.find((item) => item.id === values.hubId);
    if (!values.hubId || !hub) errors.hubId = 'Selecione o hub de origem.';
    else if (values.startsWithCollection) {
        if (!values.originCity) errors.originCity = 'Selecione a cidade da coleta.';
    } else if (!hub.cityIbgeCode) errors.hubId = 'O cadastro deste hub está sem código IBGE da cidade. Corrija o hub antes.';

    if (usesDestHub(values.tripType)) {
        const destHub = hubs.find((item) => item.id === values.destHubId);
        if (!values.destHubId || !destHub) errors.destHubId = values.tripType === 'TRANSFER' ? 'Selecione o hub de destino.' : 'Selecione o hub de transferência.';
        else if (values.destHubId === values.hubId) errors.destHubId = 'O hub de destino precisa ser diferente do de origem.';
        else if (values.tripType === 'TRANSFER' && !destHub.cityIbgeCode) errors.destHubId = 'O cadastro do hub de destino está sem código IBGE da cidade.';
    }
    if (usesDestCity(values.tripType) && !values.destCity) {
        errors.destCity = 'Escolha a cidade na lista para confirmar o código IBGE do destino.';
    }
    if (!values.vehicleTypeId) errors.vehicleTypeId = 'Selecione o tipo de veículo.';
    return errors;
}

/** Corpo do POST /manifests. Só chame depois de `validateNewTrip` devolver vazio. */
export function buildCreateBody(values: NewTripValues, hubs: Hub[]): CreateManifestRequest {
    const hub = hubs.find((item) => item.id === values.hubId) as Hub;
    const destHub = hubs.find((item) => item.id === values.destHubId);
    const origin: CityPick =
        values.startsWithCollection && values.originCity
            ? values.originCity
            : { city: hub.city, state: hub.state, ibgeCode: hub.cityIbgeCode ?? '' };
    const destination: CityPick | null =
        values.tripType === 'TRANSFER' && destHub ? { city: destHub.city, state: destHub.state, ibgeCode: destHub.cityIbgeCode ?? '' } : values.destCity;
    const body: CreateManifestRequest = {
        vehicleTypeId: values.vehicleTypeId as string,
        origin: cityLabel(origin),
        originCity: origin.city,
        originState: origin.state,
        originCityIbgeCode: origin.ibgeCode || undefined,
        destination: destination ? cityLabel(destination) : '',
        destinationCity: destination?.city,
        destinationState: destination?.state,
        destinationCityIbgeCode: destination?.ibgeCode || undefined,
        startsWithCollection: values.startsWithCollection,
        tripType: values.tripType,
        hubId: values.hubId as string,
    };
    if (usesDestHub(values.tripType) && values.destHubId) body.destHubId = values.destHubId;
    return body;
}

/** `?orders=a,b` → lista sem vazios nem repetidos. */
export function parseOrderIds(param: string | null | undefined): string[] {
    return [...new Set((param ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
}

/** Destino comum dos pedidos (rótulo "Cidade, UF" + IBGE iguais em todos) ou null — sugestão do Copilot. */
export function commonDestination(orders: Array<{ fimPrestacao?: string | null; fimIbgeCode?: string | null }>): CityPick | null {
    if (!orders.length) return null;
    const first = orders[0];
    const label = first.fimPrestacao?.trim();
    const code = first.fimIbgeCode?.trim();
    if (!label || !code) return null;
    if (orders.some((order) => order.fimPrestacao?.trim() !== label || order.fimIbgeCode?.trim() !== code)) return null;
    const matched = label.match(/^(.+),\s*([A-Z]{2})$/i);
    return matched ? { city: matched[1].trim(), state: matched[2].toUpperCase(), ibgeCode: code } : null;
}

/* ---------- Etapas ---------- */

export type TripStep = 'rota' | 'carga' | 'transportador' | 'capa' | 'oferta' | 'documentos';

export const TRIP_STEPS: Array<{ id: TripStep; label: string }> = [
    { id: 'rota', label: 'Rota e paradas' },
    { id: 'carga', label: 'Carga' },
    { id: 'transportador', label: 'Transportador' },
    { id: 'capa', label: 'Capa e Carta Frete' },
    { id: 'oferta', label: 'Oferta e saída' },
    { id: 'documentos', label: 'Documentos' },
];

export function parseStep(value: string | null): TripStep {
    return TRIP_STEPS.some((step) => step.id === value) ? (value as TripStep) : 'rota';
}

const STEP_OF_GROUP: Record<TripGroupKey, TripStep> = {
    route: 'rota',
    cargo: 'carga',
    responsible: 'transportador',
    registry: 'transportador',
    departure: 'capa',
    freight: 'capa',
    emitter: 'capa',
    documents: 'documentos',
};

export const stepOfGroup = (group: TripGroupKey): TripStep => STEP_OF_GROUP[group];

export interface MissingItem {
    step: TripStep;
    title: string;
    messages: string[];
    blocking: boolean;
}

/** "Falta para sair": as pendências do servidor, agrupadas, cada uma apontando a etapa que a resolve. */
export function missingItems(issues: ManifestReadinessIssue[]): MissingItem[] {
    return groupIssues(issues).map((group) => ({
        step: STEP_OF_GROUP[group.key],
        title: group.title,
        messages: [...group.blocking, ...group.warnings].map((issue) => issue.message),
        blocking: group.blocking.length > 0,
    }));
}

export function pendingByStep(issues: ManifestReadinessIssue[]): Record<TripStep, number> {
    const counts: Record<TripStep, number> = { rota: 0, carga: 0, transportador: 0, capa: 0, oferta: 0, documentos: 0 };
    for (const item of missingItems(issues)) if (item.blocking) counts[item.step] += 1;
    return counts;
}

/* ---------- O que cada estado permite ---------- */

export interface Permission {
    allowed: boolean;
    /** Motivo em linguagem simples quando bloqueado. */
    reason: string | null;
}

export interface TripPermissions {
    editPlanning: Permission;
    editCover: Permission;
    offer: Permission;
    withdraw: Permission;
    accept: Permission;
    start: Permission;
    reopen: Permission;
    cancel: Permission;
}

const yes: Permission = { allowed: true, reason: null };
const no = (reason: string): Permission => ({ allowed: false, reason });

const STATUS_NAME: Record<ManifestStatus, string> = {
    DRAFT: 'em montagem',
    PENDING_ACCEPT: 'com a oferta enviada',
    ACCEPTED: 'confirmada pelo transportador',
    IN_PROGRESS: 'na estrada',
    COMPLETED: 'concluída',
    CANCELLED: 'cancelada',
};

/** O servidor continua decidindo; aqui só se esconde/explica o que o estado já impede. */
export function tripPermissions(trip: Pick<Manifest, 'status' | 'fiscalDocuments'>, readiness: ManifestReadiness | null): TripPermissions {
    const status = trip.status;
    const live = (trip.fiscalDocuments ?? []).some((doc) => (doc.documentType === 'CIOT' || doc.documentType === 'MDFE') && !['REJECTED', 'CANCELLED', 'ERROR'].includes(String(doc.status)));
    const planning = readiness?.planningActions;
    const blockers = readiness ? readiness.issues.filter((issue) => issue.severity === 'blocking').length : 0;
    const pending = `Ainda há ${blockers} ${blockers === 1 ? 'pendência' : 'pendências'} em "Falta para sair".`;

    const editPlanning: Permission =
        status === 'DRAFT'
            ? yes
            : status === 'PENDING_ACCEPT'
              ? no('A viagem já foi ofertada. Retire a oferta para editar.')
              : status === 'ACCEPTED'
                ? no('O transportador já confirmou. Reabra o planejamento para editar.')
                : no(`Viagem ${STATUS_NAME[status]}: não aceita mais alterações de planejamento.`);

    const editCover: Permission = ['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED'].includes(status) ? yes : no(`Viagem ${STATUS_NAME[status]}: a capa não pode mais ser editada.`);

    const offer: Permission = status !== 'DRAFT' ? no(`Só viagem em montagem pode ser ofertada (esta está ${STATUS_NAME[status]}).`) : !readiness ? no('Aguardando a prontidão do servidor.') : readiness.canOffer ? yes : no(pending);

    const withdraw: Permission =
        status !== 'PENDING_ACCEPT' ? no('Só há oferta para retirar enquanto o transportador não confirmou.') : planning?.withdrawOffer?.allowed === false ? no(planning.withdrawOffer.reason ?? 'O servidor não permite retirar a oferta agora.') : yes;

    const accept: Permission = status === 'PENDING_ACCEPT' ? yes : no(status === 'DRAFT' ? 'Ofereça a viagem antes de confirmar pelo transportador.' : `Nada a confirmar: a viagem está ${STATUS_NAME[status]}.`);

    const start: Permission = status !== 'ACCEPTED' ? no(status === 'IN_PROGRESS' ? 'A viagem já saiu.' : 'A saída só é registrada depois que o transportador confirma.') : !readiness ? no('Aguardando a prontidão do servidor.') : readiness.canStart ? yes : no(pending);

    const reopen: Permission =
        status !== 'ACCEPTED'
            ? no('Só dá para reabrir uma viagem confirmada que ainda não saiu.')
            : planning?.reopen?.allowed === false
              ? no(planning.reopen.reason ?? 'O servidor não permite reabrir agora.')
              : live
                ? no('Há CIOT ou MDF-e emitido ou em envio: reabrir não é possível.')
                : yes;

    const cancel: Permission = !['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED'].includes(status)
        ? no(status === 'IN_PROGRESS' ? 'Viagem na estrada não é cancelada por aqui. Resolva pelo hub.' : `Viagem ${STATUS_NAME[status]}.`)
        : planning?.cancel?.allowed === false
          ? no(planning.cancel.reason ?? 'O servidor não permite cancelar agora.')
          : yes;

    return { editPlanning, editCover, offer, withdraw, accept, start, reopen, cancel };
}

/** Ocupação do veículo em %, ou null sem capacidade conhecida. */
export function occupancyPct(value: number | null | undefined, max: number | null | undefined): number | null {
    if (value == null || !max || max <= 0) return null;
    return Math.round((value / max) * 100);
}

export function tripTitle(trip: Pick<Manifest, 'origin' | 'destination' | 'originCity' | 'destinationCity'>): string {
    return `${trip.originCity || cityOnly(trip.origin)} → ${trip.destinationCity || cityOnly(trip.destination)}`;
}

export const CIOT_PHASE_LABEL: Record<string, string> = {
    QUEUED: 'Na fila',
    CADASTROS_ENSURING: 'Conferindo cadastros na e-Frete',
    SUBMITTED: 'Enviado à e-Frete',
    POLLING: 'Aguardando a resposta da e-Frete',
    DONE: 'Concluído',
    FAILED: 'Falhou',
    PENDING_RECONCILIATION: 'Aguardando conciliação',
};
