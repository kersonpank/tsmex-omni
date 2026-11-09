import axios from 'axios';
import { MUNICIPIO_COORDS } from '../../data/municipiosCoords.js';

export interface TripDistance {
    distanceKm: number;
    source: 'GOOGLE' | 'OSRM' | 'ESTIMATE';
    calculatedAt: string;
}

const TTL = 24 * 60 * 60 * 1000;
// Estimativa em linha reta vale pouco: tenta o provedor de rota de novo logo.
const ESTIMATE_TTL = 10 * 60 * 1000;
const cache = new Map<string, TripDistance>();
// GET da viagem, pendências e estimativa de preço pedem a mesma rota ao mesmo tempo: uma chamada só.
const inFlight = new Map<string, Promise<TripDistance | null>>();
const ttlOf = (value: TripDistance) => (value.source === 'ESTIMATE' ? ESTIMATE_TTL : TTL);

function haversine(a: [number, number], b: [number, number]): number {
    const rad = (n: number) => n * Math.PI / 180;
    const dLat = rad(b[0] - a[0]);
    const dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Sugestão rodoviária; nunca substitui a distância confirmada pelo operador. */
export async function estimateTripDistanceKm(input: {
    originIbge: string; destinationIbge: string; waypointIbges?: string[];
}): Promise<TripDistance | null> {
    const key = JSON.stringify([input.originIbge, ...(input.waypointIbges ?? []), input.destinationIbge]);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const run = computeTripDistance(input).finally(() => inFlight.delete(key));
    inFlight.set(key, run);
    return run;
}

async function computeTripDistance(input: {
    originIbge: string; destinationIbge: string; waypointIbges?: string[];
}): Promise<TripDistance | null> {
    try {
        const codes = [input.originIbge, ...(input.waypointIbges ?? []), input.destinationIbge];
        const coords = codes.map((code) => MUNICIPIO_COORDS[code]);
        if (coords.some((coord) => !coord)) return null;
        const key = JSON.stringify(codes);
        const previous = cache.get(key);
        if (previous && Date.now() - Date.parse(previous.calculatedAt) < ttlOf(previous)) return previous;
        // Remove entradas vencidas para não acumular rotas indefinidamente.
        for (const [entry, value] of cache) if (Date.now() - Date.parse(value.calculatedAt) >= ttlOf(value)) cache.delete(entry);
        const save = (distanceKm: number, source: TripDistance['source']) => {
            const result = { distanceKm: Math.round(distanceKm), source, calculatedAt: new Date().toISOString() };
            cache.set(key, result);
            return result;
        };
        if (process.env.GOOGLE_MAPS_API_KEY) {
            try {
                const point = ([latitude, longitude]: [number, number]) => ({ location: { latLng: { latitude, longitude } } });
                const response = await axios.post('https://routes.googleapis.com/directions/v2:computeRoutes', {
                    origin: point(coords[0]), destination: point(coords.at(-1)!),
                    intermediates: coords.slice(1, -1).map(point), travelMode: 'DRIVE',
                }, { timeout: 8000, headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': 'routes.distanceMeters' } });
                const meters = response.data?.routes?.[0]?.distanceMeters;
                if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) throw new Error('Resposta de rota inválida');
                return save(meters / 1000, 'GOOGLE');
            } catch { console.warn('[tripDistance] Google indisponível; tentando OSRM.'); }
        }
        try {
            const base = (process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org').replace(/\/$/, '');
            const chain = coords.map(([lat, lng]) => `${lng},${lat}`).join(';');
            const response = await axios.get(`${base}/route/v1/driving/${chain}?overview=false`, { timeout: 8000 });
            const meters = response.data?.routes?.[0]?.distance;
            if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) throw new Error('Resposta de rota inválida');
            return save(meters / 1000, 'OSRM');
        } catch { console.warn('[tripDistance] OSRM indisponível; usando estimativa em linha reta.'); }
        return save(coords.slice(1).reduce((sum, coord, index) => sum + haversine(coords[index], coord), 0) * 1.25, 'ESTIMATE');
    } catch {
        console.warn('[tripDistance] Não foi possível sugerir a distância.');
        return null;
    }
}
