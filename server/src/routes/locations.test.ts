import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import axios from 'axios';
import prisma from '../lib/prisma.js';
import { locationsRouter } from './locations.js';
import { errorHandler } from '../middleware/errorHandler.js';

describe('municipality lookup API', () => {
    const originals = { cities: prisma.city.findMany, city: prisma.city.findUnique, cep: prisma.cEP.findUnique, saveCep: prisma.cEP.upsert, state: prisma.state.findUnique, get: axios.get };
    const sp = { id: 'sp', name: 'São Paulo', ibgeCode: '3550308', stateId: 'state-sp', state: { id: 'state-sp', code: 'SP', name: 'São Paulo' } };
    const rn = { id: 'rn', name: 'São Paulo do Potengi', ibgeCode: '2412609', stateId: 'state-rn', state: { id: 'state-rn', code: 'RN', name: 'Rio Grande do Norte' } };
    let url: string;
    let server: ReturnType<express.Express['listen']>;
    let savedCep: any;
    before(async () => {
        prisma.city.findMany = (async ({ where }: any) => [rn, sp].filter(c => !where.state || c.state.code === where.state.code)) as any;
        prisma.city.findUnique = (async ({ where }: any) => [sp, rn].find(c => c.ibgeCode === where.ibgeCode)) as any;
        prisma.state.findUnique = (async () => sp.state) as any;
        // Incomplete legacy cache entries must be refreshed.
        prisma.cEP.findUnique = (async () => ({ cep: '01310100', city: null, state: sp.state })) as any;
        prisma.cEP.upsert = (async (args: any) => { savedCep = args; return args.create; }) as any;
        axios.get = (async () => ({ data: { cep: '01310-100', localidade: 'São Paulo', uf: 'SP', ibge: '3550308', logradouro: 'Avenida Paulista', bairro: 'Bela Vista' } })) as any;
        const app = express(); app.use('/locations', locationsRouter); app.use(errorHandler);
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        url = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    after(async () => {
        prisma.city.findMany = originals.cities; prisma.city.findUnique = originals.city; prisma.state.findUnique = originals.state;
        prisma.cEP.findUnique = originals.cep; prisma.cEP.upsert = originals.saveCep; axios.get = originals.get;
        await new Promise<void>(resolve => server.close(() => resolve()));
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
});
