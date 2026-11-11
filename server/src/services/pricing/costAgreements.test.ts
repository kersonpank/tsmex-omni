import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    closeHubAgreement,
    closeLinkAgreement,
    createHubAgreement,
    createLinkAgreement,
    listHubAgreements,
    listLinkAgreements,
} from './costAgreements.js';

function db(over: Record<string, any> = {}) {
    const calls: Record<string, any[]> = { linkCreate: [], hubCreate: [], linkUpdate: [], hubUpdate: [] };
    const d: any = {
        link: { findUnique: async () => ({ id: 'l1', name: 'Transportes X' }) },
        hub: { findUnique: async () => ({ id: 'h1', name: 'Hub SP' }) },
        vehicleType: { findUnique: async () => ({ code: 'TRUCK' }) },
        linkPricingAgreement: {
            findFirst: async () => over.linkActive ?? null,
            findMany: async () => over.linkRows ?? [],
            create: async ({ data }: any) => { calls.linkCreate.push(data); return { id: 'a1', ...data }; },
            updateMany: async (a: any) => { calls.linkUpdate.push(a); return { count: over.updateCount ?? 1 }; },
            findUnique: async () => ({ id: 'a1', active: false }),
        },
        hubCommissionAgreement: {
            findFirst: async () => over.hubActive ?? null,
            findMany: async () => over.hubRows ?? [],
            create: async ({ data }: any) => { calls.hubCreate.push(data); return { id: 'c1', ...data }; },
            updateMany: async (a: any) => { calls.hubUpdate.push(a); return { count: over.updateCount ?? 1 }; },
            findUnique: async () => ({ id: 'c1', active: false }),
        },
        $transaction: async (fn: any) => fn(d),
        $queryRaw: async () => [],
    };
    return { d, calls };
}

describe('acordo do transportador (LinkPricingAgreement)', () => {
    const base = { linkId: 'l1', originCity: 'São Paulo', destinationCity: 'Imperatriz', vehicleTypeCode: 'TRUCK', costMode: 'FLAT' as const, flatRate: 5000.456 };

    it('cria arredondando dinheiro para 2 casas', async () => {
        const { d, calls } = db();
        await createLinkAgreement(base, d);
        assert.equal(calls.linkCreate[0].flatRate, 5000.46);
        assert.equal(calls.linkCreate[0].active, true);
    });

    it('PER_M3 exige tarifa por m3; PER_KG exige tarifa por kg', async () => {
        const { d } = db();
        await assert.rejects(() => createLinkAgreement({ ...base, costMode: 'PER_M3', flatRate: 0 }, d), (e: any) => e.statusCode === 400);
        await assert.rejects(() => createLinkAgreement({ ...base, costMode: 'PER_KG', flatRate: 0 }, d), (e: any) => e.statusCode === 400);
        await createLinkAgreement({ ...base, costMode: 'PER_M3', flatRate: 0, ratePerM3: 120.5 }, d);
    });

    it('transportador, tipo de veículo e rota repetida ativa: erros claros', async () => {
        const noLink = db().d; noLink.link.findUnique = async () => null;
        await assert.rejects(() => createLinkAgreement(base, noLink), (e: any) => e.statusCode === 404);
        const noVehicle = db().d; noVehicle.vehicleType.findUnique = async () => null;
        await assert.rejects(() => createLinkAgreement(base, noVehicle), (e: any) => e.statusCode === 400);
        await assert.rejects(() => createLinkAgreement(base, db({ linkActive: { id: 'x' } }).d), (e: any) => e.statusCode === 409);
    });

    it('encerrar vigência desativa só se estiver ativo (compare-and-swap); já encerrado é 409', async () => {
        const { d, calls } = db();
        await closeLinkAgreement('a1', d);
        assert.deepEqual(calls.linkUpdate[0].where, { id: 'a1', active: true });
        assert.deepEqual(calls.linkUpdate[0].data, { active: false });
        await assert.rejects(() => closeLinkAgreement('a1', db({ updateCount: 0 }).d), (e: any) => e.statusCode === 409);
    });

    it('lista com filtro de ativos', async () => {
        let where: any;
        const { d } = db();
        d.linkPricingAgreement.findMany = async (a: any) => { where = a.where; return []; };
        await listLinkAgreements({ active: true, linkId: 'l1' }, d);
        assert.deepEqual(where, { active: true, linkId: 'l1' });
    });
});

describe('comissão do hub (HubCommissionAgreement)', () => {
    it('cria com taxa por pedido e % do frete', async () => {
        const { d, calls } = db();
        await createHubAgreement({ hubId: 'h1', handlingFeePerOrder: 12.345, percentOfFreight: 8 }, d);
        assert.equal(calls.hubCreate[0].handlingFeePerOrder, 12.35);
        assert.equal(calls.hubCreate[0].percentOfFreight, 8);
    });

    it('exige taxa ou percentual; percentual de 0 a 100', async () => {
        const { d } = db();
        await assert.rejects(() => createHubAgreement({ hubId: 'h1', handlingFeePerOrder: 0 }, d), (e: any) => e.statusCode === 400);
        await assert.rejects(() => createHubAgreement({ hubId: 'h1', handlingFeePerOrder: 0, percentOfFreight: 120 }, d), (e: any) => e.statusCode === 400);
    });

    it('um acordo ativo por hub: segundo é 409 (o cálculo usa o primeiro ativo)', async () => {
        await assert.rejects(() => createHubAgreement({ hubId: 'h1', handlingFeePerOrder: 5 }, db({ hubActive: { id: 'x' } }).d), (e: any) => e.statusCode === 409);
    });

    it('hub inexistente: 404; encerrar: CAS', async () => {
        const noHub = db().d; noHub.hub.findUnique = async () => null;
        await assert.rejects(() => createHubAgreement({ hubId: 'h1', handlingFeePerOrder: 5 }, noHub), (e: any) => e.statusCode === 404);
        const { d, calls } = db();
        await closeHubAgreement('c1', d);
        assert.deepEqual(calls.hubUpdate[0].where, { id: 'c1', active: true });
        await assert.rejects(() => closeHubAgreement('c1', db({ updateCount: 0 }).d), (e: any) => e.statusCode === 409);
    });

    it('lista', async () => {
        const { d } = db({ hubRows: [{ id: 'c1' }] });
        assert.equal((await listHubAgreements({}, d)).length, 1);
    });
});
