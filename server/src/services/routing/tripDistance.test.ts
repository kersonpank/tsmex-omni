import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';
import axios from 'axios';
import { estimateTripDistanceKm } from './tripDistance.js';

const originalKey = process.env.GOOGLE_MAPS_API_KEY;
const originalBase = process.env.OSRM_BASE_URL;
afterEach(() => {
    mock.restoreAll();
    if (originalKey == null) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = originalKey;
    if (originalBase == null) delete process.env.OSRM_BASE_URL; else process.env.OSRM_BASE_URL = originalBase;
});
it('retorna null sem coordenadas e não consulta provedores', async () => {
    const get = mock.method(axios, 'get', async () => { throw new Error('não chamar'); });
    assert.equal(await estimateTripDistanceKm({ originIbge: '0', destinationIbge: '2111300' }), null);
    assert.equal(get.mock.callCount(), 0);
});
it('Google tem prioridade, inclui paradas e arredonda km; cache dura 24h', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-only';
    const clock = mock.method(Date, 'now', () => Date.parse('2026-11-09T00:00:00Z'));
    const post = mock.method(axios, 'post', async (_url: string, body: any, config: any) => {
        assert.equal(body.travelMode, 'DRIVE');
        assert.equal(body.intermediates.length, 1);
        assert.equal(config.timeout, 8000);
        return { data: { routes: [{ distanceMeters: 2996499 }] } };
    });
    const input = { originIbge: '3518800', destinationIbge: '2111300', waypointIbges: ['3550308'] };
    const first = await estimateTripDistanceKm(input);
    assert.equal(first?.source, 'GOOGLE');
    assert.equal(first?.distanceKm, 2996);
    assert.equal(await estimateTripDistanceKm(input), first);
    assert.equal(post.mock.callCount(), 1);
    clock.mock.mockImplementation(() => Date.parse(first!.calculatedAt) + 86400001);
    await estimateTripDistanceKm(input);
    assert.equal(post.mock.callCount(), 2);
});
it('falha do Google cai no OSRM com longitude antes da latitude e timeout', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-only';
    process.env.OSRM_BASE_URL = 'https://routing.example/';
    mock.method(axios, 'post', async () => { throw new Error('indisponível'); });
    mock.method(axios, 'get', async (url: string, config: any) => {
        assert.match(url, /^https:\/\/routing.example\/route\/v1\/driving\/-46/);
        assert.match(url, /\?overview=false$/);
        assert.equal(config.timeout, 8000);
        return { data: { routes: [{ distance: 2996000 }] } };
    });
    const result = await estimateTripDistanceKm({ originIbge: '3518800', destinationIbge: '2111300' });
    assert.equal(result?.source, 'OSRM');
    assert.equal(result?.distanceKm, 2996);
});
it('sem provedores usa haversine GRU→São Luís × 1,25 entre 2800 e 3000 km', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    mock.method(axios, 'get', async () => { throw new Error('offline'); });
    // Parada na própria origem mantém o percurso e distingue a chave do cache.
    const result = await estimateTripDistanceKm({ originIbge: '3518800', destinationIbge: '2111300', waypointIbges: ['3518800'] });
    assert.equal(result?.source, 'ESTIMATE');
    assert.ok(result!.distanceKm > 2800 && result!.distanceKm < 3000);
});
it('resposta inválida também cai para estimativa, somando todas as pernas', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    mock.method(axios, 'get', async () => ({ data: { routes: [{ distance: 'invalid' }] } }));
    const result = await estimateTripDistanceKm({ originIbge: '2111300', destinationIbge: '3518800', waypointIbges: ['3304557'] });
    assert.equal(result?.source, 'ESTIMATE');
    assert.ok(result!.distanceKm > 2900);
});
