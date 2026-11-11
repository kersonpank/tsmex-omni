import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

describe('freightCalculationCancel routes', () => {
    const secret = `it-secret-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    const original = {
        userFindUnique: prisma.user.findUnique,
        orderFindUnique: prisma.order.findUnique,
        calcFindFirst: prisma.orderFreightCalculation.findFirst,
        jobFindFirst: prisma.cteEmissionJob.findFirst,
        invoiceFindFirst: prisma.invoice.findFirst,
        itemFindFirst: prisma.invoiceItem.findFirst,
        legFindMany: prisma.orderLeg.findMany,
    };

    before(async () => {
        process.env.JWT_SECRET = secret;
        const { freightCalculationCancelRouter } = await import('./freightCalculationCancel.js');
        prisma.user.findUnique = ((async (args: any) => ({
            id: args.where.id, email: 'x@x.com', active: true, permissions: [], admin: null, client: null, link: null,
            roles: args.where.id === 'admin' ? ['ADMIN'] : ['HUB'],
            hubId: args.where.id === 'hub-dono' ? 'hub-1' : 'hub-outro',
        })) as unknown) as typeof prisma.user.findUnique;
        prisma.order.findUnique = ((async () => ({ id: 'o1', currentHubId: 'hub-1' })) as unknown) as typeof prisma.order.findUnique;
        prisma.orderFreightCalculation.findFirst = ((async () => ({
            id: 'c1', orderId: 'o1', documentType: 'CTE', status: 'CTE_AUTHORIZED', cteAccessKey: '5'.repeat(44), cteNumber: '9',
            cteAuthorizedAt: new Date(), cteEnvironment: 'homologacao', fiscalEmitter: null,
        })) as unknown) as typeof prisma.orderFreightCalculation.findFirst;
        prisma.cteEmissionJob.findFirst = ((async () => ({ providerDocId: 'prov-1' })) as unknown) as typeof prisma.cteEmissionJob.findFirst;
        prisma.invoice.findFirst = ((async () => null) as unknown) as typeof prisma.invoice.findFirst;
        prisma.invoiceItem.findFirst = ((async () => null) as unknown) as typeof prisma.invoiceItem.findFirst;
        prisma.orderLeg.findMany = ((async () => [{ manifestId: 'm1', startedAt: new Date(), completedAt: null, manifest: { status: 'IN_PROGRESS' } }]) as unknown) as typeof prisma.orderLeg.findMany;

        const app = express();
        app.use(express.json());
        app.use('/api/orders/:orderId/freight-calculations', freightCalculationCancelRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        baseUrl = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    });

    after(async () => {
        prisma.user.findUnique = original.userFindUnique;
        prisma.order.findUnique = original.orderFindUnique;
        prisma.orderFreightCalculation.findFirst = original.calcFindFirst;
        prisma.cteEmissionJob.findFirst = original.jobFindFirst;
        prisma.invoice.findFirst = original.invoiceFindFirst;
        prisma.invoiceItem.findFirst = original.itemFindFirst;
        prisma.orderLeg.findMany = original.legFindMany;
        await new Promise<void>((resolve) => server?.close(() => resolve()));
    });

    const call = async (user: string, method: string, path: string, body?: unknown) => {
        const res = await fetch(`${baseUrl}/api/orders/o1/freight-calculations${path}`, {
            method,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId: user }, secret)}` },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: res.status, body: (await res.json()) as any };
    };

    it('HUB de outro hub não cancela nem consulta (403)', async () => {
        assert.equal((await call('hub-outro', 'POST', '/c1/cancel-cte', { reason: 'Motivo bem explicado aqui' })).status, 403);
        assert.equal((await call('hub-outro', 'GET', '/c1/cancel-cte')).status, 403);
        assert.equal((await call('hub-outro', 'POST', '/c1/cce', { correcoes: [] })).status, 403);
    });

    it('justificativa curta é recusada (400) antes de qualquer chamada ao provedor', async () => {
        const r = await call('hub-dono', 'POST', '/c1/cancel-cte', { reason: 'curto' });
        assert.equal(r.status, 400);
        assert.match(JSON.stringify(r.body), /15 a 255/);
    });

    it('GET mostra por que está bloqueado (carga já em viagem) e o prazo', async () => {
        const r = await call('admin', 'GET', '/c1/cancel-cte');
        assert.equal(r.status, 200);
        assert.equal(r.body.data.canCancel, false);
        assert.match(r.body.data.blockReason, /saiu em viagem/);
        assert.ok(r.body.data.deadline);
    });

    it('POST com carga em viagem devolve 409 e não chama o provedor', async () => {
        const r = await call('hub-dono', 'POST', '/c1/cancel-cte', { reason: 'Tomador informado errado' });
        assert.equal(r.status, 409);
    });
});
