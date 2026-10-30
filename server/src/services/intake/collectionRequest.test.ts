import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import {
    attachCollectionRequest,
    cancelCollectionRequest,
    createCollectionRequest,
    demandNeedsCollection,
    getLastCollectionAddresses,
    parseNfKeys,
    readCollectionRequest,
} from './collectionRequest.js';

const HUB = '550e8400-e29b-41d4-a716-446655440002';
const PERSON = '550e8400-e29b-41d4-a716-446655440003';
const K1 = '35260512345678000190550010000000012345678901';
const K2 = '35260512345678000190550010000000022345678902';
const address = { city: 'Imperatriz', state: 'MA', address: 'Rua A', number: '10' };

describe('helpers puros', () => {
    it('parseNfKeys extrai chaves únicas de 44 dígitos', () => {
        assert.deepEqual(parseNfKeys([`${K1}, ${K2}`, K1, '123']), [K1, K2]);
        assert.deepEqual(parseNfKeys(undefined), []);
    });

    it('demandNeedsCollection só vale com coleta ativa', () => {
        assert.equal(demandNeedsCollection({ rawInputData: null }), false);
        assert.equal(demandNeedsCollection({ rawInputData: { nfeXmlData: {} } }), false);
        assert.equal(demandNeedsCollection({ rawInputData: { collectionRequest: { nfKeys: [] } } }), true);
        assert.equal(
            demandNeedsCollection({ rawInputData: { collectionRequest: { nfKeys: [], cancelledAt: '2026-11-01' } } }),
            false,
        );
        assert.equal(readCollectionRequest('x'), null);
    });
});

