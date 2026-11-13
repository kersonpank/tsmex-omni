import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { completeManifest, completeManifestStop } from './manifestLifecycle.js';
import { arrivalsSchema } from './arrivalConference.js';

type TxOp = { model: string; action: string; args: any };

const snapshot = {
    stopFindMany: prisma.manifestStop.findMany,
    stopFindUnique: prisma.manifestStop.findUnique,
    stopCount: prisma.manifestStop.count,
    manifestFindUnique: prisma.manifest.findUnique,
    transaction: prisma.$transaction,
};

const manifestId = 'manifest-transfer-1';
const originHubId = 'hub-gru';
const destHubId = 'hub-imp';
const actor = { userId: 'hub-user', role: 'HUB' as const };
let log: TxOp[];

const leg = (n: number, stopId: string | null = null) => ({
    id: `leg-${n}`, orderId: `order-${n}`, legType: 'TRANSFERENCIA', stopId,
    order: { id: `order-${n}`, nfNumber: `NF${n}`, demand: { units: 10 } },
});

function mockTx() {
    const record = (model: string, action: string) => async (args: any) => { log.push({ model, action, args }); return { id: 'x', ...(args?.data ?? {}) }; };
    return {
        manifest: { update: record('manifest', 'update'), findUnique: async () => ({ id: manifestId, legs: [], totalWeight: 0, totalVolume: 0 }) },
        manifestStop: { update: record('manifestStop', 'update'), count: async () => 0 },
        order: { update: record('order', 'update'), findUnique: async () => null },
        orderLeg: { updateMany: record('orderLeg', 'updateMany'), findMany: async () => [], findFirst: async () => null },
        orderHistory: { create: record('orderHistory', 'create') },
        systemAlert: { create: record('systemAlert', 'create') },
        orderFreightCalculation: { findFirst: async () => null },
        linkPricingAgreement: { findFirst: async () => null },
        hubCommissionAgreement: { findFirst: async () => null },
        fiscalClosureTask: { upsert: async () => ({}) },
    };
}

function setup(legs: any[]) {
    const manifest = {
        id: manifestId, status: 'IN_PROGRESS', tripType: 'TRANSFER', origin: 'Guarulhos, SP', destination: 'Imperatriz, MA',
        hubId: originHubId, destHubId, linkId: 'link-1', hub: { id: originHubId, code: 'GRU-SP' }, destHub: { id: destHubId, code: 'IMP-MA' }, legs,
    };
    prisma.manifestStop.findMany = (async () => []) as any;
    prisma.manifestStop.count = (async () => 0) as any;
    prisma.manifest.findUnique = (async () => manifest) as any;
    prisma.$transaction = (async (fn: any) => fn(mockTx())) as any;
}

const orderUpdate = (id: string) => log.find((o) => o.model === 'order' && o.args.where.id === id)?.args.data;
const histories = (id: string) => log.filter((o) => o.model === 'orderHistory' && o.args.data.orderId === id).map((o) => o.args.data);
const alerts = () => log.filter((o) => o.model === 'systemAlert').map((o) => o.args.data);

