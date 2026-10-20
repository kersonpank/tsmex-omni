/**
 * Regras puras da Unidade de Veículo (sem banco): normalização de placa, campos obrigatórios,
 * composição (cavalo + reboques) com fallback ao legado do Link e espelho legado.
 *
 * Decisões do negócio: RNTRC e RENAVAM moram no VEÍCULO e são obrigatórios junto com chassi e eixos,
 * para cada unidade (cavalo e reboques). O histórico futuro (manutenção/pneus) pertence à unidade física.
 */

export type VehicleUnitRoleValue = 'TRACTION' | 'TRAILER';

/** Pessoa ligada à unidade (proprietário do CRLV ou responsável RNTRC), como carregada do banco. */
export interface VehicleUnitPartySource {
    id: string;
    document: string;
    legalName: string;
    state?: string | null;
    rntrc?: string | null;
}

/** Retrato da pessoa congelado na composição (oferta/emissão). */
export interface VehicleUnitParty {
    personId: string;
    document: string;
    name: string;
    state: string | null;
    rntrc: string | null;
}

export interface VehicleUnitLike {
    id?: string | null;
    plate: string;
    role: VehicleUnitRoleValue;
    chassi?: string | null;
    renavam?: string | null;
    axles?: number | null;
    tareKg?: number | null;
    capacityKg?: number | null;
    capacityM3?: number | null;
    rntrc?: string | null;
    bodyType?: string | null;
    wheelType?: string | null;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    ownerPersonId?: string | null;
    ownerDocument?: string | null;
    ownerName?: string | null;
    mdfeOwnerType?: string | null;
    licensedState?: string | null;
    ownerState?: string | null;
    rntrcHolderPersonId?: string | null;
    /** Relações do banco: presentes (mesmo null) quando a leitura inclui as pessoas da unidade. */
    ownerPerson?: VehicleUnitPartySource | null;
    rntrcHolderPerson?: VehicleUnitPartySource | null;
    /** Já resolvidos (composição/snapshot). */
    owner?: VehicleUnitParty | null;
    rntrcHolder?: VehicleUnitParty | null;
}

export type VehicleUnitField = 'plate' | 'chassi' | 'renavam' | 'axles' | 'rntrc';

export const VEHICLE_UNIT_FIELD_LABELS: Record<VehicleUnitField, string> = {
    plate: 'Placa',
    chassi: 'Chassi',
    renavam: 'RENAVAM',
    axles: 'Número de eixos',
    rntrc: 'RNTRC do responsável',
};

const toParty = (person: VehicleUnitPartySource): VehicleUnitParty => ({
    personId: person.id,
    document: digitsOnly(person.document),
    name: person.legalName,
    state: person.state ?? null,
    rntrc: digitsOnly(person.rntrc) || null,
});

/**
 * RNTRC efetivo da unidade: o da pessoa responsável RNTRC. `VehicleUnit.rntrc` é legado e só vale
 * quando as pessoas não foram carregadas (unidade montada fora do banco) ou num snapshot antigo.
 */
export function unitRntrc(unit: Pick<VehicleUnitLike, 'rntrc' | 'rntrcHolder' | 'rntrcHolderPerson'>): string | null {
    if (unit.rntrcHolder !== undefined) return unit.rntrcHolder?.rntrc ?? null;
    if (unit.rntrcHolderPerson !== undefined) return digitsOnly(unit.rntrcHolderPerson?.rntrc) || null;
    return digitsOnly(unit.rntrc) || null;
}

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
export function unitFieldIssues(unit: Pick<VehicleUnitLike, 'plate' | 'chassi' | 'renavam' | 'axles' | 'rntrc' | 'rntrcHolder' | 'rntrcHolderPerson'>): VehicleUnitFieldIssue[] {
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

    const rntrc = digitsOnly(unitRntrc(unit));
    if (!rntrc) push('rntrc', 'missing');
    else if (!isValidRntrc(rntrc)) push('rntrc', 'invalid');

    return issues;
}

export const MDFE_BODY_TYPES = ['NaoAplicavel', 'Aberta', 'FechadaOuBau', 'Granelera', 'PortaContainer', 'Sider'] as const;
/** Rodado aceito no MDF-e para o cavalo (NaoAplicavel não tem código em tpRod). */
export const MDFE_TRACTION_WHEEL_TYPES = ['Truck', 'Toco', 'Cavalo'] as const;

/**
 * Dados da unidade que a emissão do MDF-e exige além de `unitFieldIssues` (espelha
 * `buildMdfeVehicles`): carroceria, rodado do cavalo, UF de licenciamento, RNTRC de
 * exatamente 8 dígitos e, quando o responsável RNTRC não é o emitente, vínculo e UF dele.
 * Tara/capacidade têm pendência própria (MDFE_VEHICLE_CAPACITY_PENDING). Vazio = pronto.
 */
