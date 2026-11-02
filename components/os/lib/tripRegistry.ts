import type { Driver, Manifest, ManifestReadinessIssue, TripCompositionSuggestion } from '../../../types/index';
import { normalizePlate, type RegistryDriver, type RegistryUnit, type TripCompositionPlates } from './carrier';

export interface TripRegistryUnit extends RegistryUnit {
    slot: number;
    readinessIssues: ManifestReadinessIssue[];
}

export interface TripRegistryDriver extends RegistryDriver {
    readinessIssues: ManifestReadinessIssue[];
}

/** Identidade explícita prevalece sobre os campos legados, inclusive quando a placa não coincide. */
function issueForUnit(issue: ManifestReadinessIssue, unit: { id?: string | null; plate: string }, slot: number): boolean {
    if (issue.vehicleUnitId) return issue.vehicleUnitId === unit.id;
    if (issue.driverId) return false;
    if (issue.plate) return normalizePlate(issue.plate) === normalizePlate(unit.plate);
    const fieldPlate = issue.field?.match(/^(?:vehicleUnit|trailerUnit):(.+)$/)?.[1];
    if (fieldPlate) return normalizePlate(fieldPlate) === normalizePlate(unit.plate);
    // Compatibilidade com readiness anterior à inclusão de IDs: campos genéricos pertenciam ao cavalo.
    return slot === 0 && (issue.code.startsWith('VEHICLE_') || issue.code === 'RNTRC_HOLDER_ADDRESS_PENDING');
}

/** A lista usa exclusivamente as unidades escolhidas na viagem, em ordem de slot. */
export function tripRegistryUnits(
    trip: Pick<Manifest, 'vehicleAssignments'>,
    issues: ManifestReadinessIssue[],
): TripRegistryUnit[] {
    return [...(trip.vehicleAssignments ?? [])].sort((a, b) => a.slot - b.slot).map(({ slot, vehicleUnit }) => {
        const readinessIssues = issues.filter((issue) => issueForUnit(issue, vehicleUnit, slot));
        const holder = vehicleUnit.rntrcHolderPerson;
        return {
            ...vehicleUnit,
            slot,
            rntrcHolder: holder ? {
                personId: holder.id,
                document: holder.document,
                name: holder.legalName,
                state: holder.state ?? null,
                rntrc: holder.rntrc ?? null,
            } : null,
            issues: readinessIssues.map((issue) => issue.message),
            readinessIssues,
        };
    });
}

/** Inclui todos os condutores da viagem, sem trazer os outros motoristas da ficha padrão. */
export function tripRegistryDrivers(
    trip: Pick<Manifest, 'driver' | 'driverId' | 'driverAssignments'>,
    issues: ManifestReadinessIssue[],
): TripRegistryDriver[] {
    const drivers = new Map<string, Driver>();
    if (trip.driver) drivers.set(trip.driver.id, trip.driver);
    for (const assignment of [...(trip.driverAssignments ?? [])].sort((a, b) => a.sequence - b.sequence)) {
        if (!drivers.has(assignment.driver.id)) drivers.set(assignment.driver.id, assignment.driver);
    }
    return [...drivers.values()].map((driver) => {
        const readinessIssues = issues.filter((issue) => {
            if (issue.driverId) return issue.driverId === driver.id;
            if (issue.vehicleUnitId || issue.plate) return false;
            if (issue.field === driver.id) return issue.code.startsWith('ADDITIONAL_DRIVER_');
            return driver.id === trip.driverId && issue.code.startsWith('DRIVER_');
        });
        return {
            ...driver,
            // GET /manifests/:id inclui Person completa; Driver tipa só os campos de endereço.
            person: driver.person as RegistryDriver['person'],
            issues: readinessIssues.map((issue) => issue.message),
            readinessIssues,
        };
    });
}

/** Placas da composição sugerida pelo servidor, como "BWP6E54 + AFY2E46". */
export function suggestionPlates(suggestion: Pick<TripCompositionSuggestion, 'traction' | 'trailers'>): string {
    return [suggestion.traction.plate, ...suggestion.trailers.map((trailer) => trailer.plate)].join(' + ');
}

/** "Usar composição da última viagem: …" / "…do cadastro do transportador: …". */
export function suggestionTitle(suggestion: Pick<TripCompositionSuggestion, 'source' | 'traction' | 'trailers'>): string {
    const origin = suggestion.source === 'LAST_TRIP' ? 'da última viagem' : 'do cadastro do transportador';
    return `Usar composição ${origin}: ${suggestionPlates(suggestion)}`;
}

/**
 * Composição padrão do transportador (cavalo + até 3 reboques) quando ela difere do que a viagem tem.
 * Devolve null se o transportador não tem cavalo ou se a viagem já usa exatamente essas placas.
 */
export function carrierDefaultForTrip(
    units: Array<Pick<RegistryUnit, 'plate' | 'role'>>,
    trip: TripCompositionPlates,
): { traction: { plate: string }; trailers: Array<{ plate: string }>; label: string } | null {
    const traction = units.find((unit) => unit.role === 'TRACTION');
    if (!traction) return null;
    const trailers = units.filter((unit) => unit.role === 'TRAILER').slice(0, 3);
    const wanted = [traction, ...trailers].map((unit) => normalizePlate(unit.plate));
    const current = [trip.traction, ...trip.trailers].map((plate) => normalizePlate(plate)).filter(Boolean);
    if (wanted.length === current.length && wanted.every((plate, index) => plate === current[index])) return null;
    return {
        traction: { plate: traction.plate },
        trailers: trailers.map((unit) => ({ plate: unit.plate })),
        label: [traction, ...trailers].map((unit) => unit.plate).join(' + '),
    };
}
