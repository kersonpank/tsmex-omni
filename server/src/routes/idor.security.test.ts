/** Anti-IDOR: demandas, transportadores, NF-e, chat, oportunidades e visão externa do pedido. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type Row = Record<string, any>;

const OPP_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

const users: Record<string, Row> = {
    admin: { roles: ['ADMIN'], hubId: null, accountId: null },
    hubA: { roles: ['HUB'], hubId: 'hub-a', accountId: null },
    hubB: { roles: ['HUB'], hubId: 'hub-b', accountId: null },
    linkU: { roles: ['LINK'], hubId: null, accountId: null },
    clientA: { roles: ['CLIENT'], hubId: null, accountId: 'acc-a' },
    clientB: { roles: ['CLIENT'], hubId: null, accountId: 'acc-b' },
};

const demand: Row = {
    id: 'dem-1',
    clientId: 'cli-a',
    expectedHubId: 'hub-a',
    client: { accountId: 'acc-a', userId: 'clientA' },
    order: { currentHubId: null, demand: { expectedHubId: 'hub-a' }, legs: [] },
    events: [],
};

/** Avaliador mínimo dos filtros Prisma usados nos escopos. */
function matches(row: Row | undefined | null, where: Row): boolean {
    if (!row) return false;
    return Object.entries(where).every(([k, v]) => {
        if (k === 'AND') return (v as Row[]).every((w) => matches(row, w));
        if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
        if (v && typeof v === 'object' && 'some' in (v as Row)) {
            return (row[k] ?? []).some((x: Row) => matches(x, (v as Row).some));
        }
        if (v && typeof v === 'object') return matches(row[k], v as Row);
        return row[k] === v;
    });
}

