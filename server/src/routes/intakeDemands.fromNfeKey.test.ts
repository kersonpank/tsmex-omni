import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import axios from 'axios';

import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpPostJson<T>(baseUrl: string, path: string, token: string, payload: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() as T };
}

describe('POST /intake/demands/from-nfe-key — sem match ACBr (regressão)', () => {
    const jwtSecret = `it-secret-fromnfekey-${Date.now()}`;
    const hubId = '550e8400-e29b-41d4-a716-446655440099';
    const clientId = '550e8400-e29b-41d4-a716-446655440001';
    const chave = '35260512345678000190550010000000012345678901';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    const store = { demands: new Map<string, Record<string, unknown>>() };

    const original = {
        userFindUnique: prisma.user.findUnique,
        demandFindFirst: prisma.demand.findFirst,
        demandCreate: prisma.demand.create,
        demandEventCreate: prisma.demandEvent.create,
        transaction: prisma.$transaction,
        nfeDistribuicaoDocumentoFindUnique: prisma.nfeDistribuicaoDocumento.findUnique,
        fiscalEmitterFindFirst: prisma.fiscalEmitter.findFirst,
        axiosGet: axios.get,
    };
    let bootstrapStarted = false;

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = ((async () => ({
            id: 'hub-user-1',
            email: 'hub@tsmex.com',
            roles: ['HUB'],
            active: true,
            hubId,
            permissions: [],
            admin: null,
            client: null,
            link: null,
        })) as unknown) as typeof prisma.user.findUnique;

        // Nenhum documento descoberto pela Distribuição NF-e pra essa chave — caminho majoritário.
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => null) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;
        prisma.fiscalEmitter.findFirst = (async () => {
            bootstrapStarted = true;
            return new Promise(() => {});
        }) as unknown as typeof prisma.fiscalEmitter.findFirst;

        prisma.demand.findFirst = (async () => null) as unknown as typeof prisma.demand.findFirst;
        prisma.demand.create = ((async ({ data }: { data: Record<string, unknown> }) => {
            const id = `dem-${store.demands.size + 1}`;
            const row = { id, ...data, order: null };
            store.demands.set(id, row);
            return row;
        }) as unknown) as typeof prisma.demand.create;
        prisma.demandEvent.create = (async () => ({ id: 'ev-1' })) as unknown as typeof prisma.demandEvent.create;
        prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as unknown as typeof prisma.$transaction;

        axios.get = (async () => ({
            data: { razao_social: 'Fornecedor Teste LTDA', nome_fantasia: 'Forn', municipio: 'Imperatriz' },
        })) as unknown as typeof axios.get;

        const { intakeDemandsRouter } = await import('./intakeDemands.js');
        const app = express();
        app.use(express.json());
        app.use('/api/intake', intakeDemandsRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.demand.findFirst = original.demandFindFirst;
        prisma.demand.create = original.demandCreate;
        prisma.demandEvent.create = original.demandEventCreate;
        prisma.$transaction = original.transaction;
        prisma.nfeDistribuicaoDocumento.findUnique = original.nfeDistribuicaoDocumentoFindUnique;
        prisma.fiscalEmitter.findFirst = original.fiscalEmitterFindFirst;
        axios.get = original.axiosGet;
    });

    it('cria Demand com placeholders quando não há documento ACBr pra chave (comportamento atual preservado)', async () => {
        const token = jwt.sign({ userId: 'hub-user-1' }, jwtSecret);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const res = await Promise.race([
            httpPostJson<{ success: boolean; data: Record<string, unknown> }>(baseUrl, '/api/intake/demands/from-nfe-key', token, { chave, clientId }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('bootstrap fiscal bloqueou a resposta operacional')), 10_000); }),
        ]).finally(() => { if (timer) clearTimeout(timer); });

        assert.equal(res.status, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.nfValue, 0.01);
        assert.equal(res.body.data.weight, 1);
        assert.equal(res.body.data.commodity, 'A definir');
        assert.equal(bootstrapStarted, true);
    });
});
