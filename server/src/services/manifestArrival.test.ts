import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { arrivalHistoryText, orderIdsDescendingAt, registerManifestArrival } from './manifestArrival.js';

const leg = (over: Record<string, unknown>) => ({ orderId: 'o1', legType: 'TRANSFERENCIA', destHubId: 'hub-b', stopId: null, completedAt: null, ...over }) as any;

describe('orderIdsDescendingAt', () => {
    it('sem parada: transferências para o hub (ou sem destino próprio e viagem destinada a ele)', () => {
        const legs = [leg({ orderId: 'a' }), leg({ orderId: 'b', destHubId: null }), leg({ orderId: 'c', destHubId: 'hub-z' }), leg({ orderId: 'd', legType: 'ENTREGA' }), leg({ orderId: 'e', completedAt: new Date() })];
        assert.deepEqual(orderIdsDescendingAt(legs, { hubId: 'hub-b', stopId: null, manifestDestHubId: 'hub-b' }), ['a', 'b']);
    });
    it('com parada: só as pernas dela', () => {
        const legs = [leg({ orderId: 'a', stopId: 's1' }), leg({ orderId: 'b', stopId: 's2' })];
        assert.deepEqual(orderIdsDescendingAt(legs, { hubId: 'hub-b', stopId: 's1', manifestDestHubId: 'hub-b' }), ['a']);
    });
});

describe('registerManifestArrival', () => {
    const orig = { find: prisma.manifest.findUnique, tx: prisma.$transaction };
    afterEach(() => {
        prisma.manifest.findUnique = orig.find;
        (prisma as any).$transaction = orig.tx;
    });
    const base = (over: Record<string, unknown> = {}) => ({
        id: 'm1', status: 'IN_PROGRESS', destHubId: 'hub-b', destHub: { id: 'hub-b', name: 'Hub B' }, arrivedAt: null,
        tripStops: [], legs: [leg({ orderId: 'a' }), leg({ orderId: 'b' })], ...over,
    });
    const run = (m: unknown, stopId: string | null, actor: { roles: string[]; hubId: string | null }) => {
        prisma.manifest.findUnique = (async () => m) as any;
        const calls: any[] = [];
        (prisma as any).$transaction = async (fn: any) => fn({
            manifest: { update: async (a: any) => calls.push(['manifest', a]) },
            manifestStop: { update: async (a: any) => calls.push(['stop', a]) },
            orderHistory: { createMany: async (a: any) => calls.push(['history', a]) },
        });
        return registerManifestArrival('m1', stopId, { userId: 'u1', ...actor }).then((result) => ({ result, calls }));
    };

    it('hub de destino registra a chegada e grava histórico com ator em cada pedido', async () => {
        const { result, calls } = await run(base(), null, { roles: ['HUB'], hubId: 'hub-b' });
        assert.equal(result.alreadyArrived, false);
        assert.equal(result.ordersNotified, 2);
        assert.equal(calls[0][0], 'manifest');
        assert.equal(calls[0][1].data.arrivedByUserId, 'u1');
        assert.equal(calls[1][1].data.length, 2);
        assert.equal(calls[1][1].data[0].description, arrivalHistoryText('Hub B'));
        assert.equal(calls[1][1].data[0].actorUserId, 'u1');
        assert.equal(calls[1][1].data[0].eventType, 'NOTE');
    });
    it('é idempotente: segunda chamada não grava nada', async () => {
        const at = new Date('2026-11-11T10:00:00Z');
        const { result, calls } = await run(base({ arrivedAt: at }), null, { roles: ['HUB'], hubId: 'hub-b' });
        assert.equal(result.alreadyArrived, true);
        assert.equal(result.arrivedAt, at);
        assert.equal(calls.length, 0);
    });
    it('hub que não é o destino recebe 403; ADMIN sempre pode', async () => {
        await assert.rejects(run(base(), null, { roles: ['HUB'], hubId: 'hub-x' }), /Not authorized/);
        const { result } = await run(base(), null, { roles: ['ADMIN'], hubId: null });
        assert.equal(result.alreadyArrived, false);
    });
    it('viagem fora de rota é recusada', async () => {
        await assert.rejects(run(base({ status: 'DRAFT' }), null, { roles: ['ADMIN'], hubId: null }), /em rota/);
    });
    it('com paradas: usa a parada do hub e grava nela', async () => {
        const stops = [{ id: 's1', destHubId: 'hub-b', destHub: { id: 'hub-b', name: 'Hub B' }, completedAt: null, arrivedAt: null }];
        const legs = [leg({ orderId: 'a', stopId: 's1' }), leg({ orderId: 'z', stopId: 's9' })];
        const { result, calls } = await run(base({ tripStops: stops, legs }), null, { roles: ['HUB'], hubId: 'hub-b' });
        assert.equal(result.stopId, 's1');
        assert.equal(result.ordersNotified, 1);
        assert.equal(calls[0][0], 'stop');
    });
    it('ADMIN em viagem com paradas precisa informar a parada', async () => {
        const stops = [{ id: 's1', destHubId: 'hub-b', destHub: { id: 'hub-b', name: 'Hub B' }, completedAt: null, arrivedAt: null }];
        await assert.rejects(run(base({ tripStops: stops }), null, { roles: ['ADMIN'], hubId: null }), /Informe a parada/);
        const { result } = await run(base({ tripStops: stops }), 's1', { roles: ['ADMIN'], hubId: null });
        assert.equal(result.stopId, 's1');
    });
});
