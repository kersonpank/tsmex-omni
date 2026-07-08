import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpPost<T>(baseUrl: string, path: string, body: object, token: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    return {
        status: response.status,
        body: (await response.json()) as T,
    };
}

describe('fiscalDistribuicao routes — bootstrap-nsu (guarda FinOps)', () => {
    const jwtSecret = `it-secret-fiscal-distribuicao-${Date.now()}`;
    const fiscalEmitterId = 'fe-0000000-0000-0000-0000-000000000001';
    let token = '';
    let hubToken = '';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let checkpointUpsertCalls: unknown[] = [];

    const original = {
        userFindUnique: prisma.user.findUnique,
        fiscalEmitterFindUnique: prisma.fiscalEmitter.findUnique,
        checkpointUpsert: prisma.fiscalDistribuicaoCheckpoint.upsert,
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = (async ({ where }: any) => {
            if (where.id === 'admin-user-1') {
                return {
                    id: 'admin-user-1',
                    email: 'admin@tsmex.com',
                    roles: ['ADMIN'],
                    active: true,
                    hubId: null,
                    permissions: [],
                    admin: { id: 'adm-1' },
                    client: null,
                    link: null,
                };
            }
            return {
                id: 'hub-user-1',
                email: 'hub@tsmex.com',
                roles: ['HUB'],
                active: true,
                hubId: 'hub-1',
                permissions: [],
                admin: null,
                client: null,
                link: null,
            };
        }) as any;

        prisma.fiscalEmitter.findUnique = (async ({ where }: any) => {
            if (where.id !== fiscalEmitterId) return null;
            return {
                id: fiscalEmitterId,
                environment: 'HOMOLOGACAO',
                person: { document: '12345678000199' },
            };
        }) as any;

        prisma.fiscalDistribuicaoCheckpoint.upsert = (async (args: any) => {
            checkpointUpsertCalls.push(args);
            return { id: 'chk-1', ...args.create };
        }) as any;

        const { fiscalDistribuicaoRouter } = await import('./fiscalDistribuicao.js');
        const app = express();
        app.use(express.json());
        app.use('/api/fiscal', fiscalDistribuicaoRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;

        token = jwt.sign({ userId: 'admin-user-1' }, jwtSecret);
        hubToken = jwt.sign({ userId: 'hub-user-1' }, jwtSecret);
    });

    after(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.fiscalEmitter.findUnique = original.fiscalEmitterFindUnique;
        prisma.fiscalDistribuicaoCheckpoint.upsert = original.checkpointUpsert;
    });

    it('grava o NSU inicial direto no checkpoint (sem passar pela ACBr)', async () => {
        checkpointUpsertCalls = [];
        const res = await httpPost<{ success: boolean; data: { cpfCnpj: string; ambiente: string; ultimoNsu: string } }>(
            baseUrl,
            `/api/fiscal/distribuicao-nfe/emitters/${fiscalEmitterId}/bootstrap-nsu`,
            { nsu: '123456' },
            token,
        );

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.cpfCnpj, '12345678000199');
        assert.equal(res.body.data.ambiente, 'homologacao');
        assert.equal(res.body.data.ultimoNsu, '123456');
        assert.equal(checkpointUpsertCalls.length, 1, 'deve gravar o checkpoint exatamente uma vez, direto no banco');
    });

    it('rejeita NSU não numérico com 400', async () => {
        const res = await httpPost<{ success: boolean }>(
            baseUrl,
            `/api/fiscal/distribuicao-nfe/emitters/${fiscalEmitterId}/bootstrap-nsu`,
            { nsu: 'abc' },
            token,
        );
        assert.equal(res.status, 400);
        assert.equal(res.body.success, false);
    });

    it('retorna 404 para emitente inexistente', async () => {
        const res = await httpPost<{ success: boolean }>(
            baseUrl,
            `/api/fiscal/distribuicao-nfe/emitters/nao-existe/bootstrap-nsu`,
            { nsu: '1' },
            token,
        );
        assert.equal(res.status, 404);
        assert.equal(res.body.success, false);
    });

    it('bloqueia HUB (ação ADMIN-only, efeito financeiro direto)', async () => {
        const res = await httpPost<{ success: boolean }>(
            baseUrl,
            `/api/fiscal/distribuicao-nfe/emitters/${fiscalEmitterId}/bootstrap-nsu`,
            { nsu: '1' },
            hubToken,
        );
        assert.equal(res.status, 403);
    });
});
