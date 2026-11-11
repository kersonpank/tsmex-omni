export type ReadinessAction = 'release' | 'offer' | 'ciot' | 'mdfe' | 'start';
const ciotOnly = new Set(['LINK_CARRIER_TYPE_PENDING', 'LINK_RNTRC_PENDING', 'RNTRC_HOLDER_ADDRESS_PENDING', 'LINK_PERSON_ADDRESS_PENDING', 'DRIVER_BIRTH_DATE_PENDING', 'DRIVER_ADDRESS_PENDING', 'DRIVER_PHONE_PENDING']);

export function blocksReadinessAction(item: { code: string; step: string; severity: string }, action: ReadinessAction, ciotDispensado = false) {
    if (item.code === 'LINK_ACCESS_PENDING') return action === 'offer';
    if (item.code.startsWith('FISCAL_EMITTER_')) return action === 'ciot' || action === 'mdfe';
    if (item.code === 'MDFE_VEHICLE_CAPACITY_PENDING') return action === 'release' || item.severity === 'blocking' && action !== 'ciot';
    if (item.severity !== 'blocking') return false;
    if (action === 'release' || action === 'offer') return item.step !== 'fiscal' && !ciotOnly.has(item.code);
    if (action === 'ciot') return item.step !== 'fiscal';
    if (action === 'mdfe') return !ciotOnly.has(item.code) && !['VEHICLE_CHASSI_PENDING', 'MDFE_AUTHORIZATION_REQUIRED'].includes(item.code);
    return !ciotDispensado || !ciotOnly.has(item.code);
}
