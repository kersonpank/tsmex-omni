import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { computeAnttFloor } from './antt/anttFloor.js';
import { estimateTripDistanceKm } from './routing/tripDistance.js';
import { resolveManifestComposition } from './vehicleUnitRules.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from './vehicleUnitService.js';

interface RouteCitySource {
    city?: string | null;
    state?: string | null;
    cityIbgeCode?: string | null;
}

interface ManifestRouteSource {
    originCity?: string | null;
    originState?: string | null;
    originCityIbgeCode?: string | null;
    destinationCity?: string | null;
    destinationState?: string | null;
    destinationCityIbgeCode?: string | null;
    hub?: RouteCitySource | null;
    destHub?: RouteCitySource | null;
    tripStops?: Array<{ sequence: number; destCity?: string | null; destState?: string | null; destCityIbgeCode?: string | null; destHub?: RouteCitySource | null }>;
}

/** Mesmas fontes canônicas usadas na emissão. Nunca infere IBGE a partir do nome. */
export function manifestRouteCities(manifest: ManifestRouteSource) {
    const origin = manifest.originCity || manifest.originCityIbgeCode
        ? { city: manifest.originCity, state: manifest.originState, ibge: manifest.originCityIbgeCode }
        : { city: manifest.hub?.city, state: manifest.hub?.state, ibge: manifest.hub?.cityIbgeCode };
    const stops = [...(manifest.tripStops ?? [])].sort((a, b) => a.sequence - b.sequence);
    const stopCities = stops.map((stop) => ({
        city: stop.destHub?.city ?? stop.destCity, state: stop.destHub?.state ?? stop.destState,
        ibge: stop.destHub?.cityIbgeCode ?? stop.destCityIbgeCode,
    }));
    let last = -1;
    stopCities.forEach((value, index) => { if (value.city && value.state) last = index; });
    const destination = last >= 0 ? stopCities[last] : {
        city: manifest.destHub?.city ?? manifest.destinationCity, state: manifest.destHub?.state ?? manifest.destinationState,
        ibge: manifest.destHub?.cityIbgeCode ?? manifest.destinationCityIbgeCode,
    };
    return { origin, destination, waypoints: last >= 0 ? stopCities.slice(0, last) : stopCities };
}

export function tripAxles(manifest: Parameters<typeof resolveManifestComposition>[0]) {
    const units = resolveManifestComposition(manifest).units;
    if (!units.length || units.some((unit) => !Number.isInteger(unit.axles) || (unit.axles ?? 0) < 1)) {
        return { eixos: null, reason: 'Informe os eixos de cada placa' };
    }
    return { eixos: units.reduce((sum, unit) => sum + unit.axles!, 0), reason: null };
}

export async function getManifestAnttSuggestion(manifestId: string, params: {
    tipoCarga?: number; distanceKm?: number; altoDesempenho?: boolean; useLastCiotDistance?: boolean;
} = {}) {
    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId }, include: {
        hub: true, destHub: true, tripStops: { orderBy: { sequence: 'asc' }, include: { destHub: true } },
        vehicleAssignments: manifestVehicleAssignmentsInclude, link: { include: linkVehicleInclude },
        ciotEmissionJobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { requestData: true } },
    } });
    if (!manifest) throw new AppError('Viagem não encontrada.', 404);
    const { origin, destination, waypoints } = manifestRouteCities(manifest);
    const { eixos } = tripAxles(manifest);
    const lastJob = params.useLastCiotDistance ? manifest.ciotEmissionJobs?.[0] : null;
    const request = lastJob?.requestData as { distanciaPercorrida?: number; codigoTipoCarga?: number; altoDesempenho?: boolean } | null;
    const typedDistance = request?.distanciaPercorrida;
    const confirmedDistance = params.distanceKm ?? (typedDistance != null && Number.isFinite(typedDistance) && typedDistance > 0 ? typedDistance : null);
    const distance = confirmedDistance == null ? await estimateTripDistanceKm({ originIbge: origin.ibge ?? '', destinationIbge: destination.ibge ?? '', waypointIbges: waypoints.map((point) => point.ibge ?? '') }) : null;
    const floorDistance = confirmedDistance ?? distance?.distanceKm ?? null;
    return {
        distanceKm: distance?.distanceKm ?? null, distanceSource: distance?.source ?? null, eixos,
        anttFloor: computeAnttFloor({ tipoCarga: params.tipoCarga ?? request?.codigoTipoCarga ?? 5, eixos, distanceKm: floorDistance, altoDesempenho: params.altoDesempenho ?? request?.altoDesempenho ?? false }),
    };
}
