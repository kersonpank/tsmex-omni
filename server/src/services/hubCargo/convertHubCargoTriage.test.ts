import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
    convertHubCargoTriage,
    type ConvertHubCargoTriageInput,
} from './convertHubCargoTriage.js';

describe('convertHubCargoTriage', () => {
    const originalFindMany = prisma.nfeDistribuicaoDocumento.findMany;
    const input: ConvertHubCargoTriageInput = { hubId: 'hub-A', actingRoles: ['HUB'] };
    let query: unknown;
    let documentIds: string[];

    beforeEach(() => {
        query = undefined;
        documentIds = [];
        prisma.nfeDistribuicaoDocumento.findMany = (async (args: unknown) => {
            query = args;
            return documentIds.map((id) => ({ id }));
        }) as any;
    });

    afterEach(() => {
        prisma.nfeDistribuicaoDocumento.findMany = originalFindMany;
    });

    it('retenta apenas READY_FOR_TRIAGE do emitente do hub e continua após falha individual', async () => {
        documentIds = ['ready-1', 'broken', 'ready-2'];
        const calls: Array<{ id: string; options: unknown }> = [];
        const result = await convertHubCargoTriage(input, {
            convertDocument: async (id, options) => {
                calls.push({ id, options });
                if (id === 'broken') throw new Error('XML armazenado indisponível.');
                return { converted: true, demand: { id: `demand-${id}` } as any };
            },
        });

        assert.deepEqual(query, {
            where: { status: 'READY_FOR_TRIAGE', fiscalEmitter: { hubId: 'hub-A' } },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
        });
        assert.deepEqual(calls, documentIds.map((id) => ({
            id,
            options: { actingRoles: ['HUB'], actingHubId: 'hub-A' },
        })));
        assert.deepEqual(result, {
            converted: 2,
            failed: [{ id: 'broken', message: 'XML armazenado indisponível.' }],
        });
    });

    it('expõe motivos recuperáveis sem contabilizá-los como documentos preparados', async () => {
        documentIds = ['not_ready', 'already_has_demand', 'concurrent_conversion'];
        const result = await convertHubCargoTriage(input, {
            convertDocument: async (id) => ({ converted: false, reason: id as 'not_ready' | 'already_has_demand' | 'concurrent_conversion' }),
        });

        assert.equal(result.converted, 0);
        assert.deepEqual(result.failed, [
            { id: 'not_ready', message: 'Documento não está pronto para preparação. Confira o XML da NF-e.' },
            { id: 'already_has_demand', message: 'Já existe uma entrada para esta NF-e.' },
            { id: 'concurrent_conversion', message: 'Documento já foi preparado ou descartado por outra ação.' },
        ]);
    });

    it('retorna o lote vazio sem chamar conversão', async () => {
        const result = await convertHubCargoTriage(input, {
            convertDocument: async () => { throw new Error('Não deve converter sem documentos.'); },
        });
        assert.deepEqual(result, { converted: 0, failed: [] });
    });

    it('recusa hub ausente antes de consultar documentos fiscais', async () => {
        await assert.rejects(
            convertHubCargoTriage({ ...input, hubId: ' ' }),
            (error: unknown) => error instanceof AppError && error.statusCode === 400,
        );
        assert.equal(query, undefined);
    });
});
