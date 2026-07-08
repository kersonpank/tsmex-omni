import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Job } from 'bullmq';
import { AcbrHttpError } from '../acbr/acbrHttp.js';
import type { DistribuicaoNfeJobData } from './distribuicaoNfeQueue.js';
import type { SyncProcessorDeps } from './distribuicaoNfeSyncProcessor.js';
import { processDistribuicaoNfeSyncJob } from './distribuicaoNfeSyncProcessor.js';

type SyncEmitterJobData = Extract<DistribuicaoNfeJobData, { kind: 'sync-emitter' }>;

function makeJob(fiscalEmitterId: string): { job: Job<SyncEmitterJobData>; moveToDelayed: ReturnType<typeof mock.fn> } {
    const moveToDelayed = mock.fn(async (_ts: number, _token?: string) => {});
    const job = {
        data: { kind: 'sync-emitter', fiscalEmitterId },
        token: 'lock-token-1',
        moveToDelayed,
    } as unknown as Job<SyncEmitterJobData>;
    return { job, moveToDelayed };
}

const BASE_EMITTER = {
    id: 'fe-1',
    active: true,
    distribuicaoNfeEnabled: true,
    environment: 'HOMOLOGACAO' as const,
    person: { document: '12345678000199' },
};

function makeDeps(overrides: Partial<SyncProcessorDeps> = {}): {
    deps: SyncProcessorDeps;
    calls: {
        solicitarDistribuicaoNfe: unknown[];
        manifestarCienciaOperacao: unknown[];
        baixarXmlDocumentoDistribuicao: unknown[];
        uploadBase64Object: unknown[];
        upsertDiscovered: unknown[];
        markManifested: string[];
        markXmlDownloaded: unknown[];
        setUltimoNsuStored: unknown[];
        createSystemAlert: unknown[];
        queuePause: number;
        sleepCalls: number[];
    };
} {
    const calls = {
        solicitarDistribuicaoNfe: [] as unknown[],
        manifestarCienciaOperacao: [] as unknown[],
        baixarXmlDocumentoDistribuicao: [] as unknown[],
        uploadBase64Object: [] as unknown[],
        upsertDiscovered: [] as unknown[],
        markManifested: [] as string[],
        markXmlDownloaded: [] as unknown[],
        setUltimoNsuStored: [] as unknown[],
        createSystemAlert: [] as unknown[],
        queuePause: 0,
        sleepCalls: [] as number[],
    };

    const deps: SyncProcessorDeps = {
        prisma: {
            fiscalEmitter: {
                findUnique: (async () => BASE_EMITTER) as any,
            },
            nfeDistribuicaoDocumento: {
                findMany: (async () => []) as any,
            },
        },
        getUltimoNsuStored: (async () => '100') as any,
        setUltimoNsuStored: (async (...args: unknown[]) => {
            calls.setUltimoNsuStored.push(args);
        }) as any,
        solicitarDistribuicaoNfe: (async (...args: unknown[]) => {
            calls.solicitarDistribuicaoNfe.push(args);
            return { ultimo_nsu: 100, documentos: [] };
        }) as any,
        manifestarCienciaOperacao: (async (...args: unknown[]) => {
            calls.manifestarCienciaOperacao.push(args);
            return { sucesso: true };
        }) as any,
        baixarXmlDocumentoDistribuicao: (async (...args: unknown[]) => {
            calls.baixarXmlDocumentoDistribuicao.push(args);
            return '<xml/>';
        }) as any,
        uploadBase64Object: (async ({ keyPrefix }: { keyPrefix: string }) => {
            calls.uploadBase64Object.push(keyPrefix);
            return { storageKey: `${keyPrefix}/stored`, checksum: 'x', size: 1, signedUrl: '', publicUrl: '' };
        }) as any,
        upsertDiscovered: (async (input: unknown) => {
            calls.upsertDiscovered.push(input);
            return { id: 'doc-new', ...(input as object) };
        }) as any,
        markManifested: (async (id: string) => {
            calls.markManifested.push(id);
            return true;
        }) as any,
        markXmlDownloaded: (async (...args: unknown[]) => {
            calls.markXmlDownloaded.push(args);
            return true;
        }) as any,
        markPausedForQuota: (async () => {}) as any,
        markFailed: (async () => {}) as any,
        createSystemAlert: (async (...args: unknown[]) => {
            calls.createSystemAlert.push(args);
        }) as any,
        distribuicaoNfeQueue: {
            pause: (async () => {
                calls.queuePause += 1;
            }) as any,
        },
        sleep: (async (ms: number) => {
            calls.sleepCalls.push(ms);
        }) as any,
        ...overrides,
    };

    return { deps, calls };
}

describe('processDistribuicaoNfeSyncJob — guarda de emitente e NSU', () => {
    it('emitente desligado entre enqueue e processamento → sai cedo sem chamar ACBr', async () => {
        const { deps, calls } = makeDeps({
            prisma: {
                fiscalEmitter: { findUnique: (async () => ({ ...BASE_EMITTER, distribuicaoNfeEnabled: false })) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => []) as any },
            },
        });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);
        assert.equal(calls.solicitarDistribuicaoNfe.length, 0);
    });

    it('GUARDA FinOps: checkpoint em 0 aborta sem chamar solicitarDistribuicaoNfe (segunda camada de defesa)', async () => {
        const { deps, calls } = makeDeps({ getUltimoNsuStored: (async () => '0') as any });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);
        assert.equal(calls.solicitarDistribuicaoNfe.length, 0, 'nunca deve chamar a ACBr com ultNSU=0');
        assert.equal(calls.createSystemAlert.length, 1);
        const [alertArgs] = calls.createSystemAlert[0] as [{ category: string }];
        assert.equal(alertArgs.category, 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED');
    });
});

