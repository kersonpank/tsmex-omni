import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';

import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = any> = { status: number; body: T };

async function httpGet<T = any>(baseUrl: string, path: string, token: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as T };
}

const ROUTES = ['trips', 'orders', 'finance', 'exceptions', 'autonomy'] as const;

describe('GET /api/reports/* — somente ADMIN, período validado, somente leitura', () => {
    const jwtSecret = `it-secret-reports-${Date.now()}`;
    let adminToken = '';
    let hubToken = '';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    const writes: string[] = [];
    const reads: string[] = [];
    const saved: Array<[any, string, any]> = [];

    const users: Record<string, any> = {
        'admin-1': { id: 'admin-1', email: 'a@x.com', roles: ['ADMIN'], active: true, hubId: null, permissions: [], admin: { id: 'adm-1' }, client: null, link: null },
        'hub-1': { id: 'hub-1', email: 'h@x.com', roles: ['HUB'], active: true, hubId: 'hub-1', permissions: [], admin: null, client: null, link: null },
    };

    const emptyList = async () => {
        reads.push('list');
        return [];
    };
    const zero = async () => 0;

    // [objeto do prisma, método, substituto]
    const stubs: Array<[any, string, any]> = [
        [prisma.user, 'findUnique', async (args: any) => users[args.where.id] ?? null],
        [prisma.manifest, 'count', zero],
        [prisma.manifest, 'findMany', emptyList],
        [prisma.order, 'count', zero],
        [prisma.order, 'findMany', emptyList],
        [prisma.invoice, 'findMany', emptyList],
        [prisma.invoiceReceipt, 'findMany', emptyList],
        [prisma.payablePayment, 'findMany', emptyList],
        [prisma.payable, 'findMany', emptyList],
        [prisma.systemAlert, 'count', zero],
        [prisma.systemAlert, 'findMany', emptyList],
        [prisma.consolidationFeedback, 'count', async () => 2],
        [
            prisma.consolidationFeedback,
            'findMany',
            async () => [
                { action: 'ACCEPTED', suggestedManifests: [{ source: 'next_hop_queue' }], utilizationBefore: 0, utilizationAfter: 0.5, marginBefore: null, marginAfter: 0.2 },
                { action: 'ACCEPTED', suggestedManifests: null, utilizationBefore: 0.1, utilizationAfter: 0.5, marginBefore: 0.1, marginAfter: 0.2 },
            ],
        ],
    ];

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        for (const [obj, method, fn] of stubs) {
            saved.push([obj, method, obj[method]]);
            obj[method] = fn;
        }
        // Qualquer escrita nos modelos lidos seria um erro: registra e falha o teste.
        for (const model of [prisma.manifest, prisma.order, prisma.invoice, prisma.systemAlert, prisma.consolidationFeedback] as any[]) {
            for (const w of ['create', 'update', 'delete', 'upsert', 'createMany', 'updateMany', 'deleteMany']) {
                saved.push([model, w, model[w]]);
                model[w] = async () => {
                    writes.push(w);
                    throw new Error('escrita proibida em relatório');
                };
            }
        }

        const { reportsRouter } = await import('./reports.js');
        const app = express();
        app.use(express.json());
        app.use('/api/reports', reportsRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;
        adminToken = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        hubToken = jwt.sign({ userId: 'hub-1' }, jwtSecret);
    });

    after(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        for (const [obj, method, prev] of saved.reverse()) obj[method] = prev;
    });

    for (const route of ROUTES) {
        it(`${route}: papel HUB recebe 403 e sem token recebe 401`, async () => {
            const hub = await httpGet(baseUrl, `/api/reports/${route}`, hubToken);
            assert.equal(hub.status, 403);
            const anon = await httpGet(baseUrl, `/api/reports/${route}`, 'invalido');
            assert.equal(anon.status, 401);
        });

        it(`${route}: período inválido ou acima de 366 dias recebe 400 com mensagem`, async () => {
            const bad = await httpGet(baseUrl, `/api/reports/${route}?from=ontem`, adminToken);
            assert.equal(bad.status, 400);
            assert.match(bad.body.error, /from/);
            const long = await httpGet(baseUrl, `/api/reports/${route}?from=2024-01-01&to=2026-01-01`, adminToken);
            assert.equal(long.status, 400);
            assert.match(long.body.error, /366/);
            const inverted = await httpGet(baseUrl, `/api/reports/${route}?from=2026-11-10&to=2026-11-01`, adminToken);
            assert.equal(inverted.status, 400);
        });

        it(`${route}: ADMIN recebe 200 com period {from,to} em ISO UTC`, async () => {
            const res = await httpGet(baseUrl, `/api/reports/${route}?from=2026-11-01&to=2026-11-30`, adminToken);
            assert.equal(res.status, 200);
            assert.equal(res.body.success, true);
            assert.equal(res.body.data.period.from, '2026-11-01T00:00:00.000Z');
            assert.equal(res.body.data.period.to, '2026-11-30T23:59:59.999Z');
        });
    }

    it('autonomy: conta só onde houve sugestão e informa o que ficou de fora', async () => {
        const res = await httpGet(baseUrl, '/api/reports/autonomy', adminToken);
        assert.equal(res.status, 200);
        assert.equal(res.body.data.overall.suggestions, 1);
        assert.equal(res.body.data.overall.acceptedPercent, 100);
        assert.equal(res.body.data.excluded[0].count, 1);
    });

    it('padrão de 30 dias quando não há from/to', async () => {
        const res = await httpGet(baseUrl, '/api/reports/exceptions', adminToken);
        const { from, to } = res.body.data.period;
        const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
        assert.equal(Math.round(days), 30);
    });

    it('nenhuma rota escreve no banco', () => {
        assert.deepEqual(writes, []);
    });
});
