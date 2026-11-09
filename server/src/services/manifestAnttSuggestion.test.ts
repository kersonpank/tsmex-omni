import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';
import axios from 'axios';
import prisma from '../lib/prisma.js';
import { getManifestAnttSuggestion, manifestRouteCities, tripAxles } from './manifestAnttSuggestion.js';

const unit = (plate: string, axles: number | null, role: 'TRACTION' | 'TRAILER') => ({ plate, axles, role });
const trip = {
    id: 'test-trip', originCity: 'Guarulhos', originState: 'SP', originCityIbgeCode: '3518800',
    destinationCity: 'São Luís', destinationState: 'MA', destinationCityIbgeCode: '2111300',
    vehicleAssignments: [
        { slot: 0, vehicleUnit: unit('BWP6E54', 3, 'TRACTION') },
        { slot: 1, vehicleUnit: unit('AFY2E46', 4, 'TRAILER') },
    ],
};
const originalFindUnique = prisma.manifest.findUnique;
function mockManifest(value: unknown) {
    prisma.manifest.findUnique = (async () => value) as any;
}
afterEach(() => { mock.restoreAll(); prisma.manifest.findUnique = originalFindUnique; });
it('soma as unidades da viagem e recusa composição incompleta', () => {
    assert.equal(tripAxles(trip).eixos, 7);
    const missing = { vehicleAssignments: [...trip.vehicleAssignments, { slot: 2, vehicleUnit: unit('ABC1D23', null, 'TRAILER') }] };
    assert.deepEqual(tripAxles(missing), { eixos: null, reason: 'Informe os eixos de cada placa' });
    assert.equal(tripAxles({ vehicleAssignments: [] }).eixos, null);
    assert.equal(tripAxles({ ...trip, compositionSnapshot: { traction: unit('BWP6E54', 2, 'TRACTION'), trailers: [unit('AFY2E46', 3, 'TRAILER')] } }).eixos, 5);
});
it('usa a mesma origem/destino do CIOT, ordenando as paradas intermediárias', () => {
    const result = manifestRouteCities({ ...trip, tripStops: [
        { sequence: 2, destCity: 'São Luís', destState: 'MA', destCityIbgeCode: '2111300' },
        { sequence: 1, destHub: { city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308' } },
    ] });
    assert.equal(result.origin.ibge, '3518800');
    assert.equal(result.destination.ibge, '2111300');
    assert.deepEqual(result.waypoints.map((point) => point.ibge), ['3550308']);
    assert.equal(manifestRouteCities({ hub: { cityIbgeCode: '3518800' }, destHub: { cityIbgeCode: '2111300' } }).destination.ibge, '2111300');
});
it('retorna distância real, eixos e piso padrão de carga geral', async () => {
    mockManifest(trip);
    mock.method(axios, 'get', async () => ({ data: { routes: [{ distance: 2996000 }] } }));
    mock.method(axios, 'post', async () => { throw new Error('sem Google'); });
    const result = await getManifestAnttSuggestion(trip.id);
    assert.equal(result.distanceKm, 2996);
    assert.equal(result.distanceSource, 'OSRM');
    assert.equal(result.eixos, 7);
    assert.equal(result.anttFloor.tipoCarga, 5);
    assert.equal(result.anttFloor.value, 25616.67);
});
it('piso usa a última distância digitada e aceita nova simulação sem mudar a viagem', async () => {
    mockManifest({ ...trip, ciotEmissionJobs: [{ requestData: { distanciaPercorrida: 2950 } }] });
    const get = mock.method(axios, 'get', async () => { throw new Error('não consultar rota'); });
    assert.equal((await getManifestAnttSuggestion(trip.id, { useLastCiotDistance: true })).anttFloor.value, 25236.13);
    const simulation = await getManifestAnttSuggestion(trip.id, { distanceKm: 2950, tipoCarga: 5, altoDesempenho: true });
    assert.equal(simulation.anttFloor.value, 20633.11);
    assert.equal(get.mock.callCount(), 0);
});
it('faltam eixos: retorna o motivo no piso, sem inventar coluna', async () => {
    mockManifest({ ...trip, vehicleAssignments: [] });
    const result = await getManifestAnttSuggestion(trip.id, { distanceKm: 2950 });
    assert.equal(result.anttFloor.value, null);
    assert.equal('reason' in result.anttFloor && result.anttFloor.reason, 'Informe os eixos de cada placa');
});
