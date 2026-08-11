import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { convertNfeDistribuicaoDocument } from './convertNfeDistribuicaoDocument.js';

const CHAVE = '35260512345678000190550010000000012345678901';
const DOC_ID = 'doc-ready-1';

describe('convertNfeDistribuicaoDocument', () => {
    const demandStore = new Map<string, Record<string, unknown>>();
    let nfeDocStore: Record<string, unknown> | null;

    const original = {
        nfeDocFindUnique: prisma.nfeDistribuicaoDocumento.findUnique,
        nfeDocUpdateMany: prisma.nfeDistribuicaoDocumento.updateMany,
        demandFindFirst: prisma.demand.findFirst,
        demandFindMany: prisma.demand.findMany,
        demandCreate: prisma.demand.create,
        demandEventCreate: prisma.demandEvent.create,
        transaction: prisma.$transaction,
        clientFindFirst: prisma.client.findFirst,
    };

    before(() => {
        prisma.nfeDistribuicaoDocumento.findUnique = (async ({ where }: any) => {
            if (where.id !== DOC_ID) return null;
            return nfeDocStore;
        }) as any;

        prisma.nfeDistribuicaoDocumento.updateMany = (async ({ where, data }: any) => {
            if (nfeDocStore && nfeDocStore.id === where.id && nfeDocStore.status === where.status) {
                Object.assign(nfeDocStore, data);
                return { count: 1 };
            }
            return { count: 0 };
        }) as any;

        prisma.demand.findFirst = (async () => null) as any;
        prisma.demand.findMany = (async () => []) as any; // resolveIntakeByNfeKey: not_found por padrão

        prisma.demand.create = (async ({ data }: any) => {
            const id = `dem-${demandStore.size + 1}`;
            const row = { id, ...data, order: null };
            demandStore.set(id, row);
            return row;
        }) as any;

        prisma.demandEvent.create = (async ({ data }: any) => ({ id: 'ev-1', ...data })) as any;
        prisma.$transaction = (async (fn: any) => fn(prisma)) as any;
        prisma.client.findFirst = (async () => null) as any;
    });

    after(() => {
        prisma.nfeDistribuicaoDocumento.findUnique = original.nfeDocFindUnique;
        prisma.nfeDistribuicaoDocumento.updateMany = original.nfeDocUpdateMany;
        prisma.demand.findFirst = original.demandFindFirst;
        prisma.demand.findMany = original.demandFindMany;
        prisma.demand.create = original.demandCreate;
        prisma.demandEvent.create = original.demandEventCreate;
        prisma.$transaction = original.transaction;
        prisma.client.findFirst = original.clientFindFirst;
    });

    beforeEach(() => {
        demandStore.clear();
        nfeDocStore = {
            id: DOC_ID,
            status: 'READY_FOR_TRIAGE',
            accessKey: CHAVE,
            cnpjEmitente: '11111111000111',
            tipo: 'RESUMO',
            xmlStorageKey: null,
            fiscalEmitter: { hubId: 'hub-A' },
        };
        prisma.demand.findMany = (async () => []) as any;
        prisma.client.findFirst = (async () => null) as any;
    });

    it('converte documento READY_FOR_TRIAGE em Demand (DFE_ACBR) e marca CONVERTED', async () => {
        const result = await convertNfeDistribuicaoDocument(DOC_ID);

        assert.equal(result.converted, true);
        if (result.converted) {
            assert.equal(result.demand.sourceType, 'DFE_ACBR');
            assert.equal(result.demand.expectedHubId, 'hub-A');
        }
        assert.equal(nfeDocStore!.status, 'CONVERTED');
    });

    it('não bloqueia quando o CNPJ emitente não está cadastrado como Client', async () => {
        prisma.client.findFirst = (async () => null) as any;
        const result = await convertNfeDistribuicaoDocument(DOC_ID);
        assert.equal(result.converted, true);
        if (result.converted) {
            assert.ok(!result.demand.clientId, 'Demand nasce sem clientId — resolvido depois na confirmação de chegada');
        }
    });

    it('retorna converted:false reason:not_ready quando o documento não está READY_FOR_TRIAGE', async () => {
        nfeDocStore!.status = 'DISCOVERED';
        const result = await convertNfeDistribuicaoDocument(DOC_ID);
        assert.deepEqual(result, { converted: false, reason: 'not_ready' });
    });

    it('retorna converted:false reason:already_has_demand quando já existe Demand pra chave (bipagem manual anterior)', async () => {
        prisma.demand.findMany = (async () => [
            { id: 'dem-existing', status: 'AWAITING_ARRIVAL', documentKey: CHAVE, expectedHubId: 'hub-A', order: null, client: null, nfNumber: null },
        ]) as any;
        const result = await convertNfeDistribuicaoDocument(DOC_ID);
        assert.deepEqual(result, { converted: false, reason: 'already_has_demand' });
        assert.equal(nfeDocStore!.status, 'READY_FOR_TRIAGE', 'não deve converter nem marcar o documento');
    });

    it('lança AppError 404 quando o documento não existe', async () => {
        nfeDocStore = null;
        await assert.rejects(
            () => convertNfeDistribuicaoDocument(DOC_ID),
            (err: unknown) => err instanceof AppError && err.statusCode === 404,
        );
    });
});
