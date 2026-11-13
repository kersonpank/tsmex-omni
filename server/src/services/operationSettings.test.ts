import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { getOperationSettings, updateOperationSettings } from './operationSettings.js';

describe('configurações da operação: quem troca o status do pedido à mão', () => {
    const original = {
        findUnique: prisma.operationSettings.findUnique,
        upsert: prisma.operationSettings.upsert,
    };
    afterEach(() => {
        prisma.operationSettings.findUnique = original.findUnique;
        prisma.operationSettings.upsert = original.upsert;
    });

    function mockUpsert() {
        const calls: any[] = [];
        prisma.operationSettings.upsert = (async (args: any) => {
            calls.push(args);
            return { id: 'global', updatedAt: new Date(), ...args.create };
        }) as any;
        return calls;
    }

    it('sem registro devolve o padrão (ADMIN, HUB, LINK) e não grava nada', async () => {
        const upserts = mockUpsert();
        prisma.operationSettings.findUnique = (async () => null) as any;
        const settings = await getOperationSettings();
        assert.deepEqual(settings.manualOrderStatusRoles, ['ADMIN', 'HUB', 'LINK']);
        assert.equal(settings.updatedAt, null);
        assert.equal(upserts.length, 0);
    });

    it('com registro devolve a lista gravada', async () => {
        prisma.operationSettings.findUnique = (async () => ({ id: 'global', manualOrderStatusRoles: ['ADMIN', 'HUB'], updatedAt: new Date(), updatedBy: 'u1' })) as any;
        assert.deepEqual((await getOperationSettings()).manualOrderStatusRoles, ['ADMIN', 'HUB']);
    });

    it('ADMIN é sempre incluído ao gravar, mesmo se a lista vier sem ele ou vazia', async () => {
        const upserts = mockUpsert();
        const onlyHub = await updateOperationSettings({ manualOrderStatusRoles: ['HUB'] }, 'user-1');
        assert.deepEqual(onlyHub.manualOrderStatusRoles, ['ADMIN', 'HUB']);
        assert.deepEqual(upserts[0].update, { manualOrderStatusRoles: ['ADMIN', 'HUB'], updatedBy: 'user-1' });
        assert.deepEqual(upserts[0].create, { id: 'global', manualOrderStatusRoles: ['ADMIN', 'HUB'], updatedBy: 'user-1' });

        const empty = await updateOperationSettings({ manualOrderStatusRoles: [] }, 'user-1');
        assert.deepEqual(empty.manualOrderStatusRoles, ['ADMIN']);
    });

    it('repetidos são removidos', async () => {
        mockUpsert();
        const saved = await updateOperationSettings({ manualOrderStatusRoles: ['LINK', 'ADMIN', 'LINK'] }, 'user-1');
        assert.deepEqual(saved.manualOrderStatusRoles, ['ADMIN', 'LINK']);
    });

    it('papel fora de ADMIN, HUB e LINK é recusado sem gravar', async () => {
        const upserts = mockUpsert();
        await assert.rejects(
            updateOperationSettings({ manualOrderStatusRoles: ['ADMIN', 'CLIENT'] }, 'user-1'),
            (error: any) => error.statusCode === 400 && /CLIENT/.test(error.message),
        );
        await assert.rejects(updateOperationSettings({ manualOrderStatusRoles: ['QUALQUER'] }, 'user-1'), /Papel inválido/);
        assert.equal(upserts.length, 0);
    });
});
