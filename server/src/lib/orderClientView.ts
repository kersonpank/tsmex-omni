import type { UserRole } from '@prisma/client';

/** CLIENT sem nenhum papel operacional: enxerga a visão externa do pedido. */
export function isExternalClientView(roles: UserRole[]): boolean {
    return roles.includes('CLIENT') && !roles.some((r) => r === 'ADMIN' || r === 'HUB' || r === 'LINK');
}

const MANIFEST_INTERNAL = [
    'link', 'linkId', 'driver', 'driverId', 'driverAssignments', 'totalValue', 'compositionSnapshot', 'stops',
    'ciotTipoViagemOverride', 'ciotDispensado', 'ciotDispensadoMotivo', 'freightAgreement', 'payables', 'ciotEmissionJobs',
] as const;

const CALC_INTERNAL = [
    'cteXml', 'dceXml', 'cteXmlStorageKey', 'ctePdfStorageKey', 'cteStatusReason', 'dceStatusReason',
    'pricingTableId', 'pricingTable', 'fiscalEmitterId', 'fiscalEmitter', 'calculationMethod',
] as const;

function omit<T extends Record<string, any>>(obj: T | null | undefined, keys: readonly string[]): any {
    if (!obj || typeof obj !== 'object') return obj;
    const copy: Record<string, any> = { ...obj };
    for (const k of keys) delete copy[k];
    return copy;
}

/**
 * Remove do pedido o que é interno: XML fiscal, chaves de storage, dados do transportador/motorista e custos da viagem.
 * O cliente continua vendo status, partes, notas, histórico, números/PDF dos documentos e o frete cobrado.
 */
export function sanitizeOrderForClient<T extends Record<string, any>>(order: T): T {
    const out: Record<string, any> = { ...order };
    if (out.manifest) out.manifest = omit(out.manifest, MANIFEST_INTERNAL);
    if (Array.isArray(out.legs)) {
        out.legs = out.legs.map((leg: any) => ({ ...leg, manifest: omit(leg.manifest, MANIFEST_INTERNAL) }));
    }
    if (Array.isArray(out.freightCalculations)) {
        out.freightCalculations = out.freightCalculations.map((c: any) => omit(c, CALC_INTERNAL));
    }
    return out as T;
}
