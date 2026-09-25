import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { signHubInvite } from '../services/hubInvite.js';
import { hubsRouter } from './hubs.js';

const HUB = 'c0000000-0000-4000-8000-000000000001';

describe('hubs — cadastro público só com convite assinado', () => {
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    const created: unknown[] = [];
    const original = {
        hubFindUnique: prisma.hub.findUnique,
        personFindUnique: prisma.person.findUnique,
        personCreate: prisma.person.create,
        userFindUnique: prisma.user.findUnique,
        userCreate: prisma.user.create,
    };

    before(async () => {
        process.env.JWT_SECRET = 'it-secret-hub-invite';
        prisma.hub.findUnique = (async () => ({ id: HUB, name: 'Hub A', code: 'HA', active: true })) as never;
        prisma.person.findUnique = (async () => null) as never;
        prisma.person.create = (async () => ({ id: 'p1' })) as never;
        prisma.user.findUnique = (async () => null) as never;
        prisma.user.create = (async (args: { data: { permissions: string[] } }) => { created.push(args); return { id: 'u1', email: 'o@x.com', hubId: HUB }; }) as never;

        const app = express();
        app.use(express.json());
        app.use('/hubs', hubsRouter);
        app.use(errorHandler);
        await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
        const address = server!.address();
        baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    });

    after(async () => {
        Object.assign(prisma.hub, { findUnique: original.hubFindUnique });
        Object.assign(prisma.person, { findUnique: original.personFindUnique, create: original.personCreate });
        Object.assign(prisma.user, { findUnique: original.userFindUnique, create: original.userCreate });
        await new Promise<void>((resolve) => server?.close(() => resolve()));
    });

    const body = { document: '12345678909', legalName: 'Operador', email: 'o@x.com', password: 'secreta1' };
    const register = (extra: object) =>
        fetch(`${baseUrl}/hubs/${HUB}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }) });

    it('register sem convite → 403', async () => {
        assert.equal((await register({})).status, 403);
    });

    it('register com convite de outro hub → 403', async () => {
        assert.equal((await register({ inviteToken: signHubInvite('outro-hub') })).status, 403);
    });

    it('cadastro-info sem convite → 403; com convite → 200', async () => {
        assert.equal((await fetch(`${baseUrl}/hubs/${HUB}/cadastro-info`)).status, 403);
        const ok = await fetch(`${baseUrl}/hubs/${HUB}/cadastro-info?token=${signHubInvite(HUB)}`);
        assert.equal(ok.status, 200);
    });

    it('register com convite válido cria operador SEM permissões (mesmo se o corpo tentar enviá-las)', async () => {
        const res = await register({ inviteToken: signHubInvite(HUB), permissions: ['entrada', 'admin'] });
        assert.equal(res.status, 201);
        assert.deepEqual((created[0] as { data: { permissions: string[] } }).data.permissions, []);
    });

    it('POST /hubs/:id/invites exige autenticação', async () => {
        const res = await fetch(`${baseUrl}/hubs/${HUB}/invites`, { method: 'POST' });
        assert.equal(res.status, 401);
    });
});
