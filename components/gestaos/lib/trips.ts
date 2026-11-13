import type { Manifest, ManifestFiscalDocument, ManifestFiscalDocType } from '../../../types/index';
import { cityOnly, shortId } from './format';

/** Leitura de uma viagem para a torre: estágio, documentos e o que pede atenção. Regras puras. */

export type Tone = 'neutral' | 'royal' | 'yellow' | 'red';

export interface TripStage {
    key: 'draft' | 'offered' | 'accepted' | 'road' | 'done' | 'cancelled';
    label: string;
    tone: Tone;
}

const STAGES: Record<Manifest['status'], TripStage> = {
    DRAFT: { key: 'draft', label: 'Em montagem', tone: 'neutral' },
    PENDING_ACCEPT: { key: 'offered', label: 'Oferta enviada', tone: 'yellow' },
    ACCEPTED: { key: 'accepted', label: 'Pronta para sair', tone: 'royal' },
    IN_PROGRESS: { key: 'road', label: 'Na estrada', tone: 'royal' },
    COMPLETED: { key: 'done', label: 'Concluída', tone: 'neutral' },
    CANCELLED: { key: 'cancelled', label: 'Cancelada', tone: 'neutral' },
};

export function tripStage(trip: Pick<Manifest, 'status'>): TripStage {
    return STAGES[trip.status] ?? { key: 'draft', label: String(trip.status), tone: 'neutral' };
}

export function routeLabel(trip: Pick<Manifest, 'origin' | 'destination' | 'originCity' | 'destinationCity'>): string {
    return `${trip.originCity || cityOnly(trip.origin)} → ${trip.destinationCity || cityOnly(trip.destination)}`;
}

export function tripCode(trip: Pick<Manifest, 'id'>): string {
    return shortId(trip.id);
}

export function carrierLabel(trip: Pick<Manifest, 'link' | 'hub'>): string {
    if (trip.link?.name) return trip.link.name;
    return trip.hub?.name ? `${trip.hub.name} · sem transportador` : 'Transportador a definir';
}

export function platesLabel(trip: Pick<Manifest, 'vehicleAssignments' | 'link'>): string {
    const fromUnits = (trip.vehicleAssignments ?? [])
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map((assignment) => assignment.vehicleUnit?.plate)
        .filter(Boolean) as string[];
    if (fromUnits.length) return fromUnits.join(' · ');
    const legacy = [trip.link?.vehiclePlate, trip.link?.trailerPlate, trip.link?.trailer2Plate].filter(Boolean) as string[];
    return legacy.length ? legacy.join(' · ') : 'sem veículo';
}

export function orderCount(trip: Pick<Manifest, 'demands'>): number {
    return trip.demands?.length ?? 0;
}

export type DocState = 'none' | 'processing' | 'authorized' | 'closed' | 'rejected';

/** Estado do documento mais recente daquele tipo (a lista vem do servidor do mais novo para o mais antigo). */
export function docState(trip: Pick<Manifest, 'fiscalDocuments'>, type: ManifestFiscalDocType): DocState {
    const docs = (trip.fiscalDocuments ?? []).filter((doc) => doc.documentType === type && doc.status !== 'CANCELLED');
    if (!docs.length) return 'none';
    if (docs.some((doc) => doc.status === 'AUTHORIZED')) return 'authorized';
    if (docs.every((doc) => doc.status === 'CLOSED')) return 'closed';
    if (docs.some((doc) => doc.status === 'SENT' || doc.status === 'READY' || doc.status === 'DRAFT')) return 'processing';
    if (docs.some((doc) => doc.status === 'CLOSED')) return 'closed';
    return 'rejected';
}

export const DOC_STATE_LABEL: Record<DocState, string> = {
    none: 'falta',
    processing: 'em envio',
    authorized: 'autorizado',
    closed: 'encerrado',
    rejected: 'recusado',
};

/** Documentos ainda abertos (autorizados e não encerrados) numa viagem já concluída. */
export function openFiscalDocs(trip: Pick<Manifest, 'status' | 'fiscalDocuments'>): ManifestFiscalDocument[] {
    if (trip.status !== 'COMPLETED') return [];
    return (trip.fiscalDocuments ?? []).filter((doc) => doc.status === 'AUTHORIZED');
}

export interface TripAttention {
    /** 2 = travada, 1 = atenção, 0 = segue normal. */
    level: 0 | 1 | 2;
    reason: string | null;
}

export function tripAttention(trip: Manifest, now: Date = new Date()): TripAttention {
    if (trip.status === 'CANCELLED') return { level: 0, reason: null };

    const open = openFiscalDocs(trip);
    if (open.length) {
        const names = [...new Set(open.map((doc) => (doc.documentType === 'MDFE' ? 'MDF-e' : 'CIOT')))].join(' e ');
        return { level: 2, reason: `${names} ainda ${open.length > 1 ? 'abertos' : 'aberto'} depois da conclusão` };
    }
    if (trip.status === 'COMPLETED') return { level: 0, reason: null };

    if (trip.status === 'IN_PROGRESS') {
        if (trip.plannedArrivalAt && !trip.arrivedAt && new Date(trip.plannedArrivalAt).getTime() < now.getTime()) {
            return { level: 2, reason: 'Passou da chegada prevista e ainda não foi recebida' };
        }
        return { level: 0, reason: null };
    }

    if (docState(trip, 'MDFE') === 'rejected' || docState(trip, 'CIOT') === 'rejected') {
        return { level: 2, reason: 'Documento da viagem recusado' };
    }
    if (trip.status === 'ACCEPTED') {
        if (docState(trip, 'MDFE') !== 'authorized') return { level: 1, reason: 'Falta emitir o MDF-e para sair' };
        return { level: 0, reason: null };
    }
    if (trip.status === 'PENDING_ACCEPT') return { level: 1, reason: 'Aguardando o transportador confirmar' };
    if (!trip.linkId) return { level: 1, reason: 'Sem transportador definido' };
    if (!trip.freightAgreement) return { level: 1, reason: 'Sem Carta Frete' };
    return { level: 0, reason: null };
}

/** Viagem que ainda pede acompanhamento: em andamento, ou concluída com documento aberto. */
export function isLiveTrip(trip: Manifest): boolean {
    if (trip.status === 'CANCELLED') return false;
    if (trip.status === 'COMPLETED') return openFiscalDocs(trip).length > 0;
    return true;
}

const STAGE_ORDER: Record<TripStage['key'], number> = { road: 0, accepted: 1, offered: 2, draft: 3, done: 4, cancelled: 5 };

/** Travadas primeiro, depois atenção; em empate, o que está mais adiante na operação. */
export function sortByAttention(trips: Manifest[], now: Date = new Date()): Manifest[] {
    return trips
        .map((trip) => ({ trip, attention: tripAttention(trip, now).level }))
        .sort(
            (a, b) =>
                b.attention - a.attention ||
                STAGE_ORDER[tripStage(a.trip).key] - STAGE_ORDER[tripStage(b.trip).key] ||
                (b.trip.updatedAt ?? '').localeCompare(a.trip.updatedAt ?? ''),
        )
        .map((entry) => entry.trip);
}

/** Horário que melhor situa a viagem agora: chegada, saída real, saída prevista. */
export function tripClock(trip: Manifest): { label: string; iso: string | null } {
    if (trip.status === 'COMPLETED') return { label: 'chegou', iso: trip.completedAt ?? trip.arrivedAt ?? null };
    if (trip.status === 'IN_PROGRESS') return { label: 'saiu', iso: trip.startedAt ?? null };
    return { label: 'saída prevista', iso: trip.plannedDepartureAt ?? null };
}
