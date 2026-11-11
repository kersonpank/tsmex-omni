export type ManifestIssueTarget = 'approval' | 'carrier' | 'carrierAddress' | 'driver' | 'vehicle' | 'rntrcHolder';
export function manifestIssueTarget(code: string): ManifestIssueTarget {
    if (['LINK_NOT_APPROVED', 'LINK_ACCESS_PENDING'].includes(code)) return 'approval';
    if (code === 'LINK_PERSON_ADDRESS_PENDING') return 'carrierAddress';
    if (code === 'RNTRC_HOLDER_ADDRESS_PENDING') return 'rntrcHolder';
    if (code.startsWith('LINK_')) return 'carrier';
    if (code.startsWith('VEHICLE_') || ['TRAILER_UNIT_PENDING', 'MDFE_VEHICLE_CAPACITY_PENDING'].includes(code)) return 'vehicle';
    return 'driver';
}
