import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { resolveIntakeByNfeKey } from './resolveIntakeByNfeKey.js';

const HUB_A = 'hub-a';
const HUB_B = 'hub-b';
/** Chave 44d válida (mod 55) — CNPJ emitente 12345678000190 */
const CHAVE44 = '35260512345678000190550010000000012345678901';

function demandRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'd1',
        status: 'AWAITING_ARRIVAL',
        nfNumber: '100',
        documentKey: CHAVE44,
        expectedHubId: HUB_A,
        manifestId: null,
        client: { id: 'c1', companyName: 'Cliente', document: '12345678000190' },
        order: null,
        ...overrides,
    };
}

describe('resolveIntakeByNfeKey', () => {
    const origFindMany = prisma.demand.findMany.bind(prisma.demand);
    const origDistribuicaoFindUnique = prisma.nfeDistribuicaoDocumento.findUnique.bind(prisma.nfeDistribuicaoDocumento);

    afterEach(() => {
        prisma.demand.findMany = origFindMany;
        prisma.nfeDistribuicaoDocumento.findUnique = origDistribuicaoFindUnique;
    });

    it('menos de 8 dígitos → invalid_key', async () => {
        let calledDistribuicao = false;
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => {
            calledDistribuicao = true;
            return null;
        }) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;

        const result = await resolveIntakeByNfeKey({
            chave: '123',
            actingRoles: ['HUB'],
            actingHubId: HUB_A,
        });
        assert.equal(result.resolution, 'invalid_key');
        assert.equal(calledDistribuicao, false);
    });

    it('sem demanda → not_found com cnpjEmit na chave 44d, sem distribuicaoMatch quando não há documento ACBr', async () => {
        prisma.demand.findMany = (async () => []) as unknown as typeof prisma.demand.findMany;
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => null) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;

        const result = await resolveIntakeByNfeKey({
            chave: CHAVE44,
            actingRoles: ['HUB'],
            actingHubId: HUB_A,
        });
        assert.equal(result.resolution, 'not_found');
        assert.ok(result.cnpjEmit && result.cnpjEmit.length === 14);
        assert.equal(result.distribuicaoMatch, undefined);
    });

    it('sem demanda mas com NfeDistribuicaoDocumento já descoberto → anexa distribuicaoMatch', async () => {
        prisma.demand.findMany = (async () => []) as unknown as typeof prisma.demand.findMany;
        prisma.nfeDistribuicaoDocumento.findUnique = (async ({ where }: any) => {
            assert.equal(where.accessKey, CHAVE44);
            return {
                id: 'doc-1',
                status: 'READY_FOR_TRIAGE',
                tipo: 'NFE_PROC',
                xmlStorageKey: 'nfe-distribuicao/x/xml/arquivo.xml',
            };
        }) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;

        const result = await resolveIntakeByNfeKey({
            chave: CHAVE44,
            actingRoles: ['HUB'],
            actingHubId: HUB_A,
        });
        assert.equal(result.resolution, 'not_found');
        assert.deepEqual(result.distribuicaoMatch, {
            id: 'doc-1',
            status: 'READY_FOR_TRIAGE',
            tipo: 'NFE_PROC',
            xmlStorageKey: 'nfe-distribuicao/x/xml/arquivo.xml',
        });
    });

    it('Demand já existe (awaiting_arrival) → não consulta NfeDistribuicaoDocumento', async () => {
        let calledDistribuicao = false;
        prisma.demand.findMany = (async () => [demandRow()]) as unknown as typeof prisma.demand.findMany;
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => {
            calledDistribuicao = true;
            return null;
        }) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;

        const result = await resolveIntakeByNfeKey({
            chave: CHAVE44,
            actingRoles: ['HUB'],
            actingHubId: HUB_A,
        });
        assert.equal(result.resolution, 'awaiting_arrival');
        assert.equal(calledDistribuicao, false);
    });

    it('aguardando chegada no hub → awaiting_arrival', async () => {
        prisma.demand.findMany = (async () => [demandRow()]) as unknown as typeof prisma.demand.findMany;

        const result = await resolveIntakeByNfeKey({
            chave: CHAVE44,
            actingRoles: ['HUB'],
            actingHubId: HUB_A,
        });
        assert.equal(result.resolution, 'awaiting_arrival');
        assert.equal(result.demand?.id, 'd1');
    });

    it('com Order → already_received', async () => {
        prisma.demand.findMany = (async () => [
            demandRow({
                status: 'AT_HUB',
                order: { id: 'order-1', status: 'AT_HUB' },
            }),
        ]) as unknown as typeof prisma.demand.findMany;

        const result = await resolveIntakeByNfeKey({
            chave: CHAVE44,
            actingRoles: ['HUB'],
            actingHubId: HUB_A,
        });
        assert.equal(result.resolution, 'already_received');
        assert.equal(result.orderId, 'order-1');
    });

    it('hub diferente → wrong_hub', async () => {
        prisma.demand.findMany = (async () => [
            demandRow({ expectedHubId: HUB_B }),
        ]) as unknown as typeof prisma.demand.findMany;

        const result = await resolveIntakeByNfeKey({
            chave: CHAVE44,
            actingRoles: ['HUB'],
            actingHubId: HUB_A,
        });
        assert.equal(result.resolution, 'wrong_hub');
    });

    it('status terminal sem order → blocked', async () => {
        prisma.demand.findMany = (async () => [
            demandRow({ status: 'DELIVERED' }),
        ]) as unknown as typeof prisma.demand.findMany;

        const result = await resolveIntakeByNfeKey({
            chave: CHAVE44,
            actingRoles: ['HUB'],
            actingHubId: HUB_A,
        });
        assert.equal(result.resolution, 'blocked');
    });

    it('em manifesto → blocked', async () => {
        prisma.demand.findMany = (async () => [
            demandRow({ status: 'ASSIGNED', manifestId: 'm1' }),
        ]) as unknown as typeof prisma.demand.findMany;

        const result = await resolveIntakeByNfeKey({
            chave: CHAVE44,
            actingRoles: ['HUB'],
            actingHubId: HUB_A,
        });
        assert.equal(result.resolution, 'blocked');
    });
});
