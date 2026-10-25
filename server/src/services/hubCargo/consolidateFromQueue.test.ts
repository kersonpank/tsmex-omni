import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { ManifestDraftInput } from '../manifestCreate.js';
import type { ConsolidationQueueGroup } from './consolidationQueue.js';
import {
    consolidateFromQueue,
    feedbackActionFor,
    ordersOutsideQueue,
    STOCK_SELECTION_GROUP_KEY,
    type ConsolidateFromQueueInput,
} from './consolidateFromQueue.js';

describe('feedbackActionFor — sugerido (fila) × final (viagem)', () => {
    it('mesmo conjunto, em qualquer ordem → ACCEPTED', () => {
        assert.equal(feedbackActionFor(['a', 'b', 'c'], ['c', 'a', 'b']), 'ACCEPTED');
    });

    it('operador tirou pedido da sugestão → MODIFIED', () => {
        assert.equal(feedbackActionFor(['a', 'b', 'c'], ['a', 'b']), 'MODIFIED');
    });

    it('motor recusou um pedido (capacidade) e o final ficou menor → MODIFIED', () => {
        assert.equal(feedbackActionFor(['a', 'b'], ['a']), 'MODIFIED');
    });

    it('duplicata no final não engana a comparação', () => {
        assert.equal(feedbackActionFor(['a', 'b'], ['a', 'a']), 'MODIFIED');
    });

    it('operador escolheu a rota → MODIFIED mesmo com os mesmos pedidos', () => {
        assert.equal(feedbackActionFor(['a', 'b'], ['a', 'b'], true), 'MODIFIED');
    });
});

function queue(kind: ConsolidationQueueGroup['kind'], ids: string[]): ConsolidationQueueGroup {
    return {
        key: kind === 'TRANSFER' ? 'TRANSFER:destination' : kind,
        kind,
        destHubId: kind === 'TRANSFER' ? 'destination' : null,
        destHubName: kind === 'TRANSFER' ? 'Hub destino' : null,
        destHubCode: kind === 'TRANSFER' ? 'DEST' : null,
        orders: ids.map((orderId) => ({
            orderId, orderNumber: null, nfNumber: null, destination: null,
            weightKg: 100, volumeM3: 1, valueBRL: 1000, freightDocState: 'emitted',
            sinceAt: '2026-10-01T00:00:00.000Z',
        })),
        totalWeightKg: ids.length * 100,
        totalVolumeM3: ids.length,
        totalValueBRL: ids.length * 1000,
        oldestSinceAt: '2026-10-01T00:00:00.000Z',
    };
}

