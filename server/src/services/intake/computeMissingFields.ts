import type { CompletenessLevel, DemandDocumentType } from '@prisma/client';

export type IntakeFieldKey =
    | 'clientId'
    | 'nfNumber'
    | 'nfValue'
    | 'origin'
    | 'destination'
    | 'commodity'
    | 'weight'
    | 'volume'
    | 'units'
    | 'destinatario'
    | 'remetente'
    | 'cubagem'
    | 'produtos'
    | 'documentKey'
    | 'declarationDescription';

export interface IntakeCargoSnapshot {
    clientId?: string | null;
    nfNumber: string;
    nfValue: number;
    origin: string;
    destination: string;
    commodity: string;
    weight: number;
    volume: number;
    units: number;
    documentType?: DemandDocumentType | null;
    documentKey?: string | null;
    declarationDescription?: string | null;
}

const PLACEHOLDER_ORIGIN = 'A definir';
const PLACEHOLDER_DEST = 'A definir';
const PLACEHOLDER_COMMODITY = 'A definir';
const PLACEHOLDER_NF = 'PENDENTE';

/** Campos que a chave NF sozinha não fornece — sempre conferência posterior. */
export const NFE_KEY_ALWAYS_MISSING: IntakeFieldKey[] = [
    'destination',
    'destinatario',
    'weight',
    'volume',
    'cubagem',
    'produtos',
    'nfValue',
];

export function computeMissingFields(snapshot: IntakeCargoSnapshot): IntakeFieldKey[] {
    const missing = new Set<IntakeFieldKey>();

    // Cliente (conta faturável) não é pré-requisito operacional — só se resolve quando o frete
    // (CIF/FOB/REDESPACHO) é decidido na confirmação de chegada (ver `resolvePayerClient.ts`).
    // Por isso nunca entra em `critical` em `deriveIntakeCompleteness` abaixo.
    if (!snapshot.clientId) missing.add('clientId');

    if (!snapshot.nfNumber || snapshot.nfNumber === PLACEHOLDER_NF) missing.add('nfNumber');
    if (snapshot.nfValue <= 0) missing.add('nfValue');
    if (!snapshot.origin?.trim() || snapshot.origin === PLACEHOLDER_ORIGIN) missing.add('origin');
    if (!snapshot.destination?.trim() || snapshot.destination === PLACEHOLDER_DEST) missing.add('destination');
    if (!snapshot.commodity?.trim() || snapshot.commodity === PLACEHOLDER_COMMODITY) missing.add('commodity');
    if (snapshot.weight <= 0) missing.add('weight');
    if (snapshot.volume <= 0) missing.add('volume');
    if (snapshot.units < 1) missing.add('units');

    if (snapshot.documentType === 'NFE' && !snapshot.documentKey) missing.add('documentKey');

    if (snapshot.documentType === 'DECLARATION') {
        if (!snapshot.declarationDescription?.trim()) missing.add('declarationDescription');
    }

    return [...missing];
}

export function deriveIntakeCompleteness(missing: IntakeFieldKey[]): CompletenessLevel {
    if (missing.length === 0) return 'COMPLETE';
    const critical = new Set<IntakeFieldKey>([
        'origin',
        'destination',
        'weight',
        'volume',
        'commodity',
    ]);
    const missingCritical = missing.filter((f) => critical.has(f));
    if (missingCritical.length === 0) return 'INCOMPLETE';
    return 'MINIMAL';
}

export function mergeMissingFields(
    base: IntakeFieldKey[],
    extra: IntakeFieldKey[],
): IntakeFieldKey[] {
    return [...new Set([...base, ...extra])];
}
