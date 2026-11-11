import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { completeManifest, completeManifestStop } from './manifestLifecycle.js';

type TxOp = { model: string; action: string; args: any };

const snapshot = {
    stopFindMany: prisma.manifestStop.findMany,
    stopFindUnique: prisma.manifestStop.findUnique,
    stopCount: prisma.manifestStop.count,
    manifestFindUnique: prisma.manifest.findUnique,
    attemptFindMany: prisma.deliveryAttempt.findMany,
    transaction: prisma.$transaction,
    linkUpdate: prisma.link.update,
};

const manifestId = 'manifest-delivery-1';
const originHubId = 'hub-imp';
const actor = { userId: 'hub-user', role: 'HUB' as const };
let log: TxOp[];
let attempts: Array<{ legId: string; result: string; deliveredQuantity: number | null; expectedQuantity: number | null; nextAction: string | null; exceptionReason: string | null }>;
let linkIncrements: number[];

const leg = (n: number, stopId: string | null = null) => ({
    id: `leg-${n}`, orderId: `order-${n}`, orderId_: n, legType: 'ENTREGA', stopId,
    order: { id: `order-${n}`, nfNumber: `NF${n}`, demand: { units: 10 } },
});

function attempt(n: number, result: string, delivered: number, extra: Record<string, unknown> = {}) {
    return { legId: `leg-${n}`, result, deliveredQuantity: delivered, expectedQuantity: 10, nextAction: null, exceptionReason: null, ...extra } as any;
}

function mockTx() {
    const record = (model: string, action: string) => async (args: any) => { log.push({ model, action, args }); return { id: 'x', ...(args?.data ?? {}) }; };
    return {
        manifest: { update: record('manifest', 'update'), findUnique: async () => ({ id: manifestId, legs: [], totalWeight: 0, totalVolume: 0 }) },
        manifestStop: { update: record('manifestStop', 'update') },
        order: { update: record('order', 'update'), findUnique: async () => null },
        orderLeg: { updateMany: record('orderLeg', 'updateMany'), findMany: async () => [], findFirst: async () => null },
        orderHistory: { create: record('orderHistory', 'create') },
        orderFreightCalculation: { findFirst: async () => null },
        linkPricingAgreement: { findFirst: async () => null },
        hubCommissionAgreement: { findFirst: async () => null },
        fiscalClosureTask: { upsert: async () => ({}) },
    };
}

function setup(legs: any[], extra: Record<string, unknown> = {}) {
    const manifest = {
        id: manifestId, status: 'IN_PROGRESS', tripType: 'DELIVERY', origin: 'Imperatriz, MA', destination: 'Açailândia, MA',
        hubId: originHubId, destHubId: null, linkId: 'link-1', destHub: null, legs, ...extra,
    };
    prisma.manifestStop.findMany = (async () => []) as any;
    prisma.manifestStop.count = (async () => 0) as any;
    prisma.manifest.findUnique = (async () => manifest) as any;
    prisma.deliveryAttempt.findMany = (async () => [...attempts].reverse()) as any;
    prisma.$transaction = (async (fn: any) => fn(mockTx())) as any;
    prisma.link.update = (async (args: any) => { linkIncrements.push(args.data.deliveryCount.increment); return {}; }) as any;
}

const orderUpdate = (id: string) => log.find((o) => o.model === 'order' && o.args.where.id === id)?.args.data;
const histories = (id: string) => log.filter((o) => o.model === 'orderHistory' && o.args.data.orderId === id).map((o) => o.args.data);

