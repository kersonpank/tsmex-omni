import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from './errorHandler.js';
import { resourceGuard, uuidParam } from './resourceAccess.js';

const ID = 'b0000000-0000-4000-8000-000000000002';

describe('resourceGuard (anti-IDOR)', () => {
    const secret = `it-secret-guard-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let currentUser: Record<string, unknown> = {};
    let lastWhere: unknown = null;
    let found: Record<string, boolean> = {};

    const original = {
        userFindUnique: prisma.user.findUnique,
        orderFindFirst: prisma.order.findFirst,
        manifestFindFirst: prisma.manifest.findFirst,
        opportunityFindFirst: prisma.opportunity.findFirst,
        invoiceFindFirst: prisma.invoice.findFirst,
    };

    const token = () => jwt.sign({ userId: 'u1' }, secret);
    const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token()}` } });
    const user = (roles: string[], extra: Record<string, unknown> = {}) => {
        currentUser = { id: 'u1', email: 'u@x.com', roles, active: true, hubId: null, permissions: [], accountId: null, ...extra };
    };

    before(async () => {
        process.env.JWT_SECRET = secret;
        prisma.user.findUnique = (async () => currentUser) as never;
        const finder = (key: string) => (async (args: { where: unknown }) => {
            lastWhere = args.where;
            return found[key] ? { id: ID } : null;
        }) as never;
        prisma.order.findFirst = finder('order');
        prisma.manifest.findFirst = finder('manifest');
        prisma.opportunity.findFirst = finder('opportunity');
        prisma.invoice.findFirst = finder('invoice');

        const app = express();
        for (const kind of ['order', 'manifest', 'opportunity', 'invoice'] as const) {
            const router = express.Router();
            router.use(uuidParam(), ...resourceGuard(kind));
            router.get('/resolve', (_req, res) => { res.json({ ok: 'literal' }); });
            router.get('/:id', (_req, res) => { res.json({ ok: 'id' }); });
            app.use(`/${kind}`, router);
        }
        app.use(errorHandler);
        await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
        const address = server!.address();
        baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    });

    after(async () => {
        Object.assign(prisma.user, { findUnique: original.userFindUnique });
        Object.assign(prisma.order, { findFirst: original.orderFindFirst });
        Object.assign(prisma.manifest, { findFirst: original.manifestFindFirst });
        Object.assign(prisma.opportunity, { findFirst: original.opportunityFindFirst });
        Object.assign(prisma.invoice, { findFirst: original.invoiceFindFirst });
        await new Promise<void>((resolve) => server?.close(() => resolve()));
    });

    beforeEach(() => {
        lastWhere = null;
        found = {};
    });

    it('ADMIN passa sem consultar o banco', async () => {
        user(['ADMIN']);
        const res = await get(`/order/${ID}`);
        assert.equal(res.status, 200);
        assert.equal(lastWhere, null);
    });

    it('rota literal (não-UUID) não é capturada como :id', async () => {
        user(['CLIENT'], { accountId: 'acc-1' });
        const res = await get('/order/resolve');
        assert.equal(res.status, 200);
        assert.equal(lastWhere, null);
    });

    it('sem token → 401', async () => {
        const res = await fetch(`${baseUrl}/order/${ID}`);
        assert.equal(res.status, 401);
    });

    it('HUB: pedido fora do escopo do depósito → 404; dentro → 200', async () => {
        user(['HUB'], { hubId: 'hub-A' });
        assert.equal((await get(`/order/${ID}`)).status, 404);
        assert.match(JSON.stringify(lastWhere), /hub-A/);
        found.order = true;
        assert.equal((await get(`/order/${ID}`)).status, 200);
    });

    it('HUB sem hubId vinculado → 403', async () => {
        user(['HUB']);
        assert.equal((await get(`/order/${ID}`)).status, 403);
    });

    it('CLIENT: pedido de outra conta → 404 (escopo pela conta do usuário)', async () => {
        user(['CLIENT'], { accountId: 'acc-1' });
        assert.equal((await get(`/order/${ID}`)).status, 404);
        assert.match(JSON.stringify(lastWhere), /acc-1/);
    });

    it('LINK: só as próprias viagens', async () => {
        user(['LINK']);
        assert.equal((await get(`/manifest/${ID}`)).status, 404);
        assert.match(JSON.stringify(lastWhere), /"userId":"u1"/);
        found.manifest = true;
        assert.equal((await get(`/manifest/${ID}`)).status, 200);
    });

    it('CLIENT (sem HUB/LINK) não acessa viagem → 403', async () => {
        user(['CLIENT'], { accountId: 'acc-1' });
        assert.equal((await get(`/manifest/${ID}`)).status, 403);
    });

    it('oportunidade: CLIENT só da própria conta; HUB → 403', async () => {
        user(['CLIENT'], { accountId: 'acc-1' });
        assert.equal((await get(`/opportunity/${ID}`)).status, 404);
        assert.match(JSON.stringify(lastWhere), /acc-1/);
        found.opportunity = true;
        assert.equal((await get(`/opportunity/${ID}`)).status, 200);
        user(['HUB'], { hubId: 'hub-A' });
        assert.equal((await get(`/opportunity/${ID}`)).status, 403);
    });

    it('fatura: CLIENT só da própria conta; LINK → 403', async () => {
        user(['CLIENT'], { accountId: 'acc-1' });
        assert.equal((await get(`/invoice/${ID}`)).status, 404);
        user(['LINK']);
        assert.equal((await get(`/invoice/${ID}`)).status, 403);
    });
});
