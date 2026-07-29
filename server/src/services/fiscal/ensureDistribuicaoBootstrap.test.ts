import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import prisma from '../../lib/prisma.js';
import { ensureDistribuicaoBootstrap, type EnsureDistribuicaoBootstrapDeps } from './ensureDistribuicaoBootstrap.js';
import type { DistribuicaoNfeRequestBody } from '../acbr/acbrDistribuicaoNfe.js';

const HUB_ID = '550e8400-e29b-41d4-a716-446655440010';
const CHAVE = '35260512345678000190550010000000012345678901';

function makeDeps(
    isAcbrCredentialsConfigured = mock.fn(() => true),
    solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 })),
    putAcbrEmpresaDistNfeConfig = mock.fn(async () => ({ ok: true })),
    resolveOpenSystemAlerts = mock.fn(async (_params: { category: string; match: (ctx: Record<string, unknown>) => boolean }) => 0),
): EnsureDistribuicaoBootstrapDeps {
    return { isAcbrCredentialsConfigured, solicitarEPersistirNsu, putAcbrEmpresaDistNfeConfig, resolveOpenSystemAlerts };
}

describe('ensureDistribuicaoBootstrap', () => {
    const original = {
        findFirst: prisma.fiscalEmitter.findFirst.bind(prisma.fiscalEmitter),
        update: prisma.fiscalEmitter.update.bind(prisma.fiscalEmitter),
        checkpointFindUnique: prisma.fiscalDistribuicaoCheckpoint.findUnique.bind(prisma.fiscalDistribuicaoCheckpoint),
    };

    let emitter: Record<string, unknown> | null;
    let checkpoint: Record<string, unknown> | null;
    let updateCalls: Array<Record<string, unknown>>;

    beforeEach(() => {
        emitter = {
            id: 'emitter-1',
            hubId: HUB_ID,
            environment: 'HOMOLOGACAO',
            distribuicaoNfeEnabled: false,
            person: { document: '12345678000199' },
        };
        checkpoint = null;
        updateCalls = [];

        prisma.fiscalEmitter.findFirst = (async () => emitter) as unknown as typeof prisma.fiscalEmitter.findFirst;
        prisma.fiscalEmitter.update = (async (args: { data: Record<string, unknown> }) => {
            updateCalls.push(args.data);
            return { ...emitter, ...args.data };
        }) as unknown as typeof prisma.fiscalEmitter.update;
        prisma.fiscalDistribuicaoCheckpoint.findUnique = (async () => checkpoint) as unknown as typeof prisma.fiscalDistribuicaoCheckpoint.findUnique;
    });

    afterEach(() => {
        prisma.fiscalEmitter.findFirst = original.findFirst;
        prisma.fiscalEmitter.update = original.update;
        prisma.fiscalDistribuicaoCheckpoint.findUnique = original.checkpointFindUnique;
    });

    it('sem hubId — não faz nada', async () => {
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));
        await ensureDistribuicaoBootstrap(null, CHAVE, makeDeps(undefined, solicitarEPersistirNsu));
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('ACBr não configurado — não faz nada', async () => {
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));
        const deps = makeDeps(mock.fn(() => false), solicitarEPersistirNsu);
        await ensureDistribuicaoBootstrap(HUB_ID, CHAVE, deps);
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('Hub sem FiscalEmitter — não faz nada', async () => {
        emitter = null;
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));
        await ensureDistribuicaoBootstrap(HUB_ID, CHAVE, makeDeps(undefined, solicitarEPersistirNsu));
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('checkpoint já existe — não gasta crédito, não reativa nada', async () => {
        checkpoint = { cpfCnpj: '12345678000199', ambiente: 'homologacao', ultimoNsu: '50' };
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));

        await ensureDistribuicaoBootstrap(HUB_ID, CHAVE, makeDeps(undefined, solicitarEPersistirNsu));

        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
        assert.equal(updateCalls.length, 0);
    });

    it('checkpoint ausente — semeia via cons-chave e liga distribuicaoNfeEnabled', async () => {
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));

        await ensureDistribuicaoBootstrap(HUB_ID, CHAVE, makeDeps(undefined, solicitarEPersistirNsu));

        assert.equal(solicitarEPersistirNsu.mock.callCount(), 1);
        const callArg = solicitarEPersistirNsu.mock.calls[0].arguments[0];
        assert.equal(callArg.tipo_consulta, 'cons-chave');
        assert.equal(callArg.cons_chave, CHAVE);
        assert.equal(callArg.cpf_cnpj, '12345678000199');
        assert.equal(callArg.ambiente, 'homologacao');
        assert.equal(updateCalls.length, 1);
        assert.equal(updateCalls[0]?.distribuicaoNfeEnabled, true);
    });

    it('checkpoint ausente — semeia e resolve alerta "NSU não configurado" aberto pro emitente', async () => {
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));
        const resolveOpenSystemAlerts = mock.fn(async (_params: { category: string; match: (ctx: Record<string, unknown>) => boolean }) => 1);

        await ensureDistribuicaoBootstrap(
            HUB_ID,
            CHAVE,
            makeDeps(undefined, solicitarEPersistirNsu, undefined, resolveOpenSystemAlerts),
        );

        assert.equal(resolveOpenSystemAlerts.mock.callCount(), 1);
        const [args] = resolveOpenSystemAlerts.mock.calls[0].arguments as [{ category: string; match: (ctx: Record<string, unknown>) => boolean }];
        assert.equal(args.category, 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED');
        assert.ok(args.match({ fiscalEmitterId: 'emitter-1' }));
        assert.ok(!args.match({ fiscalEmitterId: 'outro' }));
    });

    it('distribuicaoNfeEnabled já true — não tenta reativar de novo', async () => {
        (emitter as Record<string, unknown>).distribuicaoNfeEnabled = true;
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));

        await ensureDistribuicaoBootstrap(HUB_ID, CHAVE, makeDeps(undefined, solicitarEPersistirNsu));

        assert.equal(updateCalls.length, 0);
    });

    it('CPF (11 dígitos) no Person do emitente — não chama ACBr (Distribuição DFe é só CNPJ)', async () => {
        (emitter as Record<string, unknown>).person = { document: '12345678901' };
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));

        await ensureDistribuicaoBootstrap(HUB_ID, CHAVE, makeDeps(undefined, solicitarEPersistirNsu));

        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('checkpoint ausente — garante a config de distnfe antes de semear (Causa 3 generalizada)', async () => {
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));
        const putAcbrEmpresaDistNfeConfig = mock.fn(async () => ({ ok: true }));

        await ensureDistribuicaoBootstrap(HUB_ID, CHAVE, makeDeps(undefined, solicitarEPersistirNsu, putAcbrEmpresaDistNfeConfig));

        assert.equal(putAcbrEmpresaDistNfeConfig.mock.callCount(), 1);
        assert.deepEqual(putAcbrEmpresaDistNfeConfig.mock.calls[0].arguments, ['12345678000199', 'homologacao']);
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 1, 'deve seguir pro seed mesmo chamando a config antes');
    });

    it('checkpoint já existe — não chama a config de distnfe (nada a fazer, sem custo)', async () => {
        checkpoint = { cpfCnpj: '12345678000199', ambiente: 'homologacao', ultimoNsu: '50' };
        const putAcbrEmpresaDistNfeConfig = mock.fn(async () => ({ ok: true }));

        await ensureDistribuicaoBootstrap(HUB_ID, CHAVE, makeDeps(undefined, undefined, putAcbrEmpresaDistNfeConfig));

        assert.equal(putAcbrEmpresaDistNfeConfig.mock.callCount(), 0);
    });

    it('config de distnfe falha — best-effort, ainda tenta semear o NSU', async () => {
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => ({ ultimo_nsu: 100 }));
        const putAcbrEmpresaDistNfeConfig = mock.fn(async () => ({ ok: false, message: 'ConfigDistNfeNotFound' }));

        await ensureDistribuicaoBootstrap(HUB_ID, CHAVE, makeDeps(undefined, solicitarEPersistirNsu, putAcbrEmpresaDistNfeConfig));

        assert.equal(solicitarEPersistirNsu.mock.callCount(), 1, 'não bloqueia o seed mesmo se o PUT de config falhar');
    });

    it('erro na chamada ACBr — best-effort, nunca lança', async () => {
        const solicitarEPersistirNsu = mock.fn(async (_body: DistribuicaoNfeRequestBody) => {
            throw new Error('ACBr fora do ar');
        });

        await assert.doesNotReject(ensureDistribuicaoBootstrap(HUB_ID, CHAVE, makeDeps(undefined, solicitarEPersistirNsu)));
    });
});
