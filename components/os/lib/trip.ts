import type { ManifestReadiness, ManifestReadinessIssue, ManifestStatus } from '../../../types/index';

/**
 * Lógica pura da estação "Preparar e despachar" (spec 2026-10-20 §6).
 * Traduz as pendências do motor (manifestReadinessService) em grupos com UMA ação cada,
 * e decide a ação primária pela situação da viagem.
 */

export type TripGroupKey =
    | 'cargo'
    | 'responsible'
    | 'departure'
    | 'freight'
    | 'emitter'
    | 'registry'
    | 'documents'
    | 'route';

export const GROUP_TITLES: Record<TripGroupKey, string> = {
    cargo: 'Carga',
    responsible: 'Transportador e motorista',
    departure: 'Saída prevista',
    freight: 'Carta Frete',
    emitter: 'Emitente fiscal',
    registry: 'Cadastro do veículo e motorista',
    documents: 'Documentos fiscais',
    route: 'Rota',
};

const GROUP_ORDER: TripGroupKey[] = ['cargo', 'responsible', 'departure', 'freight', 'emitter', 'registry', 'documents', 'route'];

const BY_CODE: Record<string, TripGroupKey> = {
    ORDER_REQUIRED: 'cargo',
    ORDER_DOCUMENTATION_PENDING: 'documents',
    LINK_REQUIRED: 'responsible',
    LINK_NOT_APPROVED: 'responsible',
    LINK_ACCESS_PENDING: 'responsible',
    DRIVER_LINK_MISMATCH: 'responsible',
    DEPARTURE_REQUIRED: 'departure',
    ARRIVAL_BEFORE_DEPARTURE: 'departure',
    FREIGHT_AGREEMENT_REQUIRED: 'freight',
    FISCAL_EMITTER_PENDING: 'emitter',
    MDFE_VEHICLE_CAPACITY_PENDING: 'registry',
    MDFE_VEHICLE_DATA_PENDING: 'registry',
    CTE_AUTHORIZATION_REQUIRED: 'documents',
    MDFE_AUTHORIZATION_REQUIRED: 'documents',
    CIOT_REQUIRED: 'documents',
};

const BY_STEP: Record<ManifestReadinessIssue['step'], TripGroupKey> = {
    route: 'route',
    route_points: 'route',
    orders: 'cargo',
    cover: 'departure',
    responsible: 'registry',
    freight: 'freight',
    review: 'route',
    fiscal: 'documents',
};

const DOCUMENT_ORDER = ['ORDER_DOCUMENTATION_PENDING', 'CTE_AUTHORIZATION_REQUIRED', 'CIOT_REQUIRED', 'MDFE_AUTHORIZATION_REQUIRED'];

export function groupOf(issue: ManifestReadinessIssue): TripGroupKey {
    if (BY_CODE[issue.code]) return BY_CODE[issue.code];
    // DRIVER_REQUIRED cobre "nenhum motorista" e "motorista inativo": ambos se resolvem escolhendo motorista.
    if (issue.code === 'DRIVER_REQUIRED') return 'responsible';
    return BY_STEP[issue.step];
}

export interface TripGroup {
    key: TripGroupKey;
    title: string;
    blocking: ManifestReadinessIssue[];
    warnings: ManifestReadinessIssue[];
}

export function groupIssues(issues: ManifestReadinessIssue[]): TripGroup[] {
    const map = new Map<TripGroupKey, TripGroup>();
    for (const issue of issues) {
        const key = groupOf(issue);
        const group = map.get(key) ?? { key, title: GROUP_TITLES[key], blocking: [], warnings: [] };
        if (issue.severity === 'blocking') group.blocking.push(issue);
        else group.warnings.push(issue);
        map.set(key, group);
    }
    // Documentos seguem a ordem fiscal: CT-e dos pedidos → CIOT → MDF-e.
    const documents = map.get('documents');
    if (documents) {
        const rank = (issue: ManifestReadinessIssue) => {
            const index = DOCUMENT_ORDER.indexOf(issue.code);
            return index === -1 ? DOCUMENT_ORDER.length : index;
        };
        documents.blocking.sort((a, b) => rank(a) - rank(b));
        documents.warnings.sort((a, b) => rank(a) - rank(b));
    }
    // Bloqueios primeiro; dentro de cada faixa, a ordem natural da roda.
    return [...map.values()].sort(
        (a, b) =>
            Number(b.blocking.length > 0) - Number(a.blocking.length > 0) ||
            GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key),
    );
}

export const STATUS_LABEL: Record<ManifestStatus, string> = {
    DRAFT: 'Montando',
    PENDING_ACCEPT: 'Aguardando confirmação do transportador',
    ACCEPTED: 'Confirmada — preparar a saída',
    IN_PROGRESS: 'Em rota',
    COMPLETED: 'Concluída',
    CANCELLED: 'Cancelada',
};

export type PrimaryKind = 'confirm' | 'accept' | 'start' | 'none';

export interface PrimaryAction {
    kind: PrimaryKind;
    label: string;
    enabled: boolean;
    hint: string | null;
}

export function primaryAction(status: ManifestStatus, readiness: ManifestReadiness | null): PrimaryAction {
    const blocking = readiness ? readiness.issues.filter((i) => i.severity === 'blocking').length : 0;
    const pending = blocking > 0 ? `${blocking} pendência(s) antes de seguir` : null;
    switch (status) {
        case 'DRAFT':
            return { kind: 'confirm', label: 'Confirmar transportador', enabled: Boolean(readiness?.canOffer), hint: pending };
        case 'PENDING_ACCEPT':
            return { kind: 'accept', label: 'Confirmar pelo transportador', enabled: true, hint: null };
        case 'ACCEPTED':
            return { kind: 'start', label: 'Registrar saída', enabled: Boolean(readiness?.canStart), hint: pending };
        case 'IN_PROGRESS':
            return { kind: 'none', label: 'Em rota — o hub de destino recebe', enabled: false, hint: null };
        default:
            return { kind: 'none', label: STATUS_LABEL[status], enabled: false, hint: null };
    }
}

/** Placas do transportador para confirmar a composição em um toque (só placas; o resto é cadastro). */
export function linkCompositionPlates(link: {
    vehiclePlate: string | null;
    trailerPlate?: string | null;
    trailer2Plate?: string | null;
    trailer3Plate?: string | null;
    tractionUnit?: { plate: string } | null;
    trailer1Unit?: { plate: string } | null;
    trailer2Unit?: { plate: string } | null;
    trailer3Unit?: { plate: string } | null;
}): { traction: string | null; trailers: string[] } {
    const traction = link.tractionUnit?.plate ?? link.vehiclePlate ?? null;
    const trailers = [
        link.trailer1Unit?.plate ?? link.trailerPlate,
        link.trailer2Unit?.plate ?? link.trailer2Plate,
        link.trailer3Unit?.plate ?? link.trailer3Plate,
    ].filter((p): p is string => Boolean(p && p.trim()));
    return { traction: traction && traction.trim() ? traction : null, trailers };
}

export function occupancy(totalWeight: number, totalVolume: number, maxWeight?: number, maxVolume?: number) {
    const pct = (value: number, max?: number) => (max && max > 0 ? Math.min(999, Math.round((value / max) * 100)) : null);
    return { weightPct: pct(totalWeight, maxWeight), volumePct: pct(totalVolume, maxVolume) };
}

/** "1.500,50", "1500,50" e "1500.50" → 1500.5 (ponto só é milhar quando há vírgula). */
export function parseMoney(value: string): number {
    const t = value.trim();
    const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
}
