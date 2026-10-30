import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { orderServiceStartRouter, serviceStartBlocked } from './orderServiceStart.js';

describe('service-start', () => {
    let server: ReturnType<express.Express['listen']>;
    let baseUrl: string;
    let order: any;
    let roles: string[];
    let notes: any[];
    const originals = { transaction: prisma.$transaction, user: prisma.user.findUnique };
    const oldSecret = process.env.JWT_SECRET;
    const secret = 'w8-test-only';
    before(async () => {
        process.env.JWT_SECRET = secret;
        prisma.user.findUnique = (async () => ({ id: 'u', active: true, roles, hubId: 'h1' })) as any;
        const app = express(); app.use(express.json());
        app.use('/orders/:id/service-start', orderServiceStartRouter); app.use(errorHandler);
        server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    beforeEach(() => {
        roles = ['HUB']; notes = [];
        order = { id: 'o1', currentHubId: 'h1', remetentePerson: { city: 'Guaramirim', state: 'SC', cityIbgeCode: '4206504' }, freightCalculations: [
            { id: 'c1', documentType: 'CTE', status: 'CALCULATED', originCity: 'Guaramirim, SC', destCity: 'São Luís, MA', cfop: '6932', fiscalEmitter: { defaultCteCfop: '6353', person: { state: 'SP' } } },
        ] };
        const tx = { $queryRaw: async () => [], order: { findUnique: async () => order, update: async ({ data }: any) => Object.assign(order, data) },
            hub: { findUnique: async () => ({ city: 'Guarulhos', state: 'SP', cityIbgeCode: '3518800' }) },
            orderFreightCalculation: { update: async ({ where, data }: any) => Object.assign(order.freightCalculations.find((c: any) => c.id === where.id), data) },
            orderHistory: { create: async ({ data }: any) => notes.push(data) } };
        prisma.$transaction = (async (fn: any) => fn(tx)) as any;
    });
    after(async () => { prisma.$transaction = originals.transaction; prisma.user.findUnique = originals.user;
        if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
        await new Promise<void>((resolve) => server.close(() => resolve())); });
    const patch = (mode: string) => fetch(`${baseUrl}/orders/o1/service-start`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId: 'u' }, secret)}` }, body: JSON.stringify({ mode }) });
    it('hub atual muda cidade/IBGE, corrige CFOP e registra ator', async () => {
        assert.equal((await patch('HUB')).status, 200);
        assert.equal(order.origemPrestacao, 'Guarulhos, SP'); assert.equal(order.origemIbgeCode, '3518800');
        assert.equal(order.freightCalculations[0].cfop, '6353');
        assert.match(notes[0].description, /CFOP ajustado automaticamente de 6932 para 6353/);
        assert.equal(notes[0].actorUserId, 'u');
    });
    it('coleta usa cidade e IBGE do remetente e deriva x932', async () => {
        order.freightCalculations[0].cfop = '6353';
        assert.equal((await patch('REMETENTE')).status, 200);
        assert.equal(order.origemIbgeCode, '4206504'); assert.equal(order.intakeMode, 'UNKNOWN');
        assert.equal(order.freightCalculations[0].cfop, '6932');
    });
    it('deixa rejeição corrigida no histórico, sem manter estado rejeitado', async () => {
        order.freightCalculations[0].status = 'CTE_REJECTED';
        order.freightCalculations[0].cteStatusReason = 'CFOP inválido';
        assert.equal((await patch('HUB')).status, 200);
        assert.equal(order.freightCalculations[0].status, 'CALCULATED');
        assert.equal(order.freightCalculations[0].cteStatusReason, 'CFOP inválido');
    });
    it('outro hub é recusado sem mutação', async () => {
        order.currentHubId = 'h2'; assert.equal((await patch('HUB')).status, 403); assert.equal(notes.length, 0);
    });
    it('ADMIN pode corrigir pedido de outro hub', async () => {
        roles = ['ADMIN']; order.currentHubId = 'h2'; assert.equal((await patch('HUB')).status, 200);
    });
    it('recusa cidade sem IBGE e modo inválido', async () => {
        order.remetentePerson.cityIbgeCode = null; assert.equal((await patch('REMETENTE')).status, 400);
        assert.equal((await patch('INVALID')).status, 400); assert.equal(notes.length, 0);
    });
    for (const status of ['CTE_AUTHORIZED', 'CTE_READY', 'CTE_SENT', 'CTE_PROCESSING', 'CTE_PENDING_RECONCILIATION']) {
        it(`recusa alteração com ${status}`, async () => {
            order.freightCalculations[0].status = status; assert.equal((await patch('HUB')).status, 409); assert.equal(notes.length, 0);
        });
    }
    it('bloqueia somente CT-e autorizado/em voo, permite rejeitado', () => {
        assert.equal(serviceStartBlocked([{ documentType: 'CTE', status: 'CTE_REJECTED' }]), false);
        assert.equal(serviceStartBlocked([{ documentType: 'MINUTA', status: 'MINUTA_EMITTED' }]), false);
    });
});
