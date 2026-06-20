import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { ufToCuf, resolveIbgeMunicipio, validateAndNormalizeCity } from './acbrIbge.js';
import { AppError } from '../../middleware/errorHandler.js';

const originalCityFindMany = prisma.city.findMany;

describe('acbrIbge helpers', () => {
    afterEach(() => {
        prisma.city.findMany = originalCityFindMany;
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
            prisma.city.findMany = (async () => []) as any;

            // Test fallbacks
            assert.equal(await resolveIbgeMunicipio('QualquerCidade', 'MA'), '2111300'); // São Luís, MA
            assert.equal(await resolveIbgeMunicipio('QualquerCidade', 'SP'), '3550308'); // São Paulo, SP
            assert.equal(await resolveIbgeMunicipio('QualquerCidade', 'PR'), '4106902'); // Curitiba, PR
            assert.equal(await resolveIbgeMunicipio('QualquerCidade', 'XX'), '3550308'); // Fallback global
        });

        it('retorna código IBGE da cidade encontrada no banco (busca exata)', async () => {
            prisma.city.findMany = (async () => [
                { name: 'São Luís', ibgeCode: '2111300' },
                { name: 'Imperatriz', ibgeCode: '2105302' },
            ]) as any;

            const code = await resolveIbgeMunicipio('Imperatriz', 'MA');
            assert.equal(code, '2105302');
        });

        it('retorna código IBGE da cidade encontrada no banco (busca insensível a acentos/casing)', async () => {
            prisma.city.findMany = (async () => [
                { name: 'São Luís', ibgeCode: '2111300' },
                { name: 'Imperatriz', ibgeCode: '2105302' },
            ]) as any;

            const code1 = await resolveIbgeMunicipio('sao luis', 'MA');
            assert.equal(code1, '2111300');

            const code2 = await resolveIbgeMunicipio('SÃO LUIS', 'MA');
            assert.equal(code2, '2111300');
        });
    });

    describe('validateAndNormalizeCity', () => {
        it('retorna o nome oficial normalizado se a cidade existir no estado', async () => {
            prisma.city.findMany = (async () => [
                { name: 'São Luís' },
                { name: 'São Paulo' },
            ]) as any;

            const result1 = await validateAndNormalizeCity('sao luis', 'MA');
            assert.equal(result1, 'São Luís');

            const result2 = await validateAndNormalizeCity('SAO PAULO', 'SP');
            assert.equal(result2, 'São Paulo');
        });

        it('lança AppError se o estado não for fornecido', async () => {
            await assert.rejects(
                validateAndNormalizeCity('São Luís', ''),
                (err: any) => err instanceof AppError && err.statusCode === 400 && err.message.includes('estado')
            );
        });

        it('lança AppError se a cidade não for encontrada para o estado', async () => {
            prisma.city.findMany = (async () => [
                { name: 'São Luís' },
            ]) as any;

            await assert.rejects(
                validateAndNormalizeCity('São Paulo', 'MA'),
                (err: any) => err instanceof AppError && err.statusCode === 400 && err.message.includes('não foi encontrada')
            );
        });
    });
});
