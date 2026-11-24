import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import { JWT_ALGORITHM } from '../lib/jwtConfig.js';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { hubsRouter } from './hubs.js';

describe('hubs — tabelas de preço da cobertura', () => {
    const hubId = 'c0000000-0000-4000-8000-000000000001';
    const generalTableId = 'c0000000-0000-4000-8000-000000000002';
    const specialTableId = 'c0000000-0000-4000-8000-000000000003';
    const inactiveTableId = 'c0000000-0000-4000-8000-000000000004';
    const missingTableId = 'c0000000-0000-4000-8000-000000000005';
    const tables = [
        { id: generalTableId, type: 'GENERAL', active: true, description: 'Tarifa regional' },
        { id: specialTableId, type: 'SPECIAL', active: true, description: 'Tarifa especial' },
        { id: inactiveTableId, type: 'GENERAL', active: false, description: 'Tarifa inativa' },
    ];
    const cities = [
        { ibgeCode: '2105302', name: 'Imperatriz', state: { code: 'MA' } },
        { ibgeCode: '2111300', name: 'São Luís', state: { code: 'MA' } },
    ];
    const original = {
        jwtSecret: process.env.JWT_SECRET,
        hubFindUnique: prisma.hub.findUnique,
        userFindUnique: prisma.user.findUnique,
        cityFindMany: prisma.city.findMany,
        hubCoverageFindMany: prisma.hubCoverage.findMany,
        transaction: prisma.$transaction,
    };
    let saved: Prisma.HubCoverageCreateManyInput[] = [];
    let deleteCount = 0;
    let server: ReturnType<express.Express['listen']> | null = null;
    let endpoint = '';
    let token = '';

    before(async () => {
        process.env.JWT_SECRET = 'it-secret-hub-coverage';
        token = jwt.sign({ userId: 'admin-1' }, process.env.JWT_SECRET, { algorithm: JWT_ALGORITHM });
        prisma.hub.findUnique = (async () => ({ id: hubId })) as never;
        prisma.user.findUnique = (async () => ({ id: 'admin-1', active: true, roles: ['ADMIN'] })) as never;
        prisma.city.findMany = (async () => cities) as never;
        prisma.hubCoverage.findMany = (async ({ include }: Prisma.HubCoverageFindManyArgs) => {
            assert.deepEqual(include?.pricingTable, { select: { id: true, description: true } });
            return saved.map((entry) => {
                const table = tables.find(({ id }) => id === entry.pricingTableId);
                return { ...entry, pricingTable: table ? { id: table.id, description: table.description } : null };
            });
        }) as never;
        const tx = {
            pricingTable: {
                findMany: async ({ where }: { where: { id: { in: string[] }; type: string; active: boolean } }) => tables
                    .filter((table) => where.id.in.includes(table.id) && where.type === table.type && where.active === table.active)
                    .map(({ id }) => ({ id })),
            },
            hubCoverage: {
                deleteMany: async () => { deleteCount++; saved = []; },
                createMany: async ({ data }: { data: Prisma.HubCoverageCreateManyInput[] }) => { saved = data; },
                findMany: prisma.hubCoverage.findMany,
            },
        };
        prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            callback(tx as unknown as Prisma.TransactionClient)) as typeof prisma.$transaction;

        const app = express();
        app.use(express.json());
        app.use('/hubs', hubsRouter);
        app.use(errorHandler);
        await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
        const address = server!.address();
        assert.ok(address && typeof address === 'object');
        endpoint = `http://127.0.0.1:${address.port}/hubs/${hubId}/coverage`;
    });

    beforeEach(() => {
        saved = [];
        deleteCount = 0;
    });

    after(async () => {
        if (original.jwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = original.jwtSecret;
        prisma.hub.findUnique = original.hubFindUnique;
        prisma.user.findUnique = original.userFindUnique;
        prisma.city.findMany = original.cityFindMany;
        prisma.hubCoverage.findMany = original.hubCoverageFindMany;
        prisma.$transaction = original.transaction;
        await new Promise<void>((resolve) => server?.close(() => resolve()));
    });

    function putCoverage(entries: { cityIbgeCode: string; pricingTableId?: string | null }[]) {
        return fetch(endpoint, {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ entries }),
        });
    }

    for (const [kind, id] of [['especial', specialTableId], ['inativa', inactiveTableId], ['inexistente', missingTableId]]) {
        it(`rejeita tabela ${kind} sem apagar a cobertura`, async () => {
            const response = await putCoverage([{ cityIbgeCode: cities[0].ibgeCode, pricingTableId: id }]);

            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { success: false, error: 'Tabela de preço inválida para cobertura' });
            assert.equal(deleteCount, 0);
        });
    }

    it('salva uma tabela geral e retorna o mesmo vínculo no PUT e no GET', async () => {
        const response = await putCoverage([
            { cityIbgeCode: cities[0].ibgeCode, pricingTableId: generalTableId },
            { cityIbgeCode: cities[1].ibgeCode },
        ]);

        assert.equal(response.status, 200);
        assert.deepEqual(saved.map(({ pricingTableId }) => pricingTableId), [generalTableId, null]);
        const updated = await response.json() as { data: { pricingTableId: string | null; pricingTableName: string | null }[] };
        assert.deepEqual(updated.data.map(({ pricingTableId, pricingTableName }) => [pricingTableId, pricingTableName]), [
            [generalTableId, 'Tarifa regional'],
            [null, null],
        ]);

        const current = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(current.status, 200);
        assert.deepEqual(await current.json(), updated);
    });
});