export function mdfeUnitDataIssues(
    unit: Pick<VehicleUnitLike, 'role' | 'bodyType' | 'wheelType' | 'licensedState' | 'mdfeOwnerType' | 'ownerState' | 'rntrc' | 'rntrcHolder' | 'rntrcHolderPerson'>,
    emitterDocument?: string | null,
): string[] {
    const issues: string[] = [];
    if (!unit.bodyType || !(MDFE_BODY_TYPES as readonly string[]).includes(unit.bodyType)) issues.push('tipo de carroceria');
    if (unit.role === 'TRACTION' && !(MDFE_TRACTION_WHEEL_TYPES as readonly string[]).includes(unit.wheelType ?? '')) {
        issues.push('tipo de rodado');
    }
    if (!/^[A-Z]{2}$/.test(unit.licensedState ?? '')) issues.push('UF de licenciamento');
    const rntrc = digitsOnly(unitRntrc(unit));
    if (rntrc && (!/^\d{8}$/.test(rntrc) || /^0+$/.test(rntrc))) issues.push('RNTRC com exatamente 8 dígitos (exigência do MDF-e)');

    const holderDocument = unit.rntrcHolder !== undefined
        ? unit.rntrcHolder?.document ?? null
        : unit.rntrcHolderPerson !== undefined ? digitsOnly(unit.rntrcHolderPerson?.document) || null : null;
    const emitter = digitsOnly(emitterDocument);
    if (holderDocument && holderDocument !== emitter) {
        if (!['0', '1', '2'].includes(unit.mdfeOwnerType ?? '')) issues.push('vínculo do proprietário no MDF-e');
        const holderUf = unit.rntrcHolder?.state ?? unit.rntrcHolderPerson?.state ?? unit.ownerState ?? null;
        if (!/^[A-Z]{2}$/.test(holderUf ?? '')) issues.push('UF do responsável RNTRC');
    }
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

/**
 * Unidade do banco → unidade resolvida. Proprietário e responsável RNTRC viram retratos compactos
 * (`owner`/`rntrcHolder`) e `rntrc` passa a ser o RNTRC do responsável — é isso que o snapshot congela.
 */
function fromUnit(unit: VehicleUnitLike): ResolvedVehicleUnit {
    const { ownerPerson, rntrcHolderPerson, ...rest } = unit;
    const owner = rest.owner !== undefined ? rest.owner : ownerPerson !== undefined ? (ownerPerson ? toParty(ownerPerson) : null) : undefined;
    const rntrcHolder = rest.rntrcHolder !== undefined ? rest.rntrcHolder : rntrcHolderPerson !== undefined ? (rntrcHolderPerson ? toParty(rntrcHolderPerson) : null) : undefined;
    return {
        ...rest,
        plate: normalizePlate(unit.plate),
        rntrc: unitRntrc(unit),
        ...(owner !== undefined ? {
            owner,
            ownerDocument: owner?.document ?? rest.ownerDocument ?? null,
            ownerName: owner?.name ?? rest.ownerName ?? null,
            ownerState: rest.ownerState ?? owner?.state ?? null,
        } : {}),
        ...(rntrcHolder !== undefined ? { rntrcHolder } : {}),
        source: 'UNIT',
    };
}

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

export function resolveManifestComposition(manifest: {
    compositionSnapshot?: unknown;
    vehicleAssignments?: Array<{ slot: number; vehicleUnit: VehicleUnitLike }>;
    link?: LinkVehicleSource | null;
}): VehicleComposition {
    const snapshot = manifest.compositionSnapshot as { traction?: ResolvedVehicleUnit; trailers?: ResolvedVehicleUnit[] } | null | undefined;
    if (snapshot?.traction && Array.isArray(snapshot.trailers) && isValidPlate(normalizePlate(snapshot.traction.plate))) {
        return { traction: snapshot.traction, trailers: snapshot.trailers, units: [snapshot.traction, ...snapshot.trailers] };
    }
    if (Array.isArray(manifest.vehicleAssignments)) {
        const bySlot = new Map(manifest.vehicleAssignments.map((assignment) => [assignment.slot, assignment.vehicleUnit]));
        return resolveComposition({
            tractionUnit: bySlot.get(0), trailer1Unit: bySlot.get(1),
            trailer2Unit: bySlot.get(2), trailer3Unit: bySlot.get(3),
        });
    }
    // Only for older callers/tests that have not loaded assignments. Database reads must include them.
    return resolveComposition(manifest.link ?? {});
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

/**
 * RNTRC efetivo da viagem: o do responsável RNTRC do cavalo. O RNTRC legado do Link só completa
 * composições/snapshots anteriores ao responsável por pessoa.
 */
export function tractionRntrc(composition: VehicleComposition, legacyLinkRntrc?: string | null): string | null {
    const traction = composition.traction;
    if (traction?.rntrcHolder !== undefined) return digitsOnly(traction.rntrc) || null;
    const value = digitsOnly(traction?.rntrc) || digitsOnly(legacyLinkRntrc);
    return value || null;
}

/**
 * Alerta (não bloqueio): o responsável RNTRC do cavalo não é o transportador que recebe a oferta.
 * Frota agregada é legítima, mas o CIOT sai no RNTRC do responsável — precisa ser consciente.
 */
export function tractionHolderDiffersFromCarrier(composition: VehicleComposition, carrierPersonId: string | null | undefined): boolean {
    const holder = composition.traction?.rntrcHolder;
    return Boolean(holder && carrierPersonId && holder.personId !== carrierPersonId);
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
        ...(unitRntrc(traction) ? { rntrc: unitRntrc(traction)! } : {}),
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