describe('conclusão de viagem de entrega com desfechos', () => {
    beforeEach(() => { log = []; attempts = []; linkIncrements = []; });
    afterEach(() => {
        prisma.manifestStop.findMany = snapshot.stopFindMany;
        prisma.manifestStop.findUnique = snapshot.stopFindUnique;
        prisma.manifestStop.count = snapshot.stopCount;
        prisma.manifest.findUnique = snapshot.manifestFindUnique;
        prisma.deliveryAttempt.findMany = snapshot.attemptFindMany;
        prisma.$transaction = snapshot.transaction;
        prisma.link.update = snapshot.linkUpdate;
    });

    it('entrega total: pedido DELIVERED e transportador conta a entrega', async () => {
        attempts = [attempt(1, 'DELIVERED', 10)];
        setup([leg(1)]);
        await completeManifest(manifestId, actor);
        assert.equal(orderUpdate('order-1').status, 'DELIVERED');
        assert.equal(orderUpdate('order-1').currentHubId, null);
        assert.equal(histories('order-1')[0].eventType, 'DELIVERED');
        assert.equal(histories('order-1')[0].actorUserId, 'hub-user');
        assert.deepEqual(linkIncrements, [1]);
        assert.equal(log.find((o) => o.model === 'manifest')?.args.data.status, 'COMPLETED');
    });

    it('falha com RETURN_TO_HUB: pedido volta ao estoque do hub de origem e a viagem fecha', async () => {
        attempts = [attempt(1, 'FAILED', 0, { nextAction: 'RETURN_TO_HUB', exceptionReason: 'Destinatário ausente' })];
        setup([leg(1)]);
        await completeManifest(manifestId, actor);
        const data = orderUpdate('order-1');
        assert.equal(data.status, 'AT_HUB');
        assert.equal(data.currentHubId, originHubId);
        assert.ok(data.enteredAtHubAt instanceof Date);
        const note = histories('order-1')[0];
        assert.equal(note.eventType, 'AT_HUB');
        assert.equal(note.actorUserId, 'hub-user');
        assert.match(note.description, /Entrega não realizada: Destinatário ausente\. Carga de volta ao estoque de .* para nova tentativa\./);
        assert.equal(log.find((o) => o.model === 'orderLeg')?.args.data.completedAt instanceof Date, true);
        assert.equal(log.find((o) => o.model === 'manifest')?.args.data.status, 'COMPLETED');
        assert.deepEqual(linkIncrements, []);
    });

    it('mistura de entregue e não entregue: cada pedido segue seu desfecho e só a entrega efetiva conta', async () => {
        attempts = [attempt(1, 'DELIVERED', 10), attempt(2, 'FAILED', 0, { nextAction: 'REATTEMPT', exceptionReason: 'Loja fechada' })];
        setup([leg(1), leg(2)]);
        await completeManifest(manifestId, actor);
        assert.equal(orderUpdate('order-1').status, 'DELIVERED');
        assert.equal(orderUpdate('order-2').status, 'AT_HUB');
        assert.deepEqual(linkIncrements, [1]);
    });

    it('TRANSFER: a nota diz que a carga precisa ser encaminhada a outro hub', async () => {
        attempts = [attempt(1, 'FAILED', 0, { nextAction: 'TRANSFER', exceptionReason: 'Endereço fora da área' })];
        setup([leg(1)]);
        await completeManifest(manifestId, actor);
        assert.equal(orderUpdate('order-1').status, 'AT_HUB');
        assert.match(histories('order-1')[0].description, /encaminhad[ao] a outro hub/);
    });

    it('parcial: histórico diz quantos volumes foram entregues e quantos voltaram; pedido volta inteiro com a nota', async () => {
        attempts = [attempt(1, 'PARTIAL', 4, { nextAction: 'RETURN_TO_HUB', exceptionReason: 'Restante danificado' })];
        setup([leg(1)]);
        await completeManifest(manifestId, actor);
        assert.equal(orderUpdate('order-1').status, 'AT_HUB');
        assert.match(histories('order-1')[0].description, /4 volume\(s\) entregue\(s\).*6 volume\(s\) voltaram/);
        assert.deepEqual(linkIncrements, [], 'entrega parcial não conta como entrega efetiva');
    });

    it('perna sem nenhuma tentativa continua bloqueando a conclusão com mensagem clara', async () => {
        attempts = [attempt(1, 'DELIVERED', 10)];
        setup([leg(1), leg(2)]);
        await assert.rejects(completeManifest(manifestId, actor), (e: any) => e.statusCode === 422 && /sem nenhum registro/.test(e.message));
        assert.equal(log.length, 0);
    });

    it('parada de entrega: aplica o mesmo desfecho só aos pedidos da parada', async () => {
        attempts = [attempt(1, 'FAILED', 0, { nextAction: 'RETURN_TO_HUB', exceptionReason: 'Recusado pelo cliente' })];
        setup([leg(1, 'stop-1')]);
        prisma.manifestStop.findUnique = (async () => ({
            id: 'stop-1', manifestId, purpose: 'DELIVERY', completedAt: null, destHubId: null, destinationLabel: 'Cliente X', destHub: null,
            legs: [leg(1, 'stop-1')],
        })) as any;
        const result = await completeManifestStop(manifestId, 'stop-1', actor);
        assert.equal(result.allStopsCompleted, true);
        assert.equal(orderUpdate('order-1').status, 'AT_HUB');
        assert.equal(orderUpdate('order-1').currentHubId, originHubId);
    });
});
