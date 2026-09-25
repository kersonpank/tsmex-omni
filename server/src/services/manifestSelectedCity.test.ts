import assert from 'node:assert/strict';
import { beforeEach, afterEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { selectedManifestCity } from './manifestSelectedCity.js';

const originals = { city: prisma.city.findUnique, hub: prisma.hub.findUnique };
describe('canonical trip municipality writes', () => {
    beforeEach(() => {
        prisma.city.findUnique = (async ({ where }: any) => where.ibgeCode === '3550308' ? { name: 'São Paulo', ibgeCode: '3550308', state: { code: 'SP' } } : null) as any;
        prisma.hub.findUnique = (async () => ({ city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308' })) as any;
    });
    afterEach(() => { prisma.city.findUnique = originals.city; prisma.hub.findUnique = originals.hub; });
    it('rejects a free text route without a selected identifier', async () => {
        await assert.rejects(selectedManifestCity({ origin: 'São Paulo, SP' }, 'origin'), /selecione/);
    });
    it('takes the complete tuple from a selected Hub', async () => {
        assert.deepEqual(await selectedManifestCity({}, 'origin', 'hub-sp'), {
            origin: 'São Paulo, SP', originCity: 'São Paulo', originState: 'SP', originCityIbgeCode: '3550308',
        });
    });
    it('never combines a manually entered city with the Hub code', async () => {
        await assert.rejects(selectedManifestCity({ originCity: 'Campinas', originState: 'SP' }, 'origin', 'hub-sp'), /selecione/);
    });
    it('persists the selected stop tuple', async () => {
        assert.deepEqual(await selectedManifestCity({ destCity: 'São Paulo', destState: 'SP', destCityIbgeCode: '3550308' }, 'dest'), {
            destCity: 'São Paulo', destState: 'SP', destCityIbgeCode: '3550308',
        });
    });
});
