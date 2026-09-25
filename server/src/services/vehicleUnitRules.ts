/**
 * Regras puras da Unidade de Veículo (sem banco): normalização de placa, campos obrigatórios,
 * composição (cavalo + reboques) com fallback ao legado do Link e espelho legado.
 *
 * Decisões do negócio: RNTRC e RENAVAM moram no VEÍCULO e são obrigatórios junto com chassi e eixos,
 * para cada unidade (cavalo e reboques). O histórico futuro (manutenção/pneus) pertence à unidade física.
 */

export type VehicleUnitRoleValue = 'TRACTION' | 'TRAILER';

export interface VehicleUnitLike {
    id?: string | null;
    plate: string;
    role: VehicleUnitRoleValue;
    chassi?: string | null;
    renavam?: string | null;
    axles?: number | null;
    rntrc?: string | null;
    bodyType?: string | null;
    wheelType?: string | null;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    ownerPersonId?: string | null;
    ownerDocument?: string | null;
    ownerName?: string | null;
}

export type VehicleUnitField = 'plate' | 'chassi' | 'renavam' | 'axles' | 'rntrc';

export const VEHICLE_UNIT_FIELD_LABELS: Record<VehicleUnitField, string> = {
    plate: 'Placa',
    chassi: 'Chassi',
    renavam: 'RENAVAM',
    axles: 'Número de eixos',
    rntrc: 'RNTRC',
};

export interface VehicleUnitFieldIssue {
    field: VehicleUnitField;
    label: string;
    reason: 'missing' | 'invalid';
}

export const digitsOnly = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

