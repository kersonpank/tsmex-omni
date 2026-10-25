import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';

import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

describe('GET /persons/lookup-document/:document', () => {
    const jwtSecret = `it-secret-persons-lookup-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let personRow: any = null;
    const original = { userFindUnique: prisma.user.findUnique, personFindUnique: prisma.person.findUnique };

    const get = async (path: string): Promise<ApiResponse<any>> => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
        return { status: response.status, body: await response.json() };
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        prisma.user.findUnique = ((async () => ({
            id: 'admin-1', email: 'a@tsmex.com', roles: ['ADMIN'], active: true, hubId: null, permissions: [], admin: null, client: null, link: null,
        })) as unknown) as typeof prisma.user.findUnique;
        prisma.person.findUnique = ((async () => personRow) as unknown) as typeof prisma.person.findUnique;

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
    });

    it('rejeita documento com tamanho inválido', async () => {
        personRow = null;
        const res = await get('/api/persons/lookup-document/123');
        assert.equal(res.status, 400);
    });

    it('devolve a pessoa cadastrada, com papéis, sem consulta externa', async () => {
        personRow = {
            id: 'p1', document: '52998224725', documentType: 'CPF', legalName: 'Fulano',
            clients: [], links: [{ id: 'l1', name: 'Fulano' }], drivers: [{ id: 'd1' }], hubs: [],
        };
        const res = await get('/api/persons/lookup-document/529.982.247-25');
        assert.equal(res.status, 200);
        assert.equal(res.body.data.source, 'person');
        assert.equal(res.body.data.person.id, 'p1');
        assert.deepEqual(res.body.data.person.roles, ['motorista', 'transportador']);
        assert.equal(res.body.data.suggestion, null);
    });

    it('CPF não cadastrado → none, sem criar nada', async () => {
        personRow = null;
        const res = await get('/api/persons/lookup-document/52998224725');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data, { source: 'none', person: null, suggestion: null });
    });
});