describe('conferência de chegada com efeito', () => {
    beforeEach(() => { log = []; });
    afterEach(() => {
        prisma.manifestStop.findMany = snapshot.stopFindMany;
        prisma.manifestStop.findUnique = snapshot.stopFindUnique;
        prisma.manifestStop.count = snapshot.stopCount;
        prisma.manifest.findUnique = snapshot.manifestFindUnique;
        prisma.$transaction = snapshot.transaction;
    });

    it('sem arrivals (cliente antigo): todos entram no estoque do hub destino e nenhum alerta é criado', async () => {
        setup([leg(1), leg(2)]);
        const result = await completeManifest(manifestId, actor);
        assert.equal(orderUpdate('order-1').currentHubId, destHubId);
        assert.equal(orderUpdate('order-2').status, 'AT_HUB');
        assert.equal(alerts().length, 0);
        assert.deepEqual(result?.arrivals, { stocked: 2, damaged: 0, missing: 0 });
    });

    it('OK explícito = como hoje', async () => {
        setup([leg(1)]);
        await completeManifest(manifestId, actor, { arrivals: [{ orderId: 'order-1', result: 'OK' }] });
        assert.equal(orderUpdate('order-1').currentHubId, destHubId);
        assert.equal(alerts().length, 0);
    });

    it('DAMAGED: entra no estoque do destino, grava avaria estruturada com nota e ator, e abre alerta', async () => {
        setup([leg(1)]);
        const result = await completeManifest(manifestId, actor, { arrivals: [{ orderId: 'order-1', result: 'DAMAGED', note: 'Caixa amassada' }] });
        assert.equal(orderUpdate('order-1').status, 'AT_HUB');
        assert.equal(orderUpdate('order-1').currentHubId, destHubId);
        const avaria = histories('order-1').find((h) => /AVARIA NA CHEGADA/.test(h.description));
        assert.ok(avaria);
        assert.match(avaria.description, /Caixa amassada/);
        assert.equal(avaria.actorUserId, 'hub-user');
        const [alert] = alerts();
        assert.equal(alert.category, 'OPERATIONAL_ARRIVAL_DIVERGENCE');
        assert.deepEqual(alert.context, { manifestId, orderId: 'order-1', result: 'DAMAGED', hubId: destHubId });
        assert.deepEqual(result?.arrivals, { stocked: 1, damaged: 1, missing: 0 });
    });

    it('MISSING: não vira estoque do destino; volta AT_HUB no hub de ORIGEM com nota, ator e alerta; perna encerrada', async () => {
        setup([leg(1), leg(2)]);
        const result = await completeManifest(manifestId, actor, { arrivals: [{ orderId: 'order-2', result: 'MISSING', note: 'Não estava no baú' }] });
        assert.equal(orderUpdate('order-1').currentHubId, destHubId);
        const missing = orderUpdate('order-2');
        assert.equal(missing.status, 'AT_HUB');
        assert.equal(missing.currentHubId, originHubId);
        const note = histories('order-2').find((h) => /Não chegou em IMP-MA na viagem manifes/.test(h.description));
        assert.ok(note, 'nota de não chegou');
        assert.match(note.description, /verificar com GRU-SP/);
        assert.match(note.description, /Não estava no baú/);
        assert.equal(note.actorUserId, 'hub-user');
        assert.ok(!histories('order-2').some((h) => /Recebido no hub destino/.test(h.description)), 'não registra recebimento');
        assert.equal(log.find((o) => o.model === 'orderLeg' && o.action === 'updateMany')?.args.data.completedAt instanceof Date, true);
        const [alert] = alerts();
        assert.equal(alert.severity, 'CRITICAL');
        assert.deepEqual(alert.context, { manifestId, orderId: 'order-2', result: 'MISSING', hubId: destHubId });
        assert.deepEqual(result?.arrivals, { stocked: 1, damaged: 0, missing: 1 });
        assert.equal(log.find((o) => o.model === 'manifest')?.args.data.status, 'COMPLETED');
    });

    it('recusa marcação de pedido que não está nesta descarga', async () => {
        setup([leg(1)]);
        await assert.rejects(
            completeManifest(manifestId, actor, { arrivals: [{ orderId: 'order-x', result: 'MISSING' }] }),
            (e: any) => e.statusCode === 400 && /não pertence a esta descarga/.test(e.message),
        );
        assert.equal(log.length, 0);
    });

    it('parada de transferência aplica as marcações aos pedidos da parada', async () => {
        const stopLeg = leg(1, 'stop-1');
        setup([stopLeg]);
        prisma.manifestStop.findUnique = (async () => ({
            id: 'stop-1', manifestId, purpose: 'TRANSFER', completedAt: null, destHubId, destinationLabel: null, destHub: { id: destHubId, code: 'IMP-MA' }, legs: [stopLeg],
        })) as any;
        await completeManifestStop(manifestId, 'stop-1', actor, { arrivals: [{ orderId: 'order-1', result: 'MISSING' }] });
        assert.equal(orderUpdate('order-1').currentHubId, originHubId);
        assert.equal(alerts()[0].context.result, 'MISSING');
    });
});

describe('arrivalsSchema', () => {
    it('aceita resultados válidos e rejeita desconhecidos ou orderId inválido', () => {
        const id = '11111111-1111-4111-8111-111111111111';
        assert.equal(arrivalsSchema.safeParse([{ orderId: id, result: 'DAMAGED', note: 'x' }]).success, true);
        assert.equal(arrivalsSchema.safeParse([{ orderId: id, result: 'LOST' }]).success, false);
        assert.equal(arrivalsSchema.safeParse([{ orderId: 'abc', result: 'OK' }]).success, false);
        assert.equal(arrivalsSchema.safeParse([{ orderId: id, result: 'OK' }, { orderId: id, result: 'MISSING' }]).success, false);
    });
});
