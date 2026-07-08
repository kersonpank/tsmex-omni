import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CoordinatorProcessorDeps } from './distribuicaoNfeCoordinatorProcessor.js';
import { processCoordinatorJob } from './distribuicaoNfeCoordinatorProcessor.js';

type FakeEmitter = { id: string; environment: 'HOMOLOGACAO' | 'PRODUCAO'; active: boolean; distribuicaoNfeEnabled: boolean; person: { document: string } };

function makeDeps(params: {
    emitters: FakeEmitter[];
    ultimoNsuByCnpj: Record<string, string>;
}) {
    const enqueueCalls: string[] = [];
    const alertCalls: unknown[] = [];

    const deps: CoordinatorProcessorDeps = {
        prisma: {
            fiscalEmitter: {
                findMany: (async (args: any) => {
                    return params.emitters.filter((e) => {
                        if (args?.where?.distribuicaoNfeEnabled !== undefined && e.distribuicaoNfeEnabled !== args.where.distribuicaoNfeEnabled) return false;
                        if (args?.where?.active !== undefined && e.active !== args.where.active) return false;
                        return true;
                    });
                }) as any,
            },
        },
        getUltimoNsuStored: (async (cpfCnpj: string) => params.ultimoNsuByCnpj[cpfCnpj] ?? '0') as any,
        enqueueSyncEmitterJob: (async (fiscalEmitterId: string) => {
            enqueueCalls.push(fiscalEmitterId);
            return `job-${fiscalEmitterId}`;
        }) as any,
        createSystemAlert: (async (params: unknown) => {
            alertCalls.push(params);
        }) as any,
    };

    return { deps, enqueueCalls, alertCalls };
}

describe('processCoordinatorJob', () => {
    it('enfileira só emitentes elegíveis (opt-in + ativo) e com NSU já semeado', async () => {
        const { deps, enqueueCalls, alertCalls } = makeDeps({
            emitters: [
                { id: 'fe-1', environment: 'HOMOLOGACAO', active: true, distribuicaoNfeEnabled: true, person: { document: '11111111000191' } },
                { id: 'fe-2', environment: 'HOMOLOGACAO', active: true, distribuicaoNfeEnabled: true, person: { document: '22222222000192' } },
                { id: 'fe-3-desligado', environment: 'HOMOLOGACAO', active: true, distribuicaoNfeEnabled: false, person: { document: '33333333000193' } },
                { id: 'fe-4-inativo', environment: 'HOMOLOGACAO', active: false, distribuicaoNfeEnabled: true, person: { document: '44444444000194' } },
            ],
            ultimoNsuByCnpj: { '11111111000191': '105', '22222222000192': '200' },
        });

        const result = await processCoordinatorJob(deps);

        assert.deepEqual(enqueueCalls.sort(), ['fe-1', 'fe-2']);
        assert.equal(result.enqueued, 2);
        assert.equal(alertCalls.length, 0);
    });

    it('GUARDA FinOps crítica: emitente elegível sem NSU semeado (checkpoint ausente/0) NÃO é enfileirado, gera alerta', async () => {
        const { deps, enqueueCalls, alertCalls } = makeDeps({
            emitters: [
                { id: 'fe-nao-semeado', environment: 'HOMOLOGACAO', active: true, distribuicaoNfeEnabled: true, person: { document: '55555555000195' } },
            ],
            ultimoNsuByCnpj: {}, // getUltimoNsuStored retorna '0' (default do fake)
        });

        const result = await processCoordinatorJob(deps);

        assert.equal(enqueueCalls.length, 0, 'nunca deve enfileirar sync pra CNPJ com ultimoNsu=0');
        assert.equal(result.enqueued, 0);
        assert.equal(result.skippedNotSeeded, 1);
        assert.equal(alertCalls.length, 1);
        const alert = alertCalls[0] as { category: string; severity: string };
        assert.equal(alert.category, 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED');
        assert.equal(alert.severity, 'WARNING');
    });

    it('não enfileira nada quando não há emitentes elegíveis', async () => {
        const { deps, enqueueCalls } = makeDeps({ emitters: [], ultimoNsuByCnpj: {} });
        const result = await processCoordinatorJob(deps);
        assert.equal(enqueueCalls.length, 0);
        assert.equal(result.enqueued, 0);
        assert.equal(result.skippedNotSeeded, 0);
    });
});
