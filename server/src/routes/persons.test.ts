import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';

import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpPostJson<T>(baseUrl: string, path: string, token: string, payload: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    return {
        status: response.status,
        body: await response.json() as T,
    };
}

describe('POST /persons — RBAC ADMIN e HUB', () => {
    const jwtSecret = `it-secret-persons-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        personFindUnique: prisma.person.findUnique,
        personCreate: prisma.person.create,
    };

    const users: Record<string, { id: string; roles: string[] }> = {
        'hub-user-1': { id: 'hub-user-1', roles: ['HUB'] },
        'client-user-1': { id: 'client-user-1', roles: ['CLIENT'] },
    };

    const payload = {
        documentType: 'CNPJ',
        document: '10256071000103',
        legalName: 'F C C ABREU LTDA',
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = ((async (args: any) => {
            const u = users[args?.where?.id];
            if (!u) return null;
            return {
                id: u.id,
                email: `${u.id}@tsmex.com`,
                roles: u.roles,
                active: true,
                hubId: u.roles.includes('HUB') ? 'hub-1' : null,
                permissions: [],
                admin: null,
                client: null,
                link: null,
            };
        }) as unknown) as typeof prisma.user.findUnique;

        prisma.person.findUnique = ((async () => null) as unknown) as typeof prisma.person.findUnique;

        prisma.person.create = ((async (args: any) => ({
            id: 'person-1',
            ...args.data,
        })) as unknown) as typeof prisma.person.create;

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
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.person.findUnique = original.personFindUnique;
        prisma.person.create = original.personCreate;
    });

    it('usuário HUB consegue criar pessoa (201)', async () => {
        const token = jwt.sign({ userId: 'hub-user-1' }, jwtSecret);
        const res = await httpPostJson<{ success: boolean; data: { id: string } }>(
            baseUrl,
            '/api/persons',
            token,
            payload,
        );
        assert.equal(res.status, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.id, 'person-1');
    });

    it('usuário CLIENT continua bloqueado (403)', async () => {
        const token = jwt.sign({ userId: 'client-user-1' }, jwtSecret);
        const res = await httpPostJson<{ success: boolean }>(
            baseUrl,
            '/api/persons',
            token,
            payload,
        );
        assert.equal(res.status, 403);
    });
});
