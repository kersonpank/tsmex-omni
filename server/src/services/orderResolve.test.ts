import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { resolveOrderByCode } from './orderResolve.js';

const prismaSnapshot = {
    orderInvoiceFindMany: prisma.orderInvoice.findMany.bind(prisma.orderInvoice),
    orderFreightCalculationFindMany: prisma.orderFreightCalculation.findMany.bind(prisma.orderFreightCalculation),
    orderFindMany: prisma.order.findMany.bind(prisma.order),
};

function restorePrismaMocks() {
    prisma.orderInvoice.findMany = prismaSnapshot.orderInvoiceFindMany;
    prisma.orderFreightCalculation.findMany = prismaSnapshot.orderFreightCalculationFindMany;
    prisma.order.findMany = prismaSnapshot.orderFindMany;
}

const baseOrder = {
    id: 'order-abc12345',
    nfNumber: '123',
    status: 'AT_HUB',
    currentHubId: 'hub-1',
    demand: { origin: 'São Paulo', destination: 'Imperatriz' },
};

describe('resolveOrderByCode', () => {
    beforeEach(() => restorePrismaMocks());
    afterEach(() => restorePrismaMocks());

    it('resolve por chave de NF-e de 44 dígitos (busca global, sem escopo de hub)', async () => {
        const key = '1'.repeat(44);
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async (args: any) => {
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode(key, 'hub-1');

        assert.equal(result.match, 'single');
        assert.equal(result.match === 'single' && result.order.id, 'order-abc12345');
        assert.deepEqual(calledWith.where, { nfKey: key });
    });

    it('cai pra cteAccessKey quando não acha por nfKey', async () => {
        const key = '2'.repeat(44);
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async (args: any) => {
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode(key, 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { cteAccessKey: key });
    });

    it('busca por número (nfNumber/cteNumber/minutaNumber) restrito ao hub quando código não tem 44 dígitos', async () => {
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async (args: any) => {
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode('123', 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { nfNumber: '123', order: { status: 'AT_HUB', currentHubId: 'hub-1' } });
    });

    it('retorna match "multiple" quando o número resolve mais de um pedido (não é ambíguo silencioso)', async () => {
        const other = { ...baseOrder, id: 'order-def67890' };
        prisma.orderInvoice.findMany = (async () => [{ order: baseOrder }, { order: other }]) as any;

        const result = await resolveOrderByCode('123', 'hub-1');

        assert.equal(result.match, 'multiple');
        assert.equal(result.match === 'multiple' && result.candidates.length, 2);
    });

    it('cai pro sufixo do Order.id quando não acha por nenhuma chave/número', async () => {
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async () => []) as any;
        prisma.order.findMany = (async (args: any) => {
            calledWith = args;
            return [baseOrder];
        }) as any;

        const result = await resolveOrderByCode('abc12345', 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { id: { endsWith: 'abc12345' }, status: 'AT_HUB', currentHubId: 'hub-1' });
    });

    it('retorna match "none" quando nada resolve', async () => {
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async () => []) as any;
        prisma.order.findMany = (async () => []) as any;

        const result = await resolveOrderByCode('naoexiste', 'hub-1');

        assert.equal(result.match, 'none');
    });

    it('cai pra dceAccessKey quando não acha por nfKey nem cteAccessKey', async () => {
        const key = '3'.repeat(44);
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async (args: any) => {
            if ('cteAccessKey' in args.where) return [];
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode(key, 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { dceAccessKey: key });
    });

    it('cai pra cteNumber quando não acha por nfNumber', async () => {
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async (args: any) => {
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode('123', 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { cteNumber: '123', order: { status: 'AT_HUB', currentHubId: 'hub-1' } });
    });

    it('cai pra minutaNumber quando não acha por nfNumber nem cteNumber', async () => {
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async (args: any) => {
            if ('cteNumber' in args.where) return [];
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode('123', 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { minutaNumber: '123', order: { status: 'AT_HUB', currentHubId: 'hub-1' } });
    });

    it('cai pra dceNumber quando não acha por nfNumber, cteNumber nem minutaNumber', async () => {
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async (args: any) => {
            if ('cteNumber' in args.where || 'minutaNumber' in args.where) return [];
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode('123', 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { dceNumber: '123', order: { status: 'AT_HUB', currentHubId: 'hub-1' } });
    });

    it('retorna match "multiple" quando a chave de 44 dígitos resolve mais de um pedido (não é ambíguo silencioso)', async () => {
        const key = '4'.repeat(44);
        const other = { ...baseOrder, id: 'order-def67890' };
        prisma.orderInvoice.findMany = (async () => [{ order: baseOrder }, { order: other }]) as any;

        const result = await resolveOrderByCode(key, 'hub-1');

        assert.equal(result.match, 'multiple');
        assert.equal(result.match === 'multiple' && result.candidates.length, 2);
    });
});
