import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { authRouter } from './auth.js';

describe('POST /auth/register — cadastro público sem escalada de privilégio', () => {
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let existing: Record<string, unknown> | null = null;
    const updates: unknown[] = [];

    const original = {
        userFindUnique: prisma.user.findUnique,
        linkFindFirst: prisma.link.findFirst,
        transaction: prisma.$transaction,
    };

    const post = (path: string, body: object) =>
        fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    before(async () => {
        process.env.JWT_SECRET = 'it-secret-register';
        prisma.user.findUnique = (async () => existing) as never;
        prisma.link.findFirst = (async () => null) as never;
        prisma.$transaction = (async (fn: (tx: unknown) => unknown) => fn({
            user: { update: async (args: unknown) => { updates.push(args); } },
            person: { findUnique: async () => null, create: async () => ({ id: 'p1' }) },
            link: { create: async () => ({ id: 'l1' }) },
        })) as never;

        const app = express();
        app.use(express.json());
        app.use('/auth', authRouter);
        app.use(errorHandler);
        await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
        const address = server!.address();
        baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    });

    after(async () => {
        Object.assign(prisma.user, { findUnique: original.userFindUnique });
        Object.assign(prisma.link, { findFirst: original.linkFindFirst });
        prisma.$transaction = original.transaction;
        await new Promise<void>((resolve) => server?.close(() => resolve()));
    });

    it('role ADMIN no cadastro público → 403', async () => {
        existing = null;
        const res = await post('/auth/register', { email: 'a@x.com', password: '123456', role: 'ADMIN' });
        assert.equal(res.status, 403);
    });

    it('/provision exige autenticação', async () => {
        const res = await post('/auth/provision', { email: 'a@x.com', password: '123456', role: 'ADMIN' });
        assert.equal(res.status, 401);
    });

    it('conta existente + senha errada → 401 e nenhum papel é concedido', async () => {
        updates.length = 0;
        existing = { id: 'u9', email: 'e@x.com', password: await bcrypt.hash('certa123', 4), roles: ['CLIENT'], link: null };
        const res = await post('/auth/register', { email: 'e@x.com', password: 'errada123', role: 'LINK', whatsappPhone: '11999999999' });
        assert.equal(res.status, 401);
        assert.equal(updates.length, 0);
    });

    it('conta existente + senha correta → adiciona LINK (multi-conta preservado)', async () => {
        updates.length = 0;
        existing = { id: 'u9', email: 'e@x.com', password: await bcrypt.hash('certa123', 4), roles: ['CLIENT'], link: null };
        const res = await post('/auth/register', { email: 'e@x.com', password: 'certa123', role: 'LINK', whatsappPhone: '11999999999' });
        assert.equal(res.status, 201);
        assert.deepEqual((updates[0] as { data: { roles: string[] } }).data.roles, ['CLIENT', 'LINK']);
    });
});
