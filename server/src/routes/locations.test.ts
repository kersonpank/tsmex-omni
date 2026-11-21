import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { locationsRouter } from './locations.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { cepProviders, lookupCep } from '../services/cepLookup.js';

describe('municipality lookup API', () => {
    const originals = { cities: prisma.city.findMany, city: prisma.city.findUnique, cep: prisma.cEP.findUnique, saveCep: prisma.cEP.upsert, state: prisma.state.findUnique, get: axios.get, user: prisma.user.findUnique, jwtSecret: process.env.JWT_SECRET };
    const sp = { id: 'sp', name: 'São Paulo', ibgeCode: '3550308', stateId: 'state-sp', state: { id: 'state-sp', code: 'SP', name: 'São Paulo' } };
    const rn = { id: 'rn', name: 'São Paulo do Potengi', ibgeCode: '2412609', stateId: 'state-rn', state: { id: 'state-rn', code: 'RN', name: 'Rio Grande do Norte' } };
    const withoutCoords = { ...sp, id: 'without-coords', name: 'Município sem coordenadas', ibgeCode: '9999999' };
    const jwtSecret = 'locations-test-secret';
    const saoPauloGeoCity = { ibgeCode: '3550308', name: 'São Paulo', state: 'SP', lat: -23.5329, lng: -46.6395 };
    let url: string;
    let server: ReturnType<express.Express['listen']>;
    let savedCep: any;
    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        prisma.user.findUnique = (async ({ where }: { where: { id: string } }) => ({
            id: where.id,
            email: 'locations@example.com',
            active: true,
            roles: [where.id === 'hub' ? 'HUB' : 'ADMIN'],
        })) as unknown as typeof prisma.user.findUnique;
        prisma.city.findMany = (async ({ where }: { where: { state?: { code: string }; ibgeCode?: { in: string[] } } }) =>
            [rn, sp, withoutCoords].filter(city =>
                (!where.state || city.state.code === where.state.code)
                && (!where.ibgeCode || where.ibgeCode.in.includes(city.ibgeCode)),
            )) as unknown as typeof prisma.city.findMany;
        prisma.city.findUnique = (async ({ where }: any) => [sp, rn].find(c => c.ibgeCode === where.ibgeCode)) as any;
        prisma.state.findUnique = (async () => sp.state) as any;
        // Incomplete legacy cache entries must be refreshed.
        prisma.cEP.findUnique = (async () => ({ cep: '01310100', city: null, state: sp.state })) as any;
        prisma.cEP.upsert = (async (args: any) => { savedCep = args; return args.create; }) as any;
        axios.get = (async () => ({ data: { cep: '01310-100', localidade: 'São Paulo', uf: 'SP', ibge: '3550308', logradouro: 'Avenida Paulista', bairro: 'Bela Vista' } })) as any;
        const app = express();
        app.use(express.json());
        app.use('/locations', locationsRouter);
        app.use(errorHandler);
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        url = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    after(async () => {
        prisma.city.findMany = originals.cities; prisma.city.findUnique = originals.city; prisma.state.findUnique = originals.state;
        prisma.cEP.findUnique = originals.cep; prisma.cEP.upsert = originals.saveCep; axios.get = originals.get;
        prisma.user.findUnique = originals.user;
        if (originals.jwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originals.jwtSecret;
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    const postCities = (path: 'within' | 'coords', body: unknown, userId: 'admin' | 'hub') =>
        fetch(`${url}/locations/cities/${path}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${jwt.sign({ userId }, jwtSecret)}`,
            },
            body: JSON.stringify(body),
        });

    it('returns São Paulo when it is inside the polygon', async () => {
        const response = await postCities('within', {
            polygon: [[-23.6, -46.7], [-23.6, -46.6], [-23.5, -46.6], [-23.5, -46.7]],
        }, 'admin');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, data: [saoPauloGeoCity] });
    });

    it('rejects a polygon with fewer than three points', async () => {
        const response = await postCities('within', { polygon: [[-23.6, -46.7], [-23.5, -46.6]] }, 'hub');
        assert.equal(response.status, 400);
    });

    it('returns coordinates for cities present in both catalogs', async () => {
        const response = await postCities('coords', { ibgeCodes: ['3550308', '3552502', '9999999'] }, 'hub');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, data: [saoPauloGeoCity] });
    });

    it('rejects invalid IBGE codes', async () => {
        const response = await postCities('coords', { ibgeCodes: ['355030x'] }, 'admin');
        assert.equal(response.status, 400);
    });

    it('searches accents before filtering and ranks exact names first', async () => {
        const response = await fetch(url + '/locations/search?q=sao%20paulo');
        const body = await response.json() as any;
        assert.deepEqual(body.data.map((c: any) => c.ibgeCode), ['3550308', '2412609']);
    });
    it('accepts a city, UF search and never ignores an invalid UF filter', async () => {
        const body = await (await fetch(url + '/locations/search?q=Sao%20Paulo%2C%20SP')).json() as any;
        assert.deepEqual(body.data.map((c: any) => c.ibgeCode), ['3550308']);
        const invalid = await (await fetch(url + '/locations/search?q=sao&state=ZZ')).json() as any;
        assert.deepEqual(invalid.data, []);
    });
    it('uses the ViaCEP IBGE identifier directly and repairs incomplete cache entries', async () => {
        const response = await fetch(url + '/locations/cep/01310100');
        const body = await response.json() as any;
        assert.equal(response.status, 200);
        assert.equal(body.data.cityIbgeCode, '3550308');
        assert.equal(body.data.cidade, 'São Paulo');
        assert.equal(body.data.uf, 'SP');
        assert.equal(savedCep.update.cityId, 'sp');
    });

    describe('cadeia de provedores de CEP', () => {
        const gb = { id: 'gb', name: 'Guarabira', ibgeCode: '2506301', stateId: 'state-pb', state: { id: 'state-pb', code: 'PB', name: 'Paraíba' } };
        const original = { chain: cepProviders.chain, cepFind: prisma.cEP.findUnique, city: prisma.city.findUnique, state: prisma.state.findUnique };
        const gbResult = { cep: '58200000', logradouro: '', bairro: '', cidade: 'Guarabira', uf: 'PB', ibge: '2506301', source: 'brasilapi' as const };
        before(() => {
            prisma.cEP.findUnique = (async () => null) as any;
            prisma.city.findUnique = (async () => gb) as any;
            prisma.state.findUnique = (async () => gb.state) as any;
        });
        after(() => {
            cepProviders.chain = original.chain; prisma.cEP.findUnique = original.cepFind;
            prisma.city.findUnique = original.city; prisma.state.findUnique = original.state;
        });
        it('CEP geral de município (ViaCEP não conhece) resolve pelo fallback com IBGE', async () => {
            cepProviders.chain = [async () => null, async () => gbResult];
            const response = await fetch(url + '/locations/cep/58200000');
            const body = await response.json() as any;
            assert.equal(response.status, 200);
            assert.equal(body.data.cityIbgeCode, '2506301');
            assert.equal(body.data.cidade, 'Guarabira');
            assert.equal(body.data.uf, 'PB');
            assert.equal(body.source, 'brasilapi');
        });
        it('provedor primário fora do ar não impede o fallback', async () => {
            cepProviders.chain = [async () => { throw new Error('timeout'); }, async () => gbResult];
            assert.equal((await lookupCep('58200000')).ibge, '2506301');
        });
        it('todos dizem que não existe: 404 em português', async () => {
            cepProviders.chain = [async () => null, async () => null];
            const response = await fetch(url + '/locations/cep/00000000');
            assert.equal(response.status, 404);
            assert.match(((await response.json()) as any).error, /CEP não encontrado/);
        });
        it('todos indisponíveis: 503, não "CEP inexistente"', async () => {
            cepProviders.chain = [async () => { throw new Error('x'); }, async () => { throw new Error('y'); }];
            const response = await fetch(url + '/locations/cep/58200000');
            assert.equal(response.status, 503);
        });
    });
});
