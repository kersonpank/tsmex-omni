import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import {
    getDistribuicaoCheckpointStatus,
    getDistribuicaoCheckpointStatusBatch,
} from './distribuicaoCheckpointStatus.js';

describe('distribuicaoCheckpointStatus', () => {
    const original = {
        findUnique: prisma.fiscalDistribuicaoCheckpoint.findUnique.bind(prisma.fiscalDistribuicaoCheckpoint),
        findMany: prisma.fiscalDistribuicaoCheckpoint.findMany.bind(prisma.fiscalDistribuicaoCheckpoint),
    };

    afterEach(() => {
        prisma.fiscalDistribuicaoCheckpoint.findUnique = original.findUnique;
        prisma.fiscalDistribuicaoCheckpoint.findMany = original.findMany;
    });

    describe('getDistribuicaoCheckpointStatus', () => {
        it('sem linha no banco — seeded false, ultimoNsu "0", nextAllowedAt null', async () => {
            prisma.fiscalDistribuicaoCheckpoint.findUnique = (async () => null) as any;
            const status = await getDistribuicaoCheckpointStatus('12345678000199', 'producao');
            assert.deepEqual(status, { ambiente: 'producao', ultimoNsu: '0', seeded: false, nextAllowedAt: null });
        });

        it('linha existe com ultimoNsu "0" (nunca avançou) — ainda seeded false', async () => {
            prisma.fiscalDistribuicaoCheckpoint.findUnique = (async () => ({ ultimoNsu: '0', distNfeNextAllowedAt: null })) as any;
            const status = await getDistribuicaoCheckpointStatus('12345678000199', 'homologacao');
            assert.equal(status.seeded, false);
        });

        it('linha existe com ultimoNsu diferente de "0" — seeded true', async () => {
            prisma.fiscalDistribuicaoCheckpoint.findUnique = (async () => ({ ultimoNsu: '39617', distNfeNextAllowedAt: null })) as any;
            const status = await getDistribuicaoCheckpointStatus('26879820000270', 'producao');
            assert.deepEqual(status, { ambiente: 'producao', ultimoNsu: '39617', seeded: true, nextAllowedAt: null });
        });

        it('linha com distNfeNextAllowedAt setado — vem como ISO string', async () => {
            const when = new Date('2026-07-28T18:00:00.000Z');
            prisma.fiscalDistribuicaoCheckpoint.findUnique = (async () => ({ ultimoNsu: '39617', distNfeNextAllowedAt: when })) as any;
            const status = await getDistribuicaoCheckpointStatus('26879820000270', 'producao');
            assert.equal(status.nextAllowedAt, '2026-07-28T18:00:00.000Z');
        });
    });

    describe('getDistribuicaoCheckpointStatusBatch', () => {
        let findManyCalls: unknown[];

        beforeEach(() => {
            findManyCalls = [];
        });

        it('lista vazia — não chama o banco', async () => {
            prisma.fiscalDistribuicaoCheckpoint.findMany = (async (args: unknown) => {
                findManyCalls.push(args);
                return [];
            }) as any;

            const result = await getDistribuicaoCheckpointStatusBatch([]);

            assert.equal(result.size, 0);
            assert.equal(findManyCalls.length, 0);
        });

        it('múltiplos emitentes — 1 única query, dedupa pares repetidos, status certo por par', async () => {
            const when = new Date('2026-07-28T18:00:00.000Z');
            prisma.fiscalDistribuicaoCheckpoint.findMany = (async (args: unknown) => {
                findManyCalls.push(args);
                return [
                    { cpfCnpj: '26879820000270', ambiente: 'producao', ultimoNsu: '39617', distNfeNextAllowedAt: when },
                    { cpfCnpj: '11111111000111', ambiente: 'homologacao', ultimoNsu: '0', distNfeNextAllowedAt: null },
                ];
            }) as any;

            const result = await getDistribuicaoCheckpointStatusBatch([
                { cpfCnpj: '26879820000270', ambiente: 'producao' },
                { cpfCnpj: '11111111000111', ambiente: 'homologacao' },
                { cpfCnpj: '11111111000111', ambiente: 'homologacao' }, // par repetido — não deve duplicar a query
                { cpfCnpj: '99999999000199', ambiente: 'producao' }, // sem linha no banco
            ]);

            assert.equal(findManyCalls.length, 1, 'deve bater no banco uma única vez, mesmo com N emitentes/pares repetidos');
            assert.equal(result.size, 3, 'dedupa os 2 pares idênticos em 1 só');
            assert.equal(result.get('26879820000270|producao')?.seeded, true);
            assert.equal(result.get('26879820000270|producao')?.nextAllowedAt, '2026-07-28T18:00:00.000Z');
            assert.equal(result.get('11111111000111|homologacao')?.seeded, false);
            assert.deepEqual(result.get('99999999000199|producao'), { ambiente: 'producao', ultimoNsu: '0', seeded: false, nextAllowedAt: null });
        });
    });
});