describe('consolidateFromQueue — destino escolhido e seleção do estoque', () => {
    const originals = {
        hub: prisma.hub.findUnique,
        manifest: prisma.manifest.findUniqueOrThrow,
        feedback: prisma.consolidationFeedback.create,
    };
    let feedback: any;
    let destinationActive = true;

    beforeEach(() => {
        feedback = undefined;
        destinationActive = true;
        prisma.hub.findUnique = (async ({ where }: any) => {
            if (where.id === 'origin') return { id: 'origin', city: 'Guarulhos', state: 'SP', cityIbgeCode: null, active: true };
            if (where.id === 'destination') return { id: 'destination', name: 'Hub destino', code: 'DEST', active: destinationActive };
            return null;
        }) as any;
        prisma.manifest.findUniqueOrThrow = (async () => ({ totalWeight: 200, vehicleType: { maxWeight: 1000 } })) as any;
        prisma.consolidationFeedback.create = (async ({ data }: any) => { feedback = data; return data; }) as any;
    });

    afterEach(() => {
        prisma.hub.findUnique = originals.hub;
        prisma.manifest.findUniqueOrThrow = originals.manifest;
        prisma.consolidationFeedback.create = originals.feedback;
    });

    function setup(groups = [queue('UNROUTED', ['a', 'b'])]) {
        const drafts: Array<{ data: ManifestDraftInput; hubId: string | undefined; options: unknown }> = [];
        const added: Array<{ orderId: string; actor: unknown; options: unknown }> = [];
        const deleted: string[] = [];
        const rejected = new Set<string>();
        const input: ConsolidateFromQueueInput = {
            hubId: 'origin', groupKey: 'UNROUTED', orderIds: ['a', 'b'], vehicleTypeId: 'vehicle',
            actor: { userId: 'operator', role: 'HUB' },
        };
        const deps: NonNullable<Parameters<typeof consolidateFromQueue>[1]> = {
            getQueues: async (hubId) => {
                assert.equal(hubId, input.hubId);
                return groups;
            },
            createDraft: (async (data, hubId, options) => {
                drafts.push({ data, hubId, options });
                return { id: 'trip' };
            }) as NonNullable<Parameters<typeof consolidateFromQueue>[1]>['createDraft'],
            addOrder: async (_manifestId, orderId, actor, _stopId, options) => {
                added.push({ orderId, actor, options });
                if (rejected.has(orderId)) throw new AppError('Capacidade excedida.', 400);
                return {} as any;
            },
            deleteEmpty: async (id) => { deleted.push(id); return {} as any; },
            getMargin: async () => ({ margin: null, revenue: 0 }) as any,
        };
        return { input, deps, drafts, added, deleted, rejected };
    }

    it('UNROUTED cria transferência para hub ativo e registra a rota como MODIFIED', async () => {
        const fixture = setup();
        const result = await consolidateFromQueue({ ...fixture.input, destHubId: 'destination' }, fixture.deps);
        assert.deepEqual(result, { manifestId: 'trip', added: ['a', 'b'], failed: [] });
        assert.equal(fixture.drafts[0].data.tripType, 'TRANSFER');
        assert.equal(fixture.drafts[0].data.destHubId, 'destination');
        assert.equal(fixture.drafts[0].hubId, 'origin');
        assert.deepEqual(fixture.drafts[0].options, { allowIncompleteHubCity: true });
        assert.ok(fixture.added.every((item) => item.actor === fixture.input.actor));
        assert.ok(fixture.added.every((item) => (item.options as any).recordFeedback === false));
        assert.equal(feedback.action, 'MODIFIED');
        assert.equal(feedback.suggestedManifests[0].kind, 'UNROUTED');
        assert.equal(feedback.suggestedManifests[0].destHubId, null);
        assert.equal(feedback.finalManifests[0].destHubId, 'destination');
        assert.equal(feedback.finalManifests[0].local, false);
    });

    it('UNROUTED permite entrega local sem hub destino', async () => {
        const fixture = setup();
        await consolidateFromQueue({ ...fixture.input, local: true }, fixture.deps);
        assert.equal(fixture.drafts[0].data.tripType, 'DELIVERY');
        assert.equal(fixture.drafts[0].data.destination, 'Guarulhos, SP');
        assert.equal(fixture.drafts[0].data.destHubId, undefined);
        assert.equal(feedback.action, 'MODIFIED');
        assert.equal(feedback.finalManifests[0].destHubId, null);
        assert.equal(feedback.finalManifests[0].local, true);
    });

    it('UNROUTED exige exatamente uma escolha de destino antes de criar o rascunho', async () => {
        const fixture = setup();
        await assert.rejects(consolidateFromQueue(fixture.input, fixture.deps), { statusCode: 400 });
        await assert.rejects(consolidateFromQueue({ ...fixture.input, destHubId: 'destination', local: true }, fixture.deps), { statusCode: 400 });
        assert.equal(fixture.drafts.length, 0);
    });

    it('rejeita o hub de origem como destino', async () => {
        const fixture = setup();
        await assert.rejects(consolidateFromQueue({ ...fixture.input, destHubId: 'origin' }, fixture.deps), /igual ao hub de origem/);
        assert.equal(fixture.drafts.length, 0);
    });

    it('rejeita hub destino inativo', async () => {
        const fixture = setup();
        destinationActive = false;
        await assert.rejects(consolidateFromQueue({ ...fixture.input, destHubId: 'destination' }, fixture.deps), /inativo/);
        assert.equal(fixture.drafts.length, 0);
    });

    it('rejeita hub destino inexistente', async () => {
        const fixture = setup();
        await assert.rejects(consolidateFromQueue({ ...fixture.input, destHubId: 'missing' }, fixture.deps), /não encontrado/);
        assert.equal(fixture.drafts.length, 0);
    });

    it('filas roteadas mantêm o destino sugerido e ACCEPTED', async () => {
        for (const kind of ['TRANSFER', 'LOCAL'] as const) {
            const group = queue(kind, ['a', 'b']);
            const fixture = setup([group]);
            await consolidateFromQueue({ ...fixture.input, groupKey: group.key }, fixture.deps);
            assert.equal(fixture.drafts[0].data.tripType, kind === 'TRANSFER' ? 'TRANSFER' : 'DELIVERY');
            assert.equal(feedback.action, 'ACCEPTED');
        }
    });

    it('não permite sobrescrever o destino de uma fila já roteada', async () => {
        const fixture = setup([queue('LOCAL', ['a', 'b'])]);
        await assert.rejects(consolidateFromQueue({ ...fixture.input, groupKey: 'LOCAL', destHubId: 'destination' }, fixture.deps), { statusCode: 400 });
        assert.equal(fixture.drafts.length, 0);
    });

    it('seleção do estoque combina grupos recalculados e preserva as sugestões originais', async () => {
        const fixture = setup([queue('LOCAL', ['a', 'c']), queue('TRANSFER', ['b'])]);
        await consolidateFromQueue({ ...fixture.input, groupKey: STOCK_SELECTION_GROUP_KEY, local: true }, fixture.deps);
        assert.deepEqual(feedback.suggestedManifests.map((item: any) => [item.queueKey, item.orderIds]), [
            ['LOCAL', ['a', 'c']], ['TRANSFER:destination', ['b']],
        ]);
        assert.deepEqual(feedback.finalManifests[0].orderIds, ['a', 'b']);
        assert.equal(feedback.action, 'MODIFIED');
    });

    it('seleção do estoque rejeita pedidos ausentes, já alocados ou de outro hub', async () => {
        const fixture = setup([queue('LOCAL', ['a'])]);
        for (const id of ['missing', 'already-assigned', 'another-hub']) {
            await assert.rejects(consolidateFromQueue({
                ...fixture.input, groupKey: STOCK_SELECTION_GROUP_KEY, orderIds: ['a', id], local: true,
            }, fixture.deps), { statusCode: 409 });
        }
        assert.equal(fixture.drafts.length, 0);
    });

    it('fila normal também rejeita grupo ou pedido que saiu da sugestão', async () => {
        const fixture = setup();
        await assert.rejects(consolidateFromQueue({ ...fixture.input, groupKey: 'missing', local: true }, fixture.deps), { statusCode: 409 });
        await assert.rejects(consolidateFromQueue({ ...fixture.input, orderIds: ['a', 'missing'], local: true }, fixture.deps), { statusCode: 409 });
        assert.equal(fixture.drafts.length, 0);
    });

    it('mantém recusas do motor de elegibilidade/capacidade e grava somente os adicionados', async () => {
        const fixture = setup();
        fixture.rejected.add('b');
        const result = await consolidateFromQueue({ ...fixture.input, local: true }, fixture.deps);
        assert.deepEqual(result.added, ['a']);
        assert.deepEqual(result.failed, [{ orderId: 'b', message: 'Capacidade excedida.' }]);
        assert.deepEqual(feedback.finalManifests[0].failedOrderIds, ['b']);
        assert.deepEqual(feedback.orderIds, ['a']);
    });

    it('remove o rascunho vazio se o motor recusar todos os pedidos', async () => {
        const fixture = setup();
        fixture.rejected.add('a');
        fixture.rejected.add('b');
        await assert.rejects(consolidateFromQueue({ ...fixture.input, local: true }, fixture.deps), { statusCode: 422 });
        assert.deepEqual(fixture.deleted, ['trip']);
        assert.equal(feedback, undefined);
    });
});

describe('ordersOutsideQueue', () => {
    it('aponta pedidos escolhidos que não estão mais na fila', () => {
        assert.deepEqual(ordersOutsideQueue(['a', 'b'], ['a', 'x']), ['x']);
    });

    it('subconjunto da fila é válido', () => {
        assert.deepEqual(ordersOutsideQueue(['a', 'b', 'c'], ['c']), []);
    });
});
