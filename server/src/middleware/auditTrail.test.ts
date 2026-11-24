import assert from 'node:assert/strict';
import test from 'node:test';
import express, { Router } from 'express';
import { auditTrail, type AuditEntry } from './auditTrail.js';

test('grava escrita autenticada com rota-padrão e id; ignora GET e escrita anônima fora de /auth', async () => {
    const entries: AuditEntry[] = [];
    const app = express();
    app.use(express.json());
    app.use(auditTrail(async (e) => { entries.push(e); }));
    const fakeAuth = (req: any, _res: any, next: any) => { req.user = { id: 'u-9', roles: ['HUB'] }; next(); };
    const manifests = Router();
    manifests.patch('/:id/complete', fakeAuth, (_req, res) => res.json({ ok: true }));
    manifests.get('/:id', fakeAuth, (_req, res) => res.json({ ok: true }));
    app.get('/api/fiscal-emitters/:id/certificate-download', fakeAuth, (_req, res) => res.json({ ok: true }));
    app.use('/api/manifests', manifests);
    app.post('/api/accounts/onboarding', (_req, res) => res.status(201).json({ ok: true }));
    app.post('/api/auth/login', (_req, res) => res.status(401).json({ ok: false }));
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
        await fetch(`${base}/api/manifests/m-1/complete?x=1`, { method: 'PATCH' });
        await fetch(`${base}/api/manifests/m-1`);
        await fetch(`${base}/api/fiscal-emitters/e-1/certificate-download`);
        await fetch(`${base}/api/accounts/onboarding`, { method: 'POST' });
        await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ' Fulano@T.io ', password: 'nao-vai-pro-log' }) });
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(entries.length, 3);
        const cert = entries.find((e) => e.path.endsWith('/certificate-download'));
        assert.equal(cert?.entityId, 'e-1');
        entries.splice(entries.indexOf(cert!), 1);
        assert.deepEqual(
            { route: entries[0].route, path: entries[0].path, entityId: entries[0].entityId, actor: entries[0].actorUserId, status: entries[0].status },
            { route: '/api/manifests/:id/complete', path: '/api/manifests/m-1/complete', entityId: 'm-1', actor: 'u-9', status: 200 },
        );
        assert.equal(entries[1].subject, 'fulano@t.io');
        assert.equal(entries[1].status, 401);
        assert.ok(!JSON.stringify(entries).includes('nao-vai-pro-log'));
    } finally {
        server.close();
    }
});

test('falha ao gravar não derruba a resposta', async () => {
    const app = express();
    app.use(auditTrail(async () => { throw new Error('db down'); }));
    app.post('/api/auth/logout-all', (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    try {
        const r = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/auth/logout-all`, { method: 'POST' });
        assert.equal(r.status, 200);
    } finally {
        server.close();
    }
});