describe('processDistribuicaoNfeSyncJob — discovery', () => {
    it('descobre documentos novos, grava e avança o checkpoint', async () => {
        const rawDoc = { resNFe: { chNFe: '3'.repeat(44), CNPJ: '11111111000111' }, nsu: '101' };
        const { deps, calls } = makeDeps({
            solicitarDistribuicaoNfe: (async () => ({ ultimo_nsu: 105, documentos: [rawDoc] })) as any,
        });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.upsertDiscovered.length, 1);
        assert.equal(calls.setUltimoNsuStored.length, 1);
        const [, , novoNsu] = calls.setUltimoNsuStored[0] as [string, string, string];
        assert.equal(novoNsu, '105');
    });
});

describe('processDistribuicaoNfeSyncJob — manifestação e download (throttle)', () => {
    it('manifesta DISCOVERED e baixa XML de MANIFESTED, nunca em paralelo (throttle serial)', async () => {
        const docs = [
            { id: 'doc-1', accessKey: '1'.repeat(44), status: 'DISCOVERED', xmlDownloadedAt: null },
            { id: 'doc-2', accessKey: '2'.repeat(44), status: 'MANIFESTED', xmlDownloadedAt: null },
        ];
        const { deps, calls } = makeDeps({
            prisma: {
                fiscalEmitter: { findUnique: (async () => BASE_EMITTER) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => docs) as any },
            },
        });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.manifestarCienciaOperacao.length, 1, 'só o doc DISCOVERED deve ser manifestado');
        assert.equal(calls.markManifested.length, 1);
        assert.equal(calls.baixarXmlDocumentoDistribuicao.length, 2, 'ambos os docs (recém-manifestado e já-manifestado) devem baixar XML');
        assert.equal(calls.uploadBase64Object.length, 2);
        assert.ok(calls.sleepCalls.length > 0, 'deve haver throttle (sleep) entre chamadas seriais');
    });

    it('não rebaixa XML de doc que já tem xmlDownloadedAt (idempotência)', async () => {
        const docs = [{ id: 'doc-1', accessKey: '1'.repeat(44), status: 'MANIFESTED', xmlDownloadedAt: new Date('2026-01-01') }];
        const { deps, calls } = makeDeps({
            prisma: {
                fiscalEmitter: { findUnique: (async () => BASE_EMITTER) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => docs) as any },
            },
        });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);
        assert.equal(calls.baixarXmlDocumentoDistribuicao.length, 0);
    });
});

describe('processDistribuicaoNfeSyncJob — 429/402', () => {
    it('429 durante manifestação → reagenda via moveToDelayed, nada marcado FAILED', async () => {
        const docs = [{ id: 'doc-1', accessKey: '1'.repeat(44), status: 'DISCOVERED', xmlDownloadedAt: null }];
        const err = new AcbrHttpError('rate limited', 429, { retryInSeconds: 2 });
        const { deps, calls } = makeDeps({
            prisma: {
                fiscalEmitter: { findUnique: (async () => BASE_EMITTER) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => docs) as any },
            },
            manifestarCienciaOperacao: (async () => {
                throw err;
            }) as any,
        });
        const { job, moveToDelayed } = makeJob('fe-1');

        await assert.rejects(() => processDistribuicaoNfeSyncJob(job, deps), /DelayedError/);
        assert.equal(moveToDelayed.mock.callCount(), 1);
    });

    it('402 durante download de XML → pausa a fila, marca pausedForQuota, cria alerta crítico', async () => {
        const docs = [{ id: 'doc-1', accessKey: '1'.repeat(44), status: 'MANIFESTED', xmlDownloadedAt: null }];
        const err = new AcbrHttpError('sem creditos', 402, { quotaErrorCode: 'InsufficientCredits' });
        const markPausedForQuotaCalls: unknown[] = [];
        const { deps, calls } = makeDeps({
            prisma: {
                fiscalEmitter: { findUnique: (async () => BASE_EMITTER) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => docs) as any },
            },
            baixarXmlDocumentoDistribuicao: (async () => {
                throw err;
            }) as any,
            markPausedForQuota: (async (...args: unknown[]) => {
                markPausedForQuotaCalls.push(args);
            }) as any,
        });
        const { job } = makeJob('fe-1');

        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.queuePause, 1);
        assert.equal(markPausedForQuotaCalls.length, 1);
        assert.equal(calls.createSystemAlert.length, 1);
        const [alertArgs] = calls.createSystemAlert[0] as [{ category: string; severity: string }];
        assert.equal(alertArgs.category, 'FISCAL_DISTRIBUICAO_NFE_QUOTA');
        assert.equal(alertArgs.severity, 'CRITICAL');
    });
});
