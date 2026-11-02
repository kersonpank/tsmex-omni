import prisma from '../lib/prisma.js';
import { linkVehicleInclude } from './vehicleUnitService.js';
import { normalizePlate } from './vehicleUnitRules.js';
import { setManifestVehicles } from './manifestVehicleService.js';
import { replaceManifestDrivers } from './manifestDriverAssignments.js';

type Unit = { id?: string; plate: string };
type Driver = { id: string; active: boolean };
type LastTrip = {
    id: string;
    status?: string;
    vehicleAssignments: Array<{ slot: number; vehicleUnit: Unit }>;
    driverAssignments: Array<{ sequence: number; driver: Driver }>;
    driverId: string | null;
    driver?: Driver | null;
};
type Carrier = {
    tractionUnit?: Unit | null;
    trailer1Unit?: Unit | null;
    trailer2Unit?: Unit | null;
    trailer3Unit?: Unit | null;
    vehiclePlate?: string | null;
    trailerPlate?: string | null;
    trailer2Plate?: string | null;
    trailer3Plate?: string | null;
    drivers?: Driver[];
};
export type TripCompositionDefaults = {
    source: 'LAST_TRIP' | 'CARRIER_DEFAULT';
    fromManifestId: string | null;
    traction: { plate: string; vehicleUnitId: string | null };
    trailers: Array<{ plate: string; vehicleUnitId: string | null }>;
    driverIds: string[];
};

export function pickTripCompositionDefaults(lastTrip: LastTrip | null, link: Carrier | null): TripCompositionDefaults | null {
    const selected = (unit: Unit | null | undefined, legacy?: string | null) => ({
        plate: normalizePlate(unit?.plate || legacy), vehicleUnitId: unit?.id ?? null,
    });
    if (lastTrip && lastTrip.status !== 'CANCELLED') {
        const assignments = [...lastTrip.vehicleAssignments].sort((a, b) => a.slot - b.slot);
        const traction = assignments.find((item) => item.slot === 0);
        if (traction && normalizePlate(traction.vehicleUnit.plate)) {
            const drivers = [...lastTrip.driverAssignments].sort((a, b) => a.sequence - b.sequence)
                .filter((item) => item.driver.active).map((item) => item.driver.id);
            if (!drivers.length && lastTrip.driverId && lastTrip.driver?.active) drivers.push(lastTrip.driverId);
            return {
                source: 'LAST_TRIP', fromManifestId: lastTrip.id, traction: selected(traction.vehicleUnit),
                trailers: assignments.filter((item) => item.slot > 0).map((item) => selected(item.vehicleUnit)),
                driverIds: [...new Set(drivers)],
            };
        }
    }
    if (!link) return null;
    const traction = selected(link.tractionUnit, link.vehiclePlate);
    if (!traction.plate) return null;
    const drivers = [...new Map((link.drivers ?? []).filter((driver) => driver.active).map((driver) => [driver.id, driver])).values()];
    return {
        source: 'CARRIER_DEFAULT', fromManifestId: null, traction,
        trailers: [selected(link.trailer1Unit, link.trailerPlate), selected(link.trailer2Unit, link.trailer2Plate), selected(link.trailer3Unit, link.trailer3Plate)].filter((unit) => unit.plate),
        driverIds: drivers.length === 1 ? [drivers[0].id] : [],
    };
}

export async function resolveTripCompositionDefaults(linkId: string, excludeManifestId: string): Promise<TripCompositionDefaults | null> {
    const [lastTrip, link, drivers] = await Promise.all([
        prisma.manifest.findFirst({
            where: { linkId, id: { not: excludeManifestId }, status: { not: 'CANCELLED' }, vehicleAssignments: { some: { slot: 0 } } },
            orderBy: { updatedAt: 'desc' },
            include: { vehicleAssignments: { orderBy: { slot: 'asc' }, include: { vehicleUnit: true } }, driverAssignments: { orderBy: { sequence: 'asc' }, include: { driver: true } }, driver: true },
        }),
        prisma.link.findUnique({ where: { id: linkId }, include: linkVehicleInclude }),
        prisma.driver.findMany({ where: { active: true, OR: [{ linkId }, { carriers: { some: { linkId, active: true } } }] }, select: { id: true, active: true } }),
    ]);
    return pickTripCompositionDefaults(lastTrip, link ? { ...link, drivers } : null);
}

export async function applyTripCompositionDefaults(manifestId: string): Promise<TripCompositionDefaults | null> {
    try {
        const manifest = await prisma.manifest.findUnique({ where: { id: manifestId }, include: { _count: { select: { vehicleAssignments: true } } } });
        if (!manifest || manifest.status !== 'DRAFT' || !manifest.linkId || manifest._count.vehicleAssignments) return null;
        const defaults = await resolveTripCompositionDefaults(manifest.linkId, manifestId);
        if (!defaults) return null;
        await setManifestVehicles(manifestId, { traction: { plate: defaults.traction.plate }, trailers: defaults.trailers.map(({ plate }) => ({ plate })) });
        const fresh = await prisma.manifest.findUnique({ where: { id: manifestId }, include: { _count: { select: { driverAssignments: true } } } });
        if (fresh?.status === 'DRAFT' && fresh.linkId === manifest.linkId && !fresh.driverId && !fresh._count.driverAssignments && defaults.driverIds.length) {
            await replaceManifestDrivers(manifestId, defaults.driverIds, fresh.updatedAt);
        }
        return defaults;
    } catch (error) {
        console.warn('[tripCompositionDefaults] Não foi possível preencher a composição', { manifestId, error });
        return null;
    }
}
