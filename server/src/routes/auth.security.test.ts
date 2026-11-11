import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { authRouter } from './auth.js';

describe('auth — login uniforme e JWT HS256', () => {
    const secret = 'it-secret-auth-security-0123456789abcdef';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let current: Record<string, unknown> | null = null;
    let compareCalls = 0;
    const original = { findUnique: prisma.user.findUnique, compare: bcrypt.compare };

    const login = async (email: string, password: string) => {
        const r = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
        return { status: r.status, text: await r.text() };
    };

    before(async () => {
        process.env.JWT_SECRET = secret;
        prisma.user.findUnique = (async (args: any) => (args?.where?.email || args?.where?.id ? current : null)) as never;
        (bcrypt as any).compare = async (...a: any[]) => { compareCalls++; return (original.compare as any)(...a); };
        const app = express();
        app.use(express.json());
        app.use('/auth', authRouter);
        app.use(errorHandler);
        await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
        baseUrl = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    });

    after(async () => {
        Object.assign(prisma.user, { findUnique: original.findUnique });
        (bcrypt as any).compare = original.compare;
        await new Promise<void>((resolve) => server?.close(() => resolve()));
    });

    it('inexistente, inativo e senha errada: mesma resposta e sempre roda bcrypt', async () => {
        const hash = await bcrypt.hash('senha-certa', 10);
        const results: Array<{ status: number; text: string }> = [];

        current = null;
        compareCalls = 0;
        results.push(await login('x@t.io', 'qualquer'));
        assert.equal(compareCalls, 1);

        current = { id: 'u1', email: 'x@t.io', password: hash, active: false, roles: ['ADMIN'] };
        compareCalls = 0;
        results.push(await login('x@t.io', 'senha-certa'));
        assert.equal(compareCalls, 1);

        current = { id: 'u1', email: 'x@t.io', password: hash, active: true, roles: ['ADMIN'] };
        compareCalls = 0;
        results.push(await login('x@t.io', 'errada'));
        assert.equal(compareCalls, 1);

        assert.equal(results[0].status, 401);
        assert.equal(results[1].text, results[0].text);
        assert.equal(results[2].text, results[0].text);
        assert.equal(results[1].status, 401);
        assert.equal(results[2].status, 401);
    });

    it('JWT assinado com outro algoritmo é recusado; HS256 passa na autenticação', async () => {
        current = { id: 'u1', email: 'x@t.io', password: 'h', active: true, roles: ['ADMIN'], hubId: null, permissions: [], admin: null, client: null, link: null };
        const get = (token: string) => fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
        const hs512 = jwt.sign({ userId: 'u1' }, secret, { algorithm: 'HS512' });
        assert.equal((await get(hs512)).status, 401);
        const hs256 = jwt.sign({ userId: 'u1' }, secret, { algorithm: 'HS256' });
        assert.notEqual((await get(hs256)).status, 401);
    });
});
