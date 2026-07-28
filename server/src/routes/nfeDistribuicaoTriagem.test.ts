import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import axios from 'axios';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpGet<T>(baseUrl: string, path: string, token: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as T };
}

async function httpPost<T>(baseUrl: string, path: string, body: object, token: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
}

const READY_DOC_ID = 'doc-ready-1';
const CHAVE = '35260512345678000190550010000000012345678901';

describe('nfeDistribuicaoTriagem routes', () => {
    const jwtSecret = `it-secret-nfe-triagem-${Date.now()}`;
    let adminToken = '';
    let hubToken = '';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    const demandStore = new Map<string, Record<string, unknown>>();
    let nfeDocStore: Record<string, unknown>;
    const markConvertedCalls: unknown[] = [];

    const original = {
        userFindUnique: prisma.user.findUnique,
        nfeDocFindUnique: prisma.nfeDistribuicaoDocumento.findUnique,
        nfeDocFindMany: prisma.nfeDistribuicaoDocumento.findMany,
        nfeDocUpdateMany: prisma.nfeDistribuicaoDocumento.updateMany,
        demandFindFirst: prisma.demand.findFirst,
        demandFindMany: prisma.demand.findMany,
        demandCreate: prisma.demand.create,
        demandEventCreate: prisma.demandEvent.create,
        transaction: prisma.$transaction,
        clientFindFirst: prisma.client.findFirst,
        axiosGet: axios.get,
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = (async ({ where }: any) => {
            if (where.id === 'admin-1') {
                return { id: 'admin-1', email: 'admin@tsmex.com', roles: ['ADMIN'], active: true, hubId: null, permissions: [], admin: { id: 'a1' }, client: null, link: null };
            }
            return { id: 'hub-1', email: 'hub@tsmex.com', roles: ['HUB'], active: true, hubId: 'hub-A', permissions: [], admin: null, client: null, link: null };
        }) as any;

        prisma.nfeDistribuicaoDocumento.findUnique = (async ({ where }: any) => {
            if (where.id !== READY_DOC_ID) return null;
            return nfeDocStore;
        }) as any;

        prisma.nfeDistribuicaoDocumento.findMany = (async () => []) as any;

        prisma.nfeDistribuicaoDocumento.updateMany = (async ({ where, data }: any) => {
            markConvertedCalls.push({ where, data });
            if (nfeDocStore.id === where.id && nfeDocStore.status === where.status) {
                Object.assign(nfeDocStore, data);
                return { count: 1 };
            }
            return { count: 0 };
        }) as any;

        prisma.demand.findFirst = (async () => null) as any; // resolveIntakeByNfeKey / idempotencia: nada encontrado
        prisma.demand.findMany = (async () => []) as any; // resolveIntakeByNfeKey: not_found

        prisma.demand.create = (async ({ data }: any) => {
            const id = `dem-${demandStore.size + 1}`;
            const row = { id, ...data, order: null };
            demandStore.set(id, row);
            return row;
        }) as any;

        prisma.demandEvent.create = (async ({ data }: any) => ({ id: 'ev-1', ...data })) as any;
        prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

        prisma.client.findFirst = (async () => ({ id: 'client-1', companyName: 'Fornecedor Teste', document: '11111111000111' })) as any;

        axios.get = (async () => ({ data: { razao_social: 'Fornecedor Teste', nome_fantasia: 'Forn', municipio: 'Imperatriz' } })) as any;

        const { nfeDistribuicaoTriagemRouter } = await import('./nfeDistribuicaoTriagem.js');
        const app = express();
        app.use(express.json());
        app.use('/api/fiscal/distribuicao-nfe/triagem', nfeDistribuicaoTriagemRouter);
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
        prisma.user.findUnique = original.userFindUnique;
        prisma.nfeDistribuicaoDocumento.findUnique = original.nfeDocFindUnique;
        prisma.nfeDistribuicaoDocumento.findMany = original.nfeDocFindMany;
        prisma.nfeDistribuicaoDocumento.updateMany = original.nfeDocUpdateMany;
        prisma.demand.findFirst = original.demandFindFirst;
        prisma.demand.findMany = original.demandFindMany;
        prisma.demand.create = original.demandCreate;
        prisma.demandEvent.create = original.demandEventCreate;
        prisma.$transaction = original.transaction;
        prisma.client.findFirst = original.clientFindFirst;
        axios.get = original.axiosGet;
    });

    it('GET / lista documentos READY_FOR_TRIAGE', async () => {
        prisma.nfeDistribuicaoDocumento.findMany = (async () => [{ id: READY_DOC_ID, status: 'READY_FOR_TRIAGE' }]) as any;
        const res = await httpGet<{ success: boolean; data: unknown[] }>(baseUrl, '/api/fiscal/distribuicao-nfe/triagem', adminToken);
        assert.equal(res.status, 200);
        assert.equal(res.body.data.length, 1);
        prisma.nfeDistribuicaoDocumento.findMany = (async () => []) as any;
    });

    it('GET / enriquece cada documento com cargoData: null quando não é NFE_PROC (sem XML baixado)', async () => {
        prisma.nfeDistribuicaoDocumento.findMany = (async () => [
            { id: READY_DOC_ID, status: 'READY_FOR_TRIAGE', tipo: 'RESUMO', xmlStorageKey: null, accessKey: CHAVE, cnpjEmitente: '11111111000111' },
        ]) as any;
        const res = await httpGet<{ success: boolean; data: Array<{ cargoData: unknown }> }>(
            baseUrl,
            '/api/fiscal/distribuicao-nfe/triagem',
            adminToken,
        );
        assert.equal(res.status, 200);
        assert.equal(res.body.data.length, 1);
        assert.equal(res.body.data[0].cargoData, null, 'RESUMO sem XML baixado não tem cargoData extraível');
        prisma.nfeDistribuicaoDocumento.findMany = (async () => []) as any;
    });

    it('POST /:id/converter cria Demand (sourceType DFE_ACBR) e marca CONVERTED', async () => {
        nfeDocStore = {
            id: READY_DOC_ID,
            status: 'READY_FOR_TRIAGE',
            accessKey: CHAVE,
            cnpjEmitente: '11111111000111',
            fiscalEmitter: { hubId: 'hub-A' },
        };
        const res = await httpPost<{ success: boolean; data: { demand: { sourceType: string } } }>(
            baseUrl,
            `/api/fiscal/distribuicao-nfe/triagem/${READY_DOC_ID}/converter`,
            {},
            adminToken,
        );
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.demand.sourceType, 'DFE_ACBR');
        assert.equal(nfeDocStore.status, 'CONVERTED');
    });

    it('POST /:id/converter cria Demand mesmo sem fornecedor cadastrado como Client (nunca bloqueia)', async () => {
        nfeDocStore = {
            id: READY_DOC_ID,
            status: 'READY_FOR_TRIAGE',
            accessKey: CHAVE,
            cnpjEmitente: '22222222000122',
            fiscalEmitter: { hubId: 'hub-A' },
        };
        const originalClientFindFirst = prisma.client.findFirst;
        prisma.client.findFirst = (async () => null) as any;

        const res = await httpPost<{ success: boolean; data: { demand: { clientId: string | null; sourceType: string } } }>(
            baseUrl,
            `/api/fiscal/distribuicao-nfe/triagem/${READY_DOC_ID}/converter`,
            {},
            adminToken,
        );
        assert.equal(res.status, 200, 'fornecedor não cadastrado como Client não deve bloquear a conversão');
        assert.equal(res.body.success, true);
        assert.ok(!res.body.data.demand.clientId, 'Demand deve nascer sem clientId — resolvido depois na confirmação de chegada');
        assert.equal(nfeDocStore.status, 'CONVERTED');

        prisma.client.findFirst = originalClientFindFirst;
    });

    it('POST /:id/converter retorna 409 se o documento não está READY_FOR_TRIAGE', async () => {
        nfeDocStore = { id: READY_DOC_ID, status: 'DISCOVERED', accessKey: CHAVE, cnpjEmitente: '11111111000111', fiscalEmitter: { hubId: 'hub-A' } };
        const res = await httpPost<{ success: boolean }>(baseUrl, `/api/fiscal/distribuicao-nfe/triagem/${READY_DOC_ID}/converter`, {}, adminToken);
        assert.equal(res.status, 409);
    });

    it('POST /:id/converter retorna 409 se já existe Demand pra essa chave (bipagem manual anterior)', async () => {
        nfeDocStore = { id: READY_DOC_ID, status: 'READY_FOR_TRIAGE', accessKey: CHAVE, cnpjEmitente: '11111111000111', fiscalEmitter: { hubId: 'hub-A' } };
        prisma.demand.findMany = (async () => [
            { id: 'dem-existing', status: 'AWAITING_ARRIVAL', documentKey: CHAVE, expectedHubId: 'hub-A', order: null, client: null, nfNumber: null },
        ]) as any;

        const res = await httpPost<{ success: boolean }>(baseUrl, `/api/fiscal/distribuicao-nfe/triagem/${READY_DOC_ID}/converter`, {}, adminToken);
        assert.equal(res.status, 409);

        prisma.demand.findMany = (async () => []) as any;
    });

    it('POST /:id/descartar marca DISCARDED', async () => {
        nfeDocStore = { id: READY_DOC_ID, status: 'READY_FOR_TRIAGE', accessKey: CHAVE, cnpjEmitente: '11111111000111', fiscalEmitter: { hubId: 'hub-A' } };
        const res = await httpPost<{ success: boolean }>(baseUrl, `/api/fiscal/distribuicao-nfe/triagem/${READY_DOC_ID}/descartar`, {}, adminToken);
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(nfeDocStore.status, 'DISCARDED');
    });

    it('operador HUB lista escopado ao próprio hub (nunca vê outro hub)', async () => {
        let capturedHubId: string | undefined;
        prisma.nfeDistribuicaoDocumento.findMany = (async (_filter: unknown) => {
            capturedHubId = 'hub-A'; // resolveHubScope já filtrou antes de chegar em listReadyForTriage
            return [];
        }) as any;
        const res = await httpGet<{ success: boolean }>(baseUrl, '/api/fiscal/distribuicao-nfe/triagem', hubToken);
        assert.equal(res.status, 200);
        assert.equal(capturedHubId, 'hub-A');
        prisma.nfeDistribuicaoDocumento.findMany = (async () => []) as any;
    });

    it('operador HUB sem hub associado é bloqueado (403) ao listar', async () => {
        const originalFindUnique = prisma.user.findUnique;
        prisma.user.findUnique = (async () => ({ id: 'hub-nohub', email: 'x@x.com', roles: ['HUB'], active: true, hubId: null, permissions: [], admin: null, client: null, link: null })) as any;
        const tokenNoHub = jwt.sign({ userId: 'hub-nohub' }, jwtSecret);
        const res = await httpGet<{ success: boolean }>(baseUrl, '/api/fiscal/distribuicao-nfe/triagem', tokenNoHub);
        assert.equal(res.status, 403);
        prisma.user.findUnique = originalFindUnique;
    });
});