describe('coleta solicitada pelo hub', () => {
    const store = {
        demands: new Map<string, Record<string, unknown>>(),
        events: [] as Array<Record<string, unknown>>,
    };
    const original = {
        personFind: prisma.person.findUnique,
        findMany: prisma.demand.findMany,
        findFirst: prisma.demand.findFirst,
        findUnique: prisma.demand.findUnique,
        create: prisma.demand.create,
        update: prisma.demand.update,
        eventCreate: prisma.demandEvent.create,
        seqUpdate: prisma.orderSequenceConfig.update,
        transaction: prisma.$transaction,
    };

    beforeEach(() => {
        store.demands.clear();
        store.events = [];
        prisma.person.findUnique = (async () => ({
            id: PERSON,
            legalName: 'Remetente LTDA',
            tradeName: 'Remetente',
            city: 'Imperatriz',
            state: 'MA',
            clients: [{ id: 'cli-1' }],
        })) as unknown as typeof prisma.person.findUnique;
        prisma.demand.findMany = (async () =>
            [...store.demands.values()].filter((d) => d.status === 'AWAITING_ARRIVAL' && d.expectedHubId === HUB && (d.documentKey === K1 || d.documentKey === K2))) as unknown as typeof prisma.demand.findMany;
        prisma.demand.findFirst = (async (args: { where?: { sourceType?: string; externalReference?: string; documentKey?: { in: string[] } } }) => {
            const keys = args?.where?.documentKey?.in;
            if (keys) return [...store.demands.values()].find((d) => keys.includes(d.documentKey as string)) ?? null;
            return null;
        }) as unknown as typeof prisma.demand.findFirst;
        prisma.demand.findUnique = (async ({ where }: { where: { id: string } }) => {
            const d = store.demands.get(where.id);
            return d ? { ...d, order: null } : null;
        }) as unknown as typeof prisma.demand.findUnique;
        prisma.demand.create = (async ({ data }: { data: Record<string, unknown> }) => {
            const id = `dem-${store.demands.size + 1}`;
            const row = { id, ...data };
            store.demands.set(id, row);
            return row;
        }) as unknown as typeof prisma.demand.create;
        prisma.demand.update = (async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = { ...store.demands.get(where.id), ...data };
            store.demands.set(where.id, row);
            return row;
        }) as unknown as typeof prisma.demand.update;
        prisma.demandEvent.create = (async ({ data }: { data: Record<string, unknown> }) => {
            store.events.push(data);
            return data;
        }) as unknown as typeof prisma.demandEvent.create;
        let seq = 100;
        prisma.orderSequenceConfig.update = (async () => ({ lastNumber: ++seq })) as unknown as typeof prisma.orderSequenceConfig.update;
        prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as unknown as typeof prisma.$transaction;
    });

    afterEach(() => {
        prisma.person.findUnique = original.personFind;
        prisma.demand.findMany = original.findMany;
        prisma.demand.findFirst = original.findFirst;
        prisma.demand.findUnique = original.findUnique;
        prisma.demand.create = original.create;
        prisma.demand.update = original.update;
        prisma.demandEvent.create = original.eventCreate;
        prisma.orderSequenceConfig.update = original.seqUpdate;
        prisma.$transaction = original.transaction;
    });

    const base = { hubId: HUB, senderPersonId: PERSON, address, requestedDate: '2026-11-05' };

    it('sem NF cria uma entrada esperada marcada como coleta', async () => {
        const res = await createCollectionRequest({ ...base, approxUnits: 3 });
        assert.equal(res.created, 1);
        assert.equal(res.attached, 0);
        const d = res.demands[0] as Record<string, unknown>;
        assert.equal(d.status, 'AWAITING_ARRIVAL');
        assert.equal(d.intentType, 'COLLECT');
        assert.equal(d.expectedHubId, HUB);
        assert.equal(d.origin, 'Imperatriz, MA');
        assert.equal(demandNeedsCollection(d as { rawInputData: unknown }), true);
        assert.equal(store.events.length >= 2, true);
    });

    it('com várias chaves: a primeira é documentKey e a lista fica em rawInputData', async () => {
        const res = await createCollectionRequest({ ...base, nfKeys: [K1, K2] });
        const d = res.demands[0] as Record<string, unknown>;
        assert.equal(d.documentKey, K1);
        assert.deepEqual(readCollectionRequest(d.rawInputData)?.nfKeys, [K1, K2]);
        assert.equal(d.documentType, 'NFE');
    });

    it('NF que já aguarda neste hub recebe a coleta sem duplicar', async () => {
        store.demands.set('dfe-1', {
            id: 'dfe-1', status: 'AWAITING_ARRIVAL', expectedHubId: HUB, documentKey: K1, origin: 'A definir',
            sourceType: 'DFE_ACBR', rawInputData: { nfeXmlData: { x: 1 } },
        });
        const res = await createCollectionRequest({ ...base, nfKeys: [K1] });
        assert.equal(res.attached, 1);
        assert.equal(res.created, 0);
        assert.equal(store.demands.size, 1);
        const d = store.demands.get('dfe-1')!;
        assert.equal(d.intentType, 'COLLECT');
        assert.equal(d.origin, 'Imperatriz, MA');
        assert.deepEqual((d.rawInputData as Record<string, unknown>).nfeXmlData, { x: 1 });
        assert.equal(demandNeedsCollection(d as { rawInputData: unknown }), true);
    });

    it('chaves mistas: anexa à existente e cria só para a que falta', async () => {
        store.demands.set('dfe-1', {
            id: 'dfe-1', status: 'AWAITING_ARRIVAL', expectedHubId: HUB, documentKey: K1, origin: 'X', sourceType: 'DFE_ACBR', rawInputData: null,
        });
        const res = await createCollectionRequest({ ...base, nfKeys: [K1, K2] });
        assert.equal(res.attached, 1);
        assert.equal(res.created, 1);
        assert.equal(store.demands.size, 2);
    });

    it('chave já coberta por coleta ativa é recusada (409)', async () => {
        store.demands.set('dfe-1', {
            id: 'dfe-1', status: 'AWAITING_ARRIVAL', expectedHubId: HUB, documentKey: K1, origin: 'X', sourceType: 'DFE_ACBR',
            rawInputData: { collectionRequest: { nfKeys: [K1] } },
        });
        await assert.rejects(createCollectionRequest({ ...base, nfKeys: [K1] }), /já tem coleta/);
    });

    it('attachCollectionRequest respeita o hub (HUB não mexe em outro hub)', async () => {
        store.demands.set('dfe-1', {
            id: 'dfe-1', status: 'AWAITING_ARRIVAL', expectedHubId: 'other-hub', documentKey: K1, origin: 'X', sourceType: 'DFE_ACBR', rawInputData: null,
        });
        await assert.rejects(attachCollectionRequest({ ...base, demandId: 'dfe-1', isAdmin: false }), /Not authorized/);
        const ok = await attachCollectionRequest({ ...base, hubId: 'other-hub', demandId: 'dfe-1', isAdmin: false });
        assert.equal((ok as Record<string, unknown>).intentType, 'COLLECT');
    });

    it('cancelar coleta criada pelo hub cancela a entrada; em NF anexada só remove a coleta', async () => {
        const created = await createCollectionRequest({ ...base });
        const id = (created.demands[0] as Record<string, unknown>).id as string;
        await assert.rejects(cancelCollectionRequest({ demandId: id, reason: 'x', actingHubId: HUB, isAdmin: false }), /motivo/);
        await assert.rejects(cancelCollectionRequest({ demandId: id, reason: 'sem carga', actingHubId: 'outro', isAdmin: false }), /Not authorized/);
        await cancelCollectionRequest({ demandId: id, reason: 'cliente desistiu', actingHubId: HUB, isAdmin: false });
        assert.equal(store.demands.get(id)!.status, 'CANCELLED');

        store.demands.set('dfe-1', {
            id: 'dfe-1', status: 'AWAITING_ARRIVAL', expectedHubId: HUB, documentKey: K1, origin: 'X', sourceType: 'DFE_ACBR', rawInputData: null,
        });
        await attachCollectionRequest({ ...base, demandId: 'dfe-1', isAdmin: false });
        await cancelCollectionRequest({ demandId: 'dfe-1', reason: 'entrega direta', actingHubId: HUB, isAdmin: false });
        const d = store.demands.get('dfe-1')!;
        assert.equal(d.status, 'AWAITING_ARRIVAL');
        assert.equal(d.intentType, 'DROP_AT_HUB');
        assert.equal(demandNeedsCollection(d as { rawInputData: unknown }), false);
    });

    it('grava e lê campos enriquecidos (contratante, contatos, janela, mercadoria, flags)', async () => {
        const res = await createCollectionRequest({
            ...base,
            contractingPersonId: PERSON,
            contacts: [{ name: 'Carlos', phone: '11999999999', email: 'carlos@empresa.com', role: 'Expedição' }],
            availabilityWindow: '08:00–12:00',
            referencePoint: 'Portão 3 ao lado do galpão',
            accessInstructions: 'Doca 2, avisar portaria',
            destinatarioPersonId: PERSON,
            goodsDescription: 'Peças industriais e válvulas',
            nfValue: 12500.5,
            needsHelper: true,
            needsLoading: true,
            packageDimensions: [{ quantity: 2, lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 15 }],
        });
        const dem = res.demands[0];
        const cr = readCollectionRequest(dem.rawInputData);
        assert.ok(cr);
        assert.equal(cr.contractingPersonId, PERSON);
        assert.equal(cr.contractingPersonName, 'Remetente');
        assert.equal(cr.contacts?.[0]?.name, 'Carlos');
        assert.equal(cr.contacts?.[0]?.phone, '11999999999');
        assert.equal(cr.contacts?.[0]?.role, 'Expedição');
        assert.equal(cr.contact, 'Carlos (11999999999)');
        assert.equal(cr.availabilityWindow, '08:00–12:00');
        assert.equal(cr.referencePoint, 'Portão 3 ao lado do galpão');
        assert.equal(cr.accessInstructions, 'Doca 2, avisar portaria');
        assert.equal(cr.destinatarioPersonId, PERSON);
        assert.equal(cr.goodsDescription, 'Peças industriais e válvulas');
        assert.equal(cr.nfValue, 12500.5);
        assert.equal(cr.needsHelper, true);
        assert.equal(cr.needsLoading, true);
        assert.equal(cr.packageDimensions?.length, 1);
        assert.equal(dem.commodity, 'Peças industriais e válvulas');
        assert.equal(dem.nfValue, 12500.5);
    });

    it('compatibilidade retroativa: lê coletas antigas sem campos novos', () => {
        const oldCr = {
            senderPersonId: PERSON,
            senderName: 'Antigo',
            address: { city: 'São Paulo', state: 'SP' },
            requestedDate: '2026-10-01',
            nfKeys: [],
            requestedAt: '2026-10-01T10:00:00.000Z',
        };
        const read = readCollectionRequest({ collectionRequest: oldCr });
        assert.ok(read);
        assert.equal(read.senderName, 'Antigo');
        assert.equal(read.contractingPersonId, undefined);
        assert.equal(read.contacts, undefined);
        assert.equal(read.needsHelper, undefined);
    });

    it('getLastCollectionAddresses devolve histórico deduplicado do remetente', async () => {
        const addr1 = { city: 'Imperatriz', state: 'MA', address: 'Rua A', number: '10' };
        const addr2 = { city: 'Açailândia', state: 'MA', address: 'Av B', number: '200', referencePoint: 'Galpão 2' };
        store.demands.set('d-1', {
            id: 'd-1',
            createdAt: new Date('2026-10-25'),
            rawInputData: { collectionRequest: { senderPersonId: PERSON, address: addr1 } },
        });
        store.demands.set('d-2', {
            id: 'd-2',
            createdAt: new Date('2026-10-26'),
            rawInputData: { collectionRequest: { senderPersonId: PERSON, address: addr2 } },
        });
        store.demands.set('d-3', {
            id: 'd-3',
            createdAt: new Date('2026-10-27'),
            rawInputData: { collectionRequest: { senderPersonId: PERSON, address: addr1 } }, // duplicado
        });

        // Mock findMany to search store by rawInputData
        const originalFindMany = prisma.demand.findMany;
        prisma.demand.findMany = (async () => {
            return [...store.demands.values()]
                .filter((d) => (d.rawInputData as Record<string, unknown>)?.collectionRequest)
                .reverse();
        }) as unknown as typeof prisma.demand.findMany;

        try {
            const addrs = await getLastCollectionAddresses(PERSON, 5);
            assert.equal(addrs.length, 2);
            assert.equal(addrs[0]?.city, 'Imperatriz');
            assert.equal(addrs[1]?.city, 'Açailândia');
            assert.equal(addrs[1]?.referencePoint, 'Galpão 2');
        } finally {
            prisma.demand.findMany = originalFindMany;
        }
    });
});