export function normalizePlate(value: string | null | undefined): string {
    return (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export const isValidPlate = (plate: string) => /^[A-Z0-9]{7}$/.test(plate);

export const normalizeChassi = (value: string | null | undefined) => (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
export const isValidChassi = (chassi: string) => /^[A-Z0-9]{17}$/.test(chassi);
export const isValidRenavam = (renavam: string) => /^\d{9,11}$/.test(renavam);
export const isValidRntrc = (rntrc: string) => /^\d{8,9}$/.test(rntrc);

/** Campos obrigatórios da unidade para CIOT/MDF-e/e-Frete — vazio se a unidade está pronta. */
export function unitFieldIssues(unit: Pick<VehicleUnitLike, 'plate' | 'chassi' | 'renavam' | 'axles' | 'rntrc'>): VehicleUnitFieldIssue[] {
    const issues: VehicleUnitFieldIssue[] = [];
    const push = (field: VehicleUnitField, reason: 'missing' | 'invalid') =>
        issues.push({ field, label: VEHICLE_UNIT_FIELD_LABELS[field], reason });

    if (!isValidPlate(normalizePlate(unit.plate))) push('plate', normalizePlate(unit.plate) ? 'invalid' : 'missing');

    const chassi = normalizeChassi(unit.chassi);
    if (!chassi) push('chassi', 'missing');
    else if (!isValidChassi(chassi)) push('chassi', 'invalid');

    const renavam = digitsOnly(unit.renavam);
    if (!renavam) push('renavam', 'missing');
    else if (!isValidRenavam(renavam)) push('renavam', 'invalid');

    if (unit.axles == null) push('axles', 'missing');
    else if (!Number.isInteger(unit.axles) || unit.axles < 1) push('axles', 'invalid');

    const rntrc = digitsOnly(unit.rntrc);
    if (!rntrc) push('rntrc', 'missing');
    else if (!isValidRntrc(rntrc)) push('rntrc', 'invalid');

    return issues;
}

// ────────────────────────────────────────────────────────────────────────────
// Composição
// ────────────────────────────────────────────────────────────────────────────

export interface ResolvedVehicleUnit extends VehicleUnitLike {
    /** UNIT = veio da VehicleUnit; LEGACY = sintetizado das colunas antigas do Link (ainda sem backfill). */
    source: 'UNIT' | 'LEGACY';
}

export interface VehicleComposition {
    traction: ResolvedVehicleUnit | null;
    trailers: ResolvedVehicleUnit[];
    /** Cavalo primeiro, depois reboques em ordem. */
    units: ResolvedVehicleUnit[];
}

/** Subconjunto do Link lido para resolver a composição (unidades opcionais = include do Prisma). */
export interface LinkVehicleSource {
    vehiclePlate?: string | null;
    trailerPlate?: string | null;
    trailer2Plate?: string | null;
    trailer3Plate?: string | null;
    vehicleChassi?: string | null;
    vehicleRenavam?: string | null;
    vehicleAxles?: number | null;
    rntrc?: string | null;
    vehicleBodyType?: string | null;
    vehicleWheelType?: string | null;
    vehicleYear?: number | null;
    vehicleOwnerDocument?: string | null;
    vehicleOwnerName?: string | null;
    tractionUnit?: VehicleUnitLike | null;
    trailer1Unit?: VehicleUnitLike | null;
    trailer2Unit?: VehicleUnitLike | null;
    trailer3Unit?: VehicleUnitLike | null;
}

const fromUnit = (unit: VehicleUnitLike): ResolvedVehicleUnit => ({ ...unit, plate: normalizePlate(unit.plate), source: 'UNIT' });

export function resolveComposition(link: LinkVehicleSource): VehicleComposition {
    let traction: ResolvedVehicleUnit | null = null;
    if (link.tractionUnit) {
        traction = fromUnit(link.tractionUnit);
    } else if (normalizePlate(link.vehiclePlate)) {
        traction = {
            source: 'LEGACY',
            role: 'TRACTION',
            plate: normalizePlate(link.vehiclePlate),
            chassi: link.vehicleChassi ?? null,
            renavam: link.vehicleRenavam ?? null,
            axles: link.vehicleAxles ?? null,
            rntrc: link.rntrc ?? null,
            bodyType: link.vehicleBodyType ?? null,
            wheelType: link.vehicleWheelType ?? null,
            year: link.vehicleYear ?? null,
            ownerDocument: link.vehicleOwnerDocument ?? null,
            ownerName: link.vehicleOwnerName ?? null,
        };
    }

    const slots: Array<[VehicleUnitLike | null | undefined, string | null | undefined]> = [
        [link.trailer1Unit, link.trailerPlate],
        [link.trailer2Unit, link.trailer2Plate],
        [link.trailer3Unit, link.trailer3Plate],
    ];
    const trailers: ResolvedVehicleUnit[] = [];
    for (const [unit, legacyPlate] of slots) {
        if (unit) trailers.push(fromUnit(unit));
        else if (normalizePlate(legacyPlate)) trailers.push({ source: 'LEGACY', role: 'TRAILER', plate: normalizePlate(legacyPlate) });
    }

    // Uma mesma placa nunca aparece duas vezes na composição (CIOT/MDF-e rejeitam duplicidade).
    const seen = new Set<string>();
    const unique = (unit: ResolvedVehicleUnit) => (seen.has(unit.plate) ? false : (seen.add(unit.plate), true));
    if (traction) unique(traction);
    const dedupedTrailers = trailers.filter(unique);

    return { traction, trailers: dedupedTrailers, units: [...(traction ? [traction] : []), ...dedupedTrailers] };
}

export interface CompositionIssue {
    unit: 'TRACTION' | 'TRAILER';
    plate: string | null;
    fields: VehicleUnitFieldIssue[];
}

/** Pendências reais da composição. Vazio = pronta para CIOT/MDF-e. */
export function compositionIssues(composition: VehicleComposition): CompositionIssue[] {
    const issues: CompositionIssue[] = [];
    if (!composition.traction) {
        issues.push({ unit: 'TRACTION', plate: null, fields: [{ field: 'plate', label: VEHICLE_UNIT_FIELD_LABELS.plate, reason: 'missing' }] });
    }
    for (const unit of composition.units) {
        const fields = unitFieldIssues(unit);
        if (fields.length) issues.push({ unit: unit.role, plate: unit.plate, fields });
    }
    return issues;
}

export const describeUnitIssues = (issue: CompositionIssue) =>
    issue.fields.map((f) => (f.reason === 'invalid' ? `${f.label} inválido` : f.label)).join(', ');

/** RNTRC efetivo da viagem: o do cavalo (unidade), com fallback ao RNTRC legado do Link. */
export function tractionRntrc(composition: VehicleComposition, legacyLinkRntrc?: string | null): string | null {
    const value = digitsOnly(composition.traction?.rntrc) || digitsOnly(legacyLinkRntrc);
    return value || null;
}

// ────────────────────────────────────────────────────────────────────────────
// Espelho legado (mantém leitores antigos e o front atual funcionando durante a transição)
// ────────────────────────────────────────────────────────────────────────────

export interface LegacyLinkVehicleColumns {
    vehiclePlate?: string;
    vehicleChassi: string | null;
    vehicleRenavam: string | null;
    vehicleAxles: number | null;
    /** Ausente quando a unidade não tem RNTRC: nunca apagar o RNTRC legado do Link. */
    rntrc?: string;
    vehicleBodyType: string | null;
    vehicleWheelType: string | null;
    vehicleYear: number | null;
    vehicleOwnerDocument: string | null;
    vehicleOwnerName: string | null;
    trailerPlate: string | null;
    trailer2Plate: string | null;
    trailer3Plate: string | null;
}

export function legacyColumnsFromComposition(traction: VehicleUnitLike, trailers: VehicleUnitLike[]): LegacyLinkVehicleColumns {
    return {
        vehiclePlate: normalizePlate(traction.plate),
        vehicleChassi: traction.chassi ?? null,
        vehicleRenavam: traction.renavam ?? null,
        vehicleAxles: traction.axles ?? null,
        ...(traction.rntrc ? { rntrc: traction.rntrc } : {}),
        vehicleBodyType: traction.bodyType ?? null,
        vehicleWheelType: traction.wheelType ?? null,
        vehicleYear: traction.year ?? null,
        vehicleOwnerDocument: traction.ownerDocument ?? null,
        vehicleOwnerName: traction.ownerName ?? null,
        trailerPlate: trailers[0] ? normalizePlate(trailers[0].plate) : null,
        trailer2Plate: trailers[1] ? normalizePlate(trailers[1].plate) : null,
        trailer3Plate: trailers[2] ? normalizePlate(trailers[2].plate) : null,
    };
}