describe('IDOR e exposição de dados', () => {
    const jwtSecret = `it-secret-idor-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let oppUpdates: Row[] = [];
    const restore: Array<() => void> = [];

    const call = async (path: string, user: string, method = 'GET', body?: unknown) => {
        const r = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { authorization: `Bearer ${jwt.sign({ userId: user }, jwtSecret)}`, 'content-type': 'application/json' },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, text: await r.text() };
    };

    const patch = (target: any, key: string, impl: any) => {
        const fn = target[key];
        restore.push(() => { target[key] = fn; });
        target[key] = impl;
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        patch(prisma.user, 'findUnique', async (args: any) => {
            const u = users[args?.where?.id];
            if (!u) return null;
            return { id: args.where.id, email: 'x@t.io', roles: u.roles, active: true, hubId: u.hubId, accountId: u.accountId, permissions: [], admin: null, client: null, link: null };
        });
        patch(prisma.demand, 'findFirst', async (args: any) => (matches(demand, args.where) ? { id: demand.id } : null));
        patch(prisma.demand, 'findUnique', async () => demand);
        patch(prisma.demandEvent, 'findMany', async () => [{ id: 'ev1' }]);
        patch(prisma.link, 'findUnique', async () => ({ id: 'link-1', name: 'Transportador', document: '123' }));
        patch(prisma.link, 'findFirst', async () => null);
        patch(prisma.nfeDistribuicaoDocumento, 'findUnique', async () => null);
        patch(prisma.chatSession, 'findFirst', async () => ({ id: 's1', slug: 'abc', accountId: 'acc-a', createdAt: new Date(), messages: [{ id: 'm1' }] }));
        patch(prisma.opportunity, 'findFirst', async (args: any) => (
            args.where.id === OPP_ID && (!args.where.accountId || args.where.accountId === 'acc-a') ? { id: OPP_ID } : null
        ));
        patch(prisma.opportunity, 'update', async (args: any) => { oppUpdates.push(args); return { id: args.where.id }; });
        patch(prisma.order, 'findFirst', async (args: any) => (args.where.id === ORDER_ID ? { id: ORDER_ID } : null));
        patch(prisma.order, 'findUnique', async () => ({
            id: ORDER_ID,
            status: 'IN_TRANSIT',
            demand: { client: { accountId: 'acc-a' }, events: [] },
            history: [],
            invoices: [],
            invoicesRel: [],
            attachments: [],
            manifest: { id: 'm1', status: 'IN_PROGRESS', totalValue: 900, link: { name: 'SEGREDO-TRANSP' } },
            legs: [{ id: 'l1', manifest: { id: 'm1', link: { name: 'SEGREDO-TRANSP' } } }],
            freightCalculations: [{ id: 'c1', freightTotal: 100, cteXml: '<SEGREDO-XML/>' }],
        }));

        const { demandsRouter } = await import('./demands.js');
        const { linksRouter } = await import('./links.js');
        const { nfeRouter } = await import('./nfe.js');
        const { chatRouter } = await import('./chat.js');
        const { opportunitiesRouter } = await import('./opportunities.js');
        const { ordersRouter } = await import('./orders.js');
        const app = express();
        app.use(express.json());
        app.use('/api/demands', demandsRouter);
        app.use('/api/links', linksRouter);
        app.use('/api/nfe', nfeRouter);
        app.use('/api/chat', chatRouter);
        app.use('/api/opportunities', opportunitiesRouter);
        app.use('/api/orders', ordersRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((r) => server!.once('listening', () => r()));
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    after(async () => {
        if (server) await new Promise<void>((r, j) => server!.close((e) => (e ? j(e) : r())));
        restore.forEach((fn) => fn());
    });

    it('GET /demands/:id e /events: ADMIN, HUB do hub e CLIENT da conta passam; demais 404', async () => {
        for (const path of ['/api/demands/dem-1', '/api/demands/dem-1/events']) {
            for (const u of ['admin', 'hubA', 'clientA']) assert.equal((await call(path, u)).status, 200, `${u} ${path}`);
            for (const u of ['hubB', 'clientB', 'linkU']) assert.equal((await call(path, u)).status, 404, `${u} ${path}`);
        }
    });

    it('GET /links/:id nega CLIENT; ADMIN/HUB passam', async () => {
        assert.equal((await call('/api/links/link-1', 'clientA')).status, 404);
        assert.equal((await call('/api/links/link-1', 'admin')).status, 200);
        assert.equal((await call('/api/links/link-1', 'hubA')).status, 200);
    });

    it('GET /nfe/:chave só ADMIN/HUB', async () => {
        const chave = '3'.repeat(44);
        for (const u of ['clientA', 'linkU']) assert.equal((await call(`/api/nfe/${chave}`, u)).status, 403);
        assert.notEqual((await call(`/api/nfe/${chave}`, 'hubA')).status, 403);
    });

    it('GET /chat/session/:id/messages: dono da conta ou ADMIN', async () => {
        const p = '/api/chat/session/abc/messages';
        assert.equal((await call(p, 'clientA')).status, 200);
        assert.equal((await call(p, 'admin')).status, 200);
        for (const u of ['clientB', 'hubA', 'linkU']) assert.equal((await call(p, u)).status, 404, u);
    });

    it('PATCH /opportunities/:id: CLIENT só da própria conta', async () => {
        oppUpdates = [];
        assert.equal((await call(`/api/opportunities/${OPP_ID}`, 'clientB', 'PATCH', { origin: 'X' })).status, 404);
        assert.equal(oppUpdates.length, 0);
        assert.equal((await call(`/api/opportunities/${OPP_ID}`, 'clientA', 'PATCH', { origin: 'X' })).status, 200);
        assert.equal(oppUpdates.length, 1);
    });

    it('tool request_collection do chat só altera oportunidade da própria conta', async () => {
        const { handleToolCalls } = await import('./chat.js');
        oppUpdates = [];
        await handleToolCalls([{ name: 'request_collection', args: { opportunityId: OPP_ID } }], 'acc-b', [], 's');
        assert.equal(oppUpdates.length, 0);
        await handleToolCalls([{ name: 'request_collection', args: { opportunityId: OPP_ID } }], 'acc-a', [], 's');
        assert.equal(oppUpdates.length, 1);
    });

    it('GET /orders/:id para CLIENT omite XML e dados do transportador; ADMIN vê tudo', async () => {
        const client = await call(`/api/orders/${ORDER_ID}`, 'clientA');
        assert.equal(client.status, 200);
        assert.ok(!client.text.includes('SEGREDO'), client.text);
        assert.ok(client.text.includes('"freightTotal":100'));
        const admin = await call(`/api/orders/${ORDER_ID}`, 'admin');
        assert.ok(admin.text.includes('SEGREDO-XML') && admin.text.includes('SEGREDO-TRANSP'));
    });
});
