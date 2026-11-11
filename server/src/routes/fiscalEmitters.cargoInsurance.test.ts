import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

describe('fiscalEmitters routes — seguro da carga', () => {
    const jwtSecret = `it-secret-fiscal-insurance-${Date.now()}`;
    const previousSecret = process.env.JWT_SECRET;
    const original = {
        userFindUnique: prisma.user.findUnique,
        fiscalEmitterFindUnique: prisma.fiscalEmitter.findUnique,
        fiscalEmitterUpdate: prisma.fiscalEmitter.update,
        checkpointFindUnique: prisma.fiscalDistribuicaoCheckpoint.findUnique,
    };
    let emitter: Record<string, unknown> = {};
    let updateCalls: Array<{ data: Record<string, unknown> }> = [];
    let baseUrl = '';
    let token = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        prisma.user.findUnique = (async ({ where }: any) => ({
            id: where.id, email: 'a@tsmex.test', roles: ['ADMIN'], active: true, hubId: null, permissions: [], admin: { id: 'admin-1' }, client: null, link: null,
        })) as any;
        prisma.fiscalEmitter.findUnique = (async () => emitter) as any;
        prisma.fiscalEmitter.update = (async (args: any) => {
            updateCalls.push(args);
            emitter = { ...emitter, ...args.data };
            return emitter;
        }) as any;
        prisma.fiscalDistribuicaoCheckpoint.findUnique = (async () => null) as any;
        const { fiscalEmittersRouter } = await import('./fiscalEmitters.js');
        const app = express();
        app.use(express.json());
        app.use('/api/fiscal-emitters', fiscalEmittersRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('porta');
        baseUrl = `http://127.0.0.1:${address.port}`;
        token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
    });

    beforeEach(() => {
        updateCalls = [];
        emitter = { id: 'fe-1', personId: 'p-1', person: { documentType: 'CNPJ', document: '12345678000199', legalName: 'T' }, provider: 'SIMULATED', environment: 'HOMOLOGACAO' };
    });

    after(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
        prisma.user.findUnique = original.userFindUnique;
        prisma.fiscalEmitter.findUnique = original.fiscalEmitterFindUnique;
        prisma.fiscalEmitter.update = original.fiscalEmitterUpdate;
        prisma.fiscalDistribuicaoCheckpoint.findUnique = original.checkpointFindUnique;
        if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    });

    const patch = async (body: object) => {
        const response = await fetch(`${baseUrl}/api/fiscal-emitters/fe-1`, {
            method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() as any };
    };

    it('grava e devolve seguradora, CNPJ só com dígitos e apólice', async () => {
        const res = await patch({ cargoInsurerName: ' Porto Seguro ', cargoInsurerCnpj: '61.198.164/0001-60', cargoInsurancePolicyNumber: 'APL-9' });
        assert.equal(res.status, 200);
        assert.deepEqual(updateCalls[0].data, { cargoInsurerName: 'Porto Seguro', cargoInsurerCnpj: '61198164000160', cargoInsurancePolicyNumber: 'APL-9' });
        assert.equal(res.body.data.cargoInsurerName, 'Porto Seguro');
        assert.equal(res.body.data.cargoInsurerCnpj, '61198164000160');
        assert.equal(res.body.data.cargoInsurancePolicyNumber, 'APL-9');
    });

    it('recusa CNPJ da seguradora que não tem 14 dígitos e não grava', async () => {
        const res = await patch({ cargoInsurerCnpj: '123' });
        assert.equal(res.status, 400);
        assert.match(res.body.error, /14 dígitos/);
        assert.equal(updateCalls.length, 0);
    });

    it('campo vazio limpa o valor', async () => {
        const res = await patch({ cargoInsurerName: '', cargoInsurerCnpj: '' });
        assert.equal(res.status, 200);
        assert.deepEqual(updateCalls[0].data, { cargoInsurerName: null, cargoInsurerCnpj: null });
    });

    it('averbação AT&M: cifra a senha, não a devolve e senha vazia não altera', async () => {
        process.env.FISCAL_SECRET_KEY ||= 'test-secret-test-secret-test-secret';
        const res = await patch({ averbacaoProvider: 'ATM', atmCode: ' COD ', atmUser: 'usr', atmPassword: 'senha-secreta', atmEnvironment: 'PRODUCAO', cargoTracked: true, cargoLoadUnloadCovered: true });
        assert.equal(res.status, 200);
        const data = updateCalls[0].data as Record<string, unknown>;
        assert.match(String(data.atmPasswordEncrypted), /^v1:/);
        assert.ok(!JSON.stringify(data).includes('senha-secreta'));
        assert.equal(data.atmCode, 'COD');
        assert.equal(data.cargoTracked, true);
        assert.equal(res.body.data.hasAtmPassword, true);
        assert.equal(res.body.data.atmPasswordEncrypted, undefined);
        assert.ok(!JSON.stringify(res.body).includes('senha-secreta'));

        updateCalls = [];
        const blank = await patch({ atmUser: 'outro', atmPassword: '' });
        assert.equal(blank.status, 200);
        assert.equal('atmPasswordEncrypted' in (updateCalls[0].data as object), false);
        assert.equal(blank.body.data.hasAtmPassword, true);
    });
});
