import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { validateSelectedCity, validateSelectedAddress } from './selectedCity.js';

const originals = { city: prisma.city.findUnique, cep: prisma.cEP.findUnique };
const sp = { name: 'São Paulo', ibgeCode: '3550308', state: { code: 'SP' } };
describe('selected municipality is the fiscal source', () => {
    beforeEach(() => {
        prisma.city.findUnique = (async ({ where }: any) => where.ibgeCode === sp.ibgeCode ? sp : null) as any;
        prisma.cEP.findUnique = (async () => ({ city: { ibgeCode: sp.ibgeCode } })) as any;
    });
    afterEach(() => { prisma.city.findUnique = originals.city; prisma.cEP.findUnique = originals.cep; });
    it('rejects a name without a selected IBGE code', async () => {
        await assert.rejects(validateSelectedCity({ city: 'São Paulo, SP', state: 'SP' }), /selecione/);
    });
    it('rejects stale codes, wrong UF, and nonexistent identifiers', async () => {
        for (const input of [
            { city: 'São Paulo do Potengi', state: 'RN', cityIbgeCode: '3550308' },
            { city: 'São Paulo', state: 'RN', cityIbgeCode: '3550308' },
            { city: 'São Paulo', state: 'SP', cityIbgeCode: '9999999' },
        ]) await assert.rejects(validateSelectedCity(input), /não correspondem/);
    });
    it('keeps the official name of the selected identifier, allowing unaccented input', async () => {
        assert.deepEqual(await validateSelectedCity({ city: 'sao paulo', state: 'SP', cityIbgeCode: sp.ibgeCode }), {
            city: 'São Paulo', state: 'SP', cityIbgeCode: sp.ibgeCode,
        });
    });
    it('rejects a valid city whose IBGE differs from the CEP', async () => {
        prisma.city.findUnique = (async () => ({ name: 'São Paulo do Potengi', state: { code: 'RN' }, ibgeCode: '2412609' })) as any;
        await assert.rejects(validateSelectedAddress({ cep: '01310100', city: 'São Paulo do Potengi', state: 'RN', cityIbgeCode: '2412609' }), /não corresponde ao CEP/);
    });
});
