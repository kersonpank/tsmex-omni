import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';
import { signSessionToken } from '../lib/sessionToken.js';

// Integração com Postgres real: revogação de sessão pela versão no JWT.
describe('sessões — troca/reset de senha e revogação derrubam tokens antigos', () => {
    const stamp = Date.now();
    const userEmail = `sess-user-${stamp}@t.io`;
    const adminEmail = `sess-admin-${stamp}@t.io`;
    let base = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let userId = '';
    let adminToken = '';

    const call = async (path: string, token: string | null, method = 'GET', body?: unknown) => {
        const r = await fetch(`${base}${path}`, {
            method,
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, json: await r.json().catch(() => ({})) as any };
    };
    const login = async (password: string) => (await call('/api/auth/login', null, 'POST', { email: userEmail, password })).json?.data?.token as string | undefined;

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'it-secret-sessions-0123456789abcdef0123';
        const user = await prisma.user.create({ data: { email: userEmail, password: await bcrypt.hash('SenhaInicial2026', 10), roles: ['HUB'] } });
        userId = user.id;
        const admin = await prisma.user.create({ data: { email: adminEmail, password: await bcrypt.hash('AdminSenha2026', 10), roles: ['ADMIN'] } });
        adminToken = signSessionToken(admin);
        const app = express();
        app.use(express.json());
        app.use('/api/auth', authRouter);
        app.use('/api/users', usersRouter);
        app.get('/api/me', authenticate, (_req, res) => res.json({ ok: true }));
        app.use(errorHandler);
        await new Promise<void>((r) => { server = app.listen(0, () => r()); });
        base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    });

    after(async () => {
        await prisma.user.deleteMany({ where: { email: { in: [userEmail, adminEmail] } } });
        await new Promise<void>((r) => server?.close(() => r()));
    });

    it('troca de senha: token antigo cai, o novo vale; senha fraca é recusada', async () => {
        const t1 = await login('SenhaInicial2026');
        assert.ok(t1);
        assert.equal((await call('/api/me', t1)).status, 200);

        const weak = await call('/api/auth/change-password', t1, 'POST', { currentPassword: 'SenhaInicial2026', newPassword: '123456' });
        assert.equal(weak.status, 400);
        const wrong = await call('/api/auth/change-password', t1, 'POST', { currentPassword: 'errada', newPassword: 'NovaSenha2026x' });
        assert.equal(wrong.status, 400);

        const ok = await call('/api/auth/change-password', t1, 'POST', { currentPassword: 'SenhaInicial2026', newPassword: 'NovaSenha2026x' });
        assert.equal(ok.status, 200);
        assert.equal((await call('/api/me', t1)).status, 401);
        assert.equal((await call('/api/me', ok.json.data.token)).status, 200);
        assert.ok(await login('NovaSenha2026x'));
    });

    it('sair de todos e revogação pelo ADMIN derrubam todas as sessões', async () => {
        const a = await login('NovaSenha2026x');
        const b = await login('NovaSenha2026x');
        assert.equal((await call('/api/auth/logout-all', a!, 'POST')).status, 200);
        assert.equal((await call('/api/me', a!)).status, 401);
        assert.equal((await call('/api/me', b!)).status, 401);

        const c = await login('NovaSenha2026x');
        assert.equal((await call(`/api/users/${userId}/revoke-sessions`, adminToken, 'POST')).status, 200);
        assert.equal((await call('/api/me', c!)).status, 401);
    });

    it('reset pelo ADMIN troca a senha; desativar derruba e bloqueia o login', async () => {
        const before = await login('NovaSenha2026x');
        const reset = await call(`/api/users/${userId}/reset-password`, adminToken, 'POST', { password: 'Provisoria2026' });
        assert.equal(reset.status, 200);
        assert.equal((await call('/api/me', before!)).status, 401);
        const after = await login('Provisoria2026');
        assert.ok(after);

        assert.equal((await call(`/api/users/${userId}/active`, adminToken, 'PATCH', { active: false })).status, 200);
        assert.equal((await call('/api/me', after!)).status, 401);
        assert.equal(await login('Provisoria2026'), undefined);
        assert.equal((await call(`/api/users/${userId}/active`, adminToken, 'PATCH', { active: true })).status, 200);
        assert.ok(await login('Provisoria2026'));
    });

    it('token antigo sem versão (emitido antes) vale só enquanto nunca houve revogação', async () => {
        const jwt = (await import('jsonwebtoken')).default;
        const legacy = jwt.sign({ userId }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1h' });
        assert.equal((await call('/api/me', legacy)).status, 401); // este usuário já teve revogações
        const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
        const legacyAdmin = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1h' });
        assert.equal((await call('/api/me', legacyAdmin)).status, 200);
    });

    it('ADMIN não reseta nem desativa a si mesmo por aqui', async () => {
        const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
        assert.equal((await call(`/api/users/${admin.id}/active`, adminToken, 'PATCH', { active: false })).status, 400);
    });
});
