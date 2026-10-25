import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { resolveCatalogCity } from './selectedCity.js';

const original = prisma.city.findMany;
const ma = [
    { name: 'São Luís', ibgeCode: '2111300', state: { code: 'MA' } },
    { name: 'Imperatriz', ibgeCode: '2105302', state: { code: 'MA' } },
];

describe('resolveCatalogCity (cadastro de hub)', () => {
    beforeEach(() => {
        prisma.city.findMany = (async ({ where }: any) => (where.state.code === 'MA' ? ma : [])) as any;
    });
    afterEach(() => { prisma.city.findMany = original; });

    it('completa o IBGE pela cidade digitada, sem acento e em qualquer caixa', async () => {
        assert.deepEqual(await resolveCatalogCity({ city: 'sao luis', state: 'ma' }), {
            city: 'São Luís', state: 'MA', cityIbgeCode: '2111300',
        });
    });

    it('recusa cidade que não está no catálogo da UF', async () => {
        await assert.rejects(resolveCatalogCity({ city: 'Imperatriz', state: 'SP' }), /não está no catálogo/);
    });
});
