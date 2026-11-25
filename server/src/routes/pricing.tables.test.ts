import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import { JWT_ALGORITHM } from '../lib/jwtConfig.js';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { pricingRouter } from './pricing.js';

describe('pricing — tabelas de preço', () => {
    const original = {
        jwtSecret: process.env.JWT_SECRET,
        userFindUnique: prisma.user.findUnique,
        tableCreate: prisma.pricingTable.create,
        tableFindFirst: prisma.pricingTable.findFirst,
        tableFindUnique: prisma.pricingTable.findUnique,
        tableUpdate: prisma.pricingTable.update,
        transaction: prisma.$transaction,
    };
    const tableId = 'table-1';
    const newTable = {
        description: 'Tarifa São Paulo–Maranhão',
        type: 'GENERAL',
        freightUnit: 'RS_KG',
        routeId: 'route-sp-ma',
    };
    const invalidDivisor = {
        success: false,
        error: 'Divisor do ICMS deve ficar entre 0 e 1 (ex.: 0,88 para 12% por dentro).',
    };
    let server: ReturnType<express.Express['listen']> | undefined;
    let endpoint = '';
    let token = '';
    let storedTable: Record<string, unknown> | undefined;
    let writeCount = 0;

    before(async () => {
        process.env.JWT_SECRET = 'it-secret-pricing-tables';
        token = jwt.sign({ userId: 'admin-1' }, process.env.JWT_SECRET, { algorithm: JWT_ALGORITHM });
        prisma.user.findUnique = (async () => ({ id: 'admin-1', active: true, roles: ['ADMIN'] })) as never;
        prisma.pricingTable.create = (async ({ data }: Prisma.PricingTableCreateArgs) => {
            writeCount++;
            storedTable = { ...data, id: tableId };
            return storedTable;
        }) as never;
        prisma.pricingTable.findFirst = (async () => storedTable) as never;
        prisma.pricingTable.findUnique = (async ({ where }: Prisma.PricingTableFindUniqueArgs) => {
            assert.equal(where.id, tableId);
            return storedTable;
        }) as never;
        prisma.pricingTable.update = (async ({ where, data }: Prisma.PricingTableUpdateArgs) => {
            assert.equal(where.id, tableId);
            writeCount++;
            storedTable = { ...storedTable, ...data };
            return storedTable;
        }) as never;
        prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            callback(prisma)) as typeof prisma.$transaction;

        const app = express();
        app.use(express.json());
        app.use('/pricing', pricingRouter);
        app.use(errorHandler);
        await new Promise<void>((resolve, reject) => {
            server = app.listen(0, (error) => error ? reject(error) : resolve());
        });
        const address = server?.address();
        assert.ok(address && typeof address === 'object');
        endpoint = `http://127.0.0.1:${address.port}/pricing`;
    });

    beforeEach(() => {
        storedTable = undefined;
        writeCount = 0;
    });

    after(async () => {
        if (original.jwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = original.jwtSecret;
        prisma.user.findUnique = original.userFindUnique;
        prisma.pricingTable.create = original.tableCreate;
        prisma.pricingTable.findFirst = original.tableFindFirst;
        prisma.pricingTable.findUnique = original.tableFindUnique;
        prisma.pricingTable.update = original.tableUpdate;
        prisma.$transaction = original.transaction;
        const listeningServer = server;
        if (listeningServer) await new Promise<void>((resolve) => listeningServer.close(() => resolve()));
    });

    function requestPricing(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>) {
        return fetch(`${endpoint}${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    function requestTable(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
        return requestPricing(method === 'POST' ? '/tables' : `/tables/${tableId}`, method, body);
    }

    it('aceita o ID legado de rota e usa PERCENT por padrão', async () => {
        const response = await requestTable('POST', { ...newTable, icmsPercent: 12 });

        assert.equal(response.status, 201);
        assert.equal(storedTable?.routeId, 'route-sp-ma');
        assert.equal(storedTable?.icmsUnit, 'PERCENT');
        const { data } = await response.json() as { data: { routeId: string; icmsUnit: string } };
        assert.equal(data.routeId, 'route-sp-ma');
        assert.equal(data.icmsUnit, 'PERCENT');
    });

    it('persiste a unidade DIVISOR e o valor na coluna icmsPercent', async () => {
        const response = await requestTable('POST', { ...newTable, icmsUnit: 'DIVISOR', icmsPercent: 0.88 });

        assert.equal(response.status, 201);
        assert.equal(storedTable?.icmsUnit, 'DIVISOR');
        assert.equal(storedTable?.icmsPercent, 0.88);
        const { data } = await response.json() as { data: { icmsUnit: string; icmsPercent: number } };
        assert.equal(data.icmsUnit, 'DIVISOR');
        assert.equal(data.icmsPercent, 0.88);
    });

    it('rejeita divisores fora do intervalo aberto de 0 a 1 e valores ausentes', async () => {
        for (const icmsPercent of [-0.1, 0, 1, 1.1, null, undefined]) {
            const response = await requestTable('POST', { ...newTable, icmsUnit: 'DIVISOR', icmsPercent });

            assert.equal(response.status, 400, `Divisor ${icmsPercent}`);
            assert.deepEqual(await response.json(), invalidDivisor);
        }
        assert.equal(writeCount, 0);
    });

    it('rejeita valores negativos nas unidades PERCENT e FIXED', async () => {
        for (const icmsUnit of ['PERCENT', 'FIXED']) {
            const response = await requestTable('POST', { ...newTable, icmsUnit, icmsPercent: -1 });

            assert.equal(response.status, 400, `Unidade ${icmsUnit}`);
            assert.deepEqual(await response.json(), { success: false, error: 'O valor do ICMS não pode ser negativo.' });
        }
        assert.equal(writeCount, 0);
    });

    it('valida a alteração parcial de unidade usando o valor já salvo', async () => {
        storedTable = { id: tableId, icmsUnit: 'PERCENT', icmsPercent: 12 };

        const invalid = await requestTable('PATCH', { icmsUnit: 'DIVISOR' });
        assert.equal(invalid.status, 400);
        assert.deepEqual(await invalid.json(), invalidDivisor);
        assert.equal(writeCount, 0);

        const valid = await requestTable('PATCH', { icmsUnit: 'DIVISOR', icmsPercent: 0.88 });
        assert.equal(valid.status, 200);
        assert.deepEqual(await valid.json(), {
            success: true,
            data: { id: tableId, icmsUnit: 'DIVISOR', icmsPercent: 0.88 },
        });
    });

    it('valida a alteração parcial de valor usando a unidade já salva', async () => {
        storedTable = { id: tableId, icmsUnit: 'DIVISOR', icmsPercent: 0.88 };

        const invalid = await requestTable('PATCH', { icmsPercent: 1 });
        assert.equal(invalid.status, 400);
        assert.deepEqual(await invalid.json(), invalidDivisor);
        assert.equal(writeCount, 0);

        const valid = await requestTable('PATCH', { icmsPercent: 0.92 });
        assert.equal(valid.status, 200);
        assert.deepEqual(await valid.json(), {
            success: true,
            data: { id: tableId, icmsUnit: 'DIVISOR', icmsPercent: 0.92 },
        });
    });

    it('aplica o divisor do ICMS ao subtotal com todas as parcelas no calculador legado', async () => {
        storedTable = {
            id: tableId,
            freightUnit: 'RS_KG',
            freightValue: 8,
            tollUnit: 'FIXED',
            tollValue: 30,
            dispatchFee: 50,
            icmsIncluded: false,
            icmsUnit: 'DIVISOR',
            icmsPercent: 0.88,
        };

        const response = await requestPricing('/calculate', 'POST', { weight: 100, volume: 0.2, nfValue: 1000 });

        assert.equal(response.status, 200);
        const { data } = await response.json() as { data: { subtotal: number; icms: number; total: number } };
        assert.equal(data.subtotal, 880);
        assert.equal(data.icms, 120);
        assert.equal(data.total, 1000);
    });
});
