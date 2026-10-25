import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

const HUB_A = '11111111-1111-4111-8111-111111111111';
const HUB_B = '22222222-2222-4222-8222-222222222222';

describe('POST /api/hub/cargo/triage/convert-all', () => {
    const jwtSecret = 'hub-cargo-triage-test-secret';
    const original = {
        jwtSecret: process.env.JWT_SECRET,
        userFindUnique: prisma.user.findUnique,
        documentFindMany: prisma.nfeDistribuicaoDocumento.findMany,
        documentFindUnique: prisma.nfeDistribuicaoDocumento.findUnique,
    };
    let server: ReturnType<express.Express['listen']>;
    let baseUrl = '';
    let queries: any[];
    let documents: Array<{ id: string }>;

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        prisma.user.findUnique = (async ({ where }: any) => ({
            id: where.id,
            email: 'operador@tsmex.com',
            active: true,
            roles: where.id === 'admin' ? ['ADMIN'] : where.id === 'client' ? ['CLIENT'] : ['HUB'],
            hubId: where.id === 'admin' ? null : HUB_A,
            permissions: where.id === 'view-only' ? ['pedidos'] : ['entrada'],
        })) as any;
        prisma.nfeDistribuicaoDocumento.findMany = (async (args: unknown) => {
            queries.push(args);
            return documents;
        }) as any;
        prisma.nfeDistribuicaoDocumento.findUnique = (async ({ where }: any) => ({
            id: where.id,
            status: 'DISCOVERED',
        })) as any;

        const { hubCargoRouter } = await import('./hubCargo.js');
        const app = express();
        app.use(express.json());
        app.use('/api/hub/cargo', hubCargoRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    beforeEach(() => {
        queries = [];
        documents = [];
    });

    after(async () => {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        prisma.user.findUnique = original.userFindUnique;
        prisma.nfeDistribuicaoDocumento.findMany = original.documentFindMany;
        prisma.nfeDistribuicaoDocumento.findUnique = original.documentFindUnique;
        if (original.jwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = original.jwtSecret;
    });

    async function post(userId?: string, body: object = {}) {
        const response = await fetch(`${baseUrl}/api/hub/cargo/triage/convert-all`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(userId ? { authorization: `Bearer ${jwt.sign({ userId }, jwtSecret)}` } : {}),
            },
            body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() as any };
    }

    it('HUB com entrada processa seu emitente e ignora tentativa de selecionar outro hub', async () => {
        const response = await post('hub', { hubId: HUB_B });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { success: true, data: { converted: 0, failed: [] } });
        assert.deepEqual(queries[0].where, { status: 'READY_FOR_TRIAGE', fiscalEmitter: { hubId: HUB_A } });
    });

    it('ADMIN escolhe um hub explicitamente e recebe as falhas individuais no contrato do lote', async () => {
        documents = [{ id: 'changed-during-retry' }];
        const response = await post('admin', { hubId: HUB_B });
        assert.equal(response.status, 200);
        assert.equal(response.body.data.converted, 0);
        assert.deepEqual(response.body.data.failed, [{
            id: 'changed-during-retry',
            message: 'Documento não está pronto para preparação. Confira o XML da NF-e.',
        }]);
        assert.deepEqual(queries[0].where, { status: 'READY_FOR_TRIAGE', fiscalEmitter: { hubId: HUB_B } });
    });

    it('bloqueia HUB sem canReceive antes de consultar a fila', async () => {
        const response = await post('view-only');
        assert.equal(response.status, 403);
        assert.equal(queries.length, 0);
    });

    it('bloqueia papéis diferentes de ADMIN/HUB', async () => {
        const response = await post('client');
        assert.equal(response.status, 403);
        assert.equal(queries.length, 0);
    });

    it('exige autenticação', async () => {
        const response = await post();
        assert.equal(response.status, 401);
        assert.equal(queries.length, 0);
    });

    it('não permite que ADMIN processe todos os emitentes sem hub selecionado', async () => {
        const response = await post('admin');
        assert.equal(response.status, 400);
        assert.equal(queries.length, 0);
    });

    it('valida o hub solicitado antes da conversão', async () => {
        const response = await post('admin', { hubId: 'hub-inválido' });
        assert.equal(response.status, 400);
        assert.equal(queries.length, 0);
    });
});
