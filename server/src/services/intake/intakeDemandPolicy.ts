import type { DemandSource, DemandStatus } from '@prisma/client';

/** Fontes que exigem confirmação física (confirm-arrival) antes de Order. */
export const INTAKE_SOURCE_TYPES: DemandSource[] = [
    'NFE_KEY',
    'MANUAL_HUB',
    'DECLARATION',
    'DFE_ACBR',
];

export function isIntakeSource(sourceType: DemandSource): boolean {
    return INTAKE_SOURCE_TYPES.includes(sourceType);
}

export function normalizeExternalReference(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Status PATCH que dispararia criação automática de Order no legado. */
export const AUTO_ORDER_DEMAND_STATUSES: DemandStatus[] = ['COLLECTED', 'AT_HUB'];

export function blocksAutoOrderOnStatusPatch(
    sourceType: DemandSource,
    newStatus: DemandStatus,
    hasOrder: boolean,
): boolean {
    if (hasOrder) return false;
    if (!isIntakeSource(sourceType)) return false;
    return AUTO_ORDER_DEMAND_STATUSES.includes(newStatus);
}

export const INTAKE_AUTO_ORDER_BLOCKED_MESSAGE =
    'Demanda de pré-entrada requer confirmação física via confirm-arrival (PR004).';

export function intakeEventDescription(sourceType: DemandSource): string {
    switch (sourceType) {
        case 'NFE_KEY':
            return 'Demanda criada por chave NF-e (aguardando chegada)';
        case 'MANUAL_HUB':
            return 'Demanda criada por entrada manual no Hub (aguardando chegada)';
        case 'DECLARATION':
            return 'Demanda criada por declaração de conteúdo (aguardando chegada)';
        case 'DFE_ACBR':
            return 'Demanda criada por importação DF-e ACBr (aguardando chegada)';
        default:
            return 'Demanda de pré-entrada criada (aguardando chegada)';
    }
}
