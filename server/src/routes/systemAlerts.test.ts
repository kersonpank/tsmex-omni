import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpPost<T>(baseUrl: string, path: string, token: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: (await response.json()) as T };
}

// Nota: não testamos aqui o caminho feliz (categoria bate → `getDistribuicaoNfeQueue().resume()`
// é chamado de verdade), pois `getDistribuicaoNfeQueue()`/`getCteEmissionQueue()` constroem uma
// `Queue` BullMQ real sob demanda (mesma razão documentada em `cteEmissionQueue.ts`) — abrir
// essa conexão Redis de verdade num teste de rota deixaria a suíte acoplada à infra e sujeita a
// handles pendurados. Os dois testes abaixo cobrem os ramos de validação que retornam ANTES de
// tocar a fila, que é o que de fato precisa de cobertura nesta rota (o comportamento da fila em
// si — pause/resume — é responsabilidade do BullMQ, não deste projeto).
describe('systemAlerts routes — resume-distribuicao-nfe-queue (validação)', () => {
    const jwtSecret = `it-secret-system-alerts-${Date.now()}`;
    let token = '';
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        alertFindUnique: prisma.systemAlert.findUnique,
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = (async () => ({
            id: 'admin-user-1',
            email: 'admin@tsmex.com',
            roles: ['ADMIN'],
            active: true,
            hubId: null,
            permissions: [],
            admin: { id: 'adm-1' },
            client: null,
            link: null,
        })) as any;

        const { systemAlertsRouter } = await import('./systemAlerts.js');
        const app = express();
        app.use(express.json());
        app.use('/api/system-alerts', systemAlertsRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${addr.port}`;

        token = jwt.sign({ userId: 'admin-user-1' }, jwtSecret);
    });

    after(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.systemAlert.findUnique = original.alertFindUnique;
    });

    it('retorna 404 para alerta inexistente', async () => {
        prisma.systemAlert.findUnique = (async () => null) as any;
        const res = await httpPost<{ success: boolean }>(baseUrl, '/api/system-alerts/nao-existe/resume-distribuicao-nfe-queue', token);
        assert.equal(res.status, 404);
        assert.equal(res.body.success, false);
    });

    it('retorna 400 quando a categoria do alerta não é FISCAL_DISTRIBUICAO_NFE_QUOTA', async () => {
        prisma.systemAlert.findUnique = (async () => ({
            id: 'alert-1',
            category: 'FISCAL_PROVIDER_QUOTA',
            status: 'OPEN',
        })) as any;
        const res = await httpPost<{ success: boolean }>(baseUrl, '/api/system-alerts/alert-1/resume-distribuicao-nfe-queue', token);
        assert.equal(res.status, 400);
        assert.equal(res.body.success, false);
    });
});
