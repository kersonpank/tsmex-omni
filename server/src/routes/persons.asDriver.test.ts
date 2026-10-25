import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';

import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

describe('persons: busca por pessoa e as-driver', () => {
    const jwtSecret = `it-secret-persons-asdriver-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    const calls: { driverCreate: any[]; driverUpdate: any[]; carrierUpsert: any[]; personWhere: any[] } = {
        driverCreate: [], driverUpdate: [], carrierUpsert: [], personWhere: [],
    };
    let personRow: any = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        personFindUnique: prisma.person.findUnique,
        personFindMany: prisma.person.findMany,
        linkFindUnique: prisma.link.findUnique,
        driverCreate: prisma.driver.create,
        driverUpdate: prisma.driver.update,
        carrierUpsert: prisma.driverCarrier.upsert,
    };

    const req = async <T>(method: string, path: string, payload?: unknown): Promise<ApiResponse<T>> => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: payload === undefined ? undefined : JSON.stringify(payload),
        });
        return { status: response.status, body: await response.json() as T };
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        prisma.user.findUnique = ((async () => ({
            id: 'admin-1', email: 'a@tsmex.com', roles: ['ADMIN'], active: true, hubId: null, permissions: [], admin: null, client: null, link: null,
        })) as unknown) as typeof prisma.user.findUnique;
        prisma.person.findUnique = ((async () => personRow) as unknown) as typeof prisma.person.findUnique;
        prisma.person.findMany = ((async (args: any) => {
            calls.personWhere.push(args.where);
            return [personRow];
        }) as unknown) as typeof prisma.person.findMany;
        prisma.link.findUnique = ((async () => ({ id: 'link-1' })) as unknown) as typeof prisma.link.findUnique;
        prisma.driver.create = ((async (args: any) => {
            calls.driverCreate.push(args.data);
            return { id: 'drv-new', active: true, cnhNumber: null, cnhCategory: null, cnhExpiry: null, birthDate: null, ...args.data };
        }) as unknown) as typeof prisma.driver.create;
        prisma.driver.update = ((async (args: any) => {
            calls.driverUpdate.push(args);
            return { ...personRow.drivers[0], ...args.data };
        }) as unknown) as typeof prisma.driver.update;
        prisma.driverCarrier.upsert = ((async (args: any) => {
            calls.carrierUpsert.push(args);
            return {};
        }) as unknown) as typeof prisma.driverCarrier.upsert;

        const { personsRouter } = await import('./persons.js');
        const app = express();
        app.use(express.json());
        app.use('/api/persons', personsRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        prisma.user.findUnique = original.userFindUnique;
        prisma.person.findUnique = original.personFindUnique;
        prisma.person.findMany = original.personFindMany;
        prisma.link.findUnique = original.linkFindUnique;
        prisma.driver.create = original.driverCreate;
        prisma.driver.update = original.driverUpdate;
        prisma.driverCarrier.upsert = original.carrierUpsert;
    });

    it('search devolve roles e respeita documentType', async () => {
        personRow = {
            id: 'p1', documentType: 'CPF', document: '52998224725', legalName: 'JOAO',
            clients: [{ id: 'c1', companyName: 'JOAO' }], links: [], hubs: [],
            drivers: [{ id: 'd1', active: true }],
        };
        const res = await req<{ data: Array<{ roles: string[]; drivers: unknown[] }> }>('GET', '/api/persons/search?q=529982&documentType=CPF');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data[0].roles, ['motorista', 'cliente']);
        assert.equal(res.body.data[0].drivers.length, 1);
        assert.ok(JSON.stringify(calls.personWhere.at(-1)).includes('"documentType":"CPF"'));
    });

    it('as-driver cria motorista a partir da pessoa e vincula ao transportador', async () => {
        personRow = {
            id: 'p2', documentType: 'CPF', document: '52998224725', legalName: 'MARIA',
            drivers: [], contacts: [{ phone: '99988887777' }],
        };
        const res = await req<{ data: { created: boolean; missingForCiot: string[]; driver: { id: string } } }>(
            'POST', '/api/persons/p2/as-driver', { linkId: 'link-1' });
        assert.equal(res.status, 201);
        assert.equal(res.body.data.created, true);
        assert.equal(calls.driverCreate.at(-1).personId, 'p2');
        assert.equal(calls.driverCreate.at(-1).name, 'MARIA');
        assert.equal(calls.driverCreate.at(-1).phone, '99988887777');
        assert.equal(calls.carrierUpsert.at(-1).where.driverId_linkId.linkId, 'link-1');
        assert.ok(res.body.data.missingForCiot.includes('número da CNH'));
        assert.ok(res.body.data.missingForCiot.includes('data de nascimento'));
    });

    it('as-driver reaproveita e reativa motorista existente', async () => {
        personRow = {
            id: 'p3', documentType: 'CPF', document: '52998224725', legalName: 'JOSE', contacts: [],
            drivers: [{ id: 'd9', active: false, blockedReason: null, cnhNumber: '123', cnhCategory: 'E', cnhExpiry: new Date(), birthDate: new Date(), phone: '99' }],
        };
        const created = calls.driverCreate.length;
        const res = await req<{ data: { created: boolean; missingForCiot: string[] } }>('POST', '/api/persons/p3/as-driver', {});
        assert.equal(res.status, 200);
        assert.equal(res.body.data.created, false);
        assert.equal(calls.driverCreate.length, created);
        assert.equal(calls.driverUpdate.at(-1).data.active, true);
        assert.deepEqual(res.body.data.missingForCiot, []);
    });

    it('as-driver recusa CNPJ', async () => {
        personRow = { id: 'p4', documentType: 'CNPJ', document: '10256071000103', legalName: 'EMPRESA', drivers: [], contacts: [] };
        const res = await req('POST', '/api/persons/p4/as-driver', {});
        assert.equal(res.status, 400);
    });
});
