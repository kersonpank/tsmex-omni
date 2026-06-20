import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { ufToCuf, resolveIbgeMunicipio } from './acbrIbge.js';

const originalCityFindFirst = prisma.city.findFirst;

describe('acbrIbge helpers', () => {
    afterEach(() => {
        prisma.city.findFirst = originalCityFindFirst;
    });

    describe('ufToCuf', () => {
        it('retorna o código CUF numérico correto para cada UF', () => {
            assert.equal(ufToCuf('SP'), 35);
            assert.equal(ufToCuf('MA'), 21);
            assert.equal(ufToCuf('RJ'), 33);
            assert.equal(ufToCuf('ZZ'), 35); // fallback
        });
    });

    describe('resolveIbgeMunicipio', () => {
        it('retorna código da capital do estado correspondente quando cidade não é encontrada no banco', async () => {
            prisma.city.findFirst = (async () => null) as typeof prisma.city.findFirst;

            // Test fallbacks
            assert.equal(await resolveIbgeMunicipio('QualquerCidade', 'MA'), '2111300'); // São Luís, MA
            assert.equal(await resolveIbgeMunicipio('QualquerCidade', 'SP'), '3550308'); // São Paulo, SP
            assert.equal(await resolveIbgeMunicipio('QualquerCidade', 'PR'), '4106902'); // Curitiba, PR
            assert.equal(await resolveIbgeMunicipio('QualquerCidade', 'XX'), '3550308'); // Fallback global
        });

        it('retorna código IBGE da cidade encontrada no banco', async () => {
            prisma.city.findFirst = (async () => ({ ibgeCode: '2105302' })) as typeof prisma.city.findFirst;

            const code = await resolveIbgeMunicipio('Imperatriz', 'MA');
            assert.equal(code, '2105302');
        });
    });
});
