import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { resolveIntakeClientByDocument } from './resolveIntakeClientByDocument.js';

describe('resolveIntakeClientByDocument', () => {
    const origFindFirst = prisma.client.findFirst.bind(prisma.client);

    afterEach(() => {
        prisma.client.findFirst = origFindFirst;
    });

    it('documento curto → not_found', async () => {
        const result = await resolveIntakeClientByDocument('123');
        assert.equal(result.status, 'not_found');
        assert.equal(result.document, '123');
    });

    it('CNPJ cadastrado → found com campos mínimos', async () => {
        prisma.client.findFirst = (async () => ({
            id: 'client-1',
            companyName: 'Cliente Teste LTDA',
            document: '12345678000190',
        })) as unknown as typeof prisma.client.findFirst;

        const result = await resolveIntakeClientByDocument('12.345.678/0001-90');
        assert.equal(result.status, 'found');
        assert.equal(result.document, '12345678000190');
        assert.deepEqual(result.client, {
            id: 'client-1',
            companyName: 'Cliente Teste LTDA',
            document: '12345678000190',
        });
    });

    it('CNPJ inexistente → not_found', async () => {
        prisma.client.findFirst = (async () => null) as unknown as typeof prisma.client.findFirst;

        const result = await resolveIntakeClientByDocument('99999999000199');
        assert.equal(result.status, 'not_found');
        assert.equal(result.document, '99999999000199');
    });
});
