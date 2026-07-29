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
        putAcbrEmpresaDistNfeConfig: unknown[];
        createSystemAlert: unknown[];
        resolveOpenSystemAlerts: unknown[];
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
        putAcbrEmpresaDistNfeConfig: [] as unknown[],
        createSystemAlert: [] as unknown[],
        resolveOpenSystemAlerts: [] as unknown[],
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
        putAcbrEmpresaDistNfeConfig: (async (...args: unknown[]) => {
            calls.putAcbrEmpresaDistNfeConfig.push(args);
            return { ok: true };
        }) as any,
        solicitarDistribuicaoNfe: (async (...args: unknown[]) => {
            calls.solicitarDistribuicaoNfe.push(args);
            return { ultimo_nsu: 100, data: [] };
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
        createOrMergeSystemAlert: (async (...args: unknown[]) => {
            calls.createSystemAlert.push(args);
        }) as any,
        resolveOpenSystemAlerts: (async (...args: unknown[]) => {
            calls.resolveOpenSystemAlerts.push(args);
            return 0;
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
        assert.equal(calls.putAcbrEmpresaDistNfeConfig.length, 0, 'não gasta chamada de config se nem passou da guarda de NSU');
    });
});

describe('processDistribuicaoNfeSyncJob — discovery', () => {
    it('descobre documentos novos (formato real da ACBr: array em "documentos"), grava e avança o checkpoint', async () => {
        const rawDoc = { id: 'nfe_abc123', tipo_documento: 'nota', resumo: true, chave_acesso: '3'.repeat(44), emitente_cpf_cnpj: '11111111000111', nsu: '101' };
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

    it('aceita "data" como fallback legado quando "documentos" não vem (compatibilidade, não o formato real)', async () => {
        const rawDoc = { id: 'nfe_abc123', tipo_documento: 'nota', resumo: true, chave_acesso: '3'.repeat(44), emitente_cpf_cnpj: '11111111000111', nsu: '101' };
        const { deps, calls } = makeDeps({
            solicitarDistribuicaoNfe: (async () => ({ ultimo_nsu: 105, data: [rawDoc] })) as any,
        });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.upsertDiscovered.length, 1);
    });

    it('garante a config de distnfe (idempotente) antes de chamar dist-nsu — generaliza a Causa 3 pra qualquer emitente', async () => {
        const { deps, calls } = makeDeps();
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.putAcbrEmpresaDistNfeConfig.length, 1);
        assert.deepEqual(calls.putAcbrEmpresaDistNfeConfig[0], ['12345678000199', 'homologacao']);
        assert.ok(calls.solicitarDistribuicaoNfe.length === 1, 'segue pra dist-nsu mesmo com a chamada de config no meio');
    });

    it('config de distnfe falhando não impede a tentativa de dist-nsu (best-effort)', async () => {
        const { deps, calls } = makeDeps({
            putAcbrEmpresaDistNfeConfig: (async () => ({ ok: false, message: 'ConfigDistNfeNotFound' })) as any,
        });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.solicitarDistribuicaoNfe.length, 1);
    });

    it('GUARDA de schema: se nem "documentos" nem "data" vierem como array, aborta o job inteiro sem lançar erro e sem chamar manifestação/download', async () => {
        const docs = [{ id: 'doc-1', accessKey: '1'.repeat(44), status: 'DISCOVERED', xmlDownloadedAt: null, resumoRaw: { id: 'nfe_x' } }];
        const { deps, calls } = makeDeps({
            solicitarDistribuicaoNfe: (async () => ({ ultimo_nsu: 105, algumCampoQueNaoConhecemos: 'x' })) as any,
            prisma: {
                fiscalEmitter: { findUnique: (async () => BASE_EMITTER) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => docs) as any },
            },
        });
        const { job } = makeJob('fe-1');

        await processDistribuicaoNfeSyncJob(job, deps); // não deve lançar

        assert.equal(calls.upsertDiscovered.length, 0);
        assert.equal(calls.setUltimoNsuStored.length, 0, 'não confia em ultimo_nsu de um payload com shape não reconhecido');
        assert.equal(calls.manifestarCienciaOperacao.length, 0, 'fases 2/3 não rodam quando o schema não bate');
        assert.equal(calls.baixarXmlDocumentoDistribuicao.length, 0);
    });

    it('documento com "documentos" presente mas item de shape desconhecido dentro dele → não upserta esse item, mas não aborta o job (docs=[] não é o mesmo que docs=null)', async () => {
        const { deps, calls } = makeDeps({
            solicitarDistribuicaoNfe: (async () => ({ ultimo_nsu: 105, documentos: ['formato-que-nao-reconhecemos'] })) as any,
        });
        const { job } = makeJob('fe-1');

        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.upsertDiscovered.length, 0, 'item individual não reconhecido (DESCONHECIDO) não é persistido');
        assert.equal(calls.setUltimoNsuStored.length, 1, 'mas o array "documentos" em si era válido, então o checkpoint avança normalmente');
    });
});

describe('processDistribuicaoNfeSyncJob — manifestação e download (throttle)', () => {
    it('manifesta DISCOVERED e baixa XML de MANIFESTED, nunca em paralelo (throttle serial)', async () => {
        const docs = [
            { id: 'doc-1', accessKey: '1'.repeat(44), status: 'DISCOVERED', xmlDownloadedAt: null, resumoRaw: { id: 'nfe_aaa111' } },
            { id: 'doc-2', accessKey: '2'.repeat(44), status: 'MANIFESTED', xmlDownloadedAt: null, resumoRaw: { id: 'nfe_bbb222' } },
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
        assert.deepEqual(calls.baixarXmlDocumentoDistribuicao[0], ['nfe_aaa111', 'homologacao'], 'deve usar o id interno da ACBr, nunca a accessKey');
        assert.equal(calls.uploadBase64Object.length, 2);
        assert.ok(calls.sleepCalls.length > 0, 'deve haver throttle (sleep) entre chamadas seriais');
    });

    it('doc tipo NFE_PROC (resumo:false) pula manifestação — SEFAZ já liberou acesso total (ex.: CNPJ citado como transportador)', async () => {
        const docs = [
            { id: 'doc-1', tipo: 'NFE_PROC', accessKey: '1'.repeat(44), status: 'DISCOVERED', xmlDownloadedAt: null, resumoRaw: { id: 'nfe_aaa111' } },
        ];
        const { deps, calls } = makeDeps({
            prisma: {
                fiscalEmitter: { findUnique: (async () => BASE_EMITTER) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => docs) as any },
            },
        });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.manifestarCienciaOperacao.length, 0, 'NFE_PROC não precisa de Ciência da Operação');
        assert.equal(calls.baixarXmlDocumentoDistribuicao.length, 1, 'mesmo pulando manifestação, ainda baixa o XML normalmente');
    });

    it('doc tipo RESUMO (ou sem tipo/legado) continua manifestando normalmente antes do download', async () => {
        const docs = [
            { id: 'doc-1', tipo: 'RESUMO', accessKey: '1'.repeat(44), status: 'DISCOVERED', xmlDownloadedAt: null, resumoRaw: { id: 'nfe_aaa111' } },
        ];
        const { deps, calls } = makeDeps({
            prisma: {
                fiscalEmitter: { findUnique: (async () => BASE_EMITTER) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => docs) as any },
            },
        });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.manifestarCienciaOperacao.length, 1);
        assert.equal(calls.baixarXmlDocumentoDistribuicao.length, 1);
    });

    it('não rebaixa XML de doc que já tem xmlDownloadedAt (idempotência — sobrevive a crash/restart)', async () => {
        const docs = [{ id: 'doc-1', accessKey: '1'.repeat(44), status: 'MANIFESTED', xmlDownloadedAt: new Date('2026-01-01'), resumoRaw: { id: 'nfe_ccc333' } }];
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

    it('NUNCA usa accessKey como id interno: doc MANIFESTED sem id na ACBr é pulado (não baixa, não marca)', async () => {
        const docs = [{ id: 'doc-1', accessKey: '1'.repeat(44), status: 'MANIFESTED', xmlDownloadedAt: null, resumoRaw: { algumOutroCampo: true } }];
        const { deps, calls } = makeDeps({
            prisma: {
                fiscalEmitter: { findUnique: (async () => BASE_EMITTER) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => docs) as any },
            },
        });
        const { job } = makeJob('fe-1');
        await processDistribuicaoNfeSyncJob(job, deps);
        assert.equal(calls.baixarXmlDocumentoDistribuicao.length, 0);
        assert.equal(calls.markXmlDownloaded.length, 0);
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
        const docs = [{ id: 'doc-1', accessKey: '1'.repeat(44), status: 'MANIFESTED', xmlDownloadedAt: null, resumoRaw: { id: 'nfe_ddd444' } }];
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

    it('erro genérico (não-402/429, ex.: falha de auth/config) cria SystemAlert antes de relançar — antes disso falhava em silêncio', async () => {
        const err = new Error('ACBR_CLIENT_ID_PRODUCAO e ACBR_CLIENT_SECRET_PRODUCAO são obrigatórios para o provedor ACBr (ambiente PRODUCAO).');
        const { deps, calls } = makeDeps({
            prisma: {
                fiscalEmitter: { findUnique: (async () => BASE_EMITTER) as any },
                nfeDistribuicaoDocumento: { findMany: (async () => []) as any },
            },
            solicitarDistribuicaoNfe: (async () => {
                throw err;
            }) as any,
        });
        const { job } = makeJob('fe-1');

        await assert.rejects(() => processDistribuicaoNfeSyncJob(job, deps), err);

        assert.equal(calls.createSystemAlert.length, 1);
        const [alertArgs] = calls.createSystemAlert[0] as [{ category: string; severity: string; message: string; context?: { fiscalEmitterId?: string } }];
        assert.equal(alertArgs.category, 'FISCAL_PROVIDER_ERROR');
        assert.equal(alertArgs.severity, 'WARNING');
        assert.match(alertArgs.message, /ACBR_CLIENT_ID_PRODUCAO/);
        assert.equal(alertArgs.context?.fiscalEmitterId, 'fe-1');
        assert.equal(calls.resolveOpenSystemAlerts.length, 0, 'job que falhou não deve resolver nada');
    });

    it('sync termina sem erro → resolve alerta FISCAL_PROVIDER_ERROR aberto anteriormente pro mesmo emitente', async () => {
        const { deps, calls } = makeDeps();
        const { job } = makeJob('fe-1');

        await processDistribuicaoNfeSyncJob(job, deps);

        assert.equal(calls.resolveOpenSystemAlerts.length, 1);
        const [resolveArgs] = calls.resolveOpenSystemAlerts[0] as [{ category: string; match: (ctx: Record<string, unknown>) => boolean }];
        assert.equal(resolveArgs.category, 'FISCAL_PROVIDER_ERROR');
        assert.ok(resolveArgs.match({ fiscalEmitterId: 'fe-1' }));
        assert.ok(!resolveArgs.match({ fiscalEmitterId: 'outro-emitente' }));
    });

    it('falha repetida no mesmo emitente não duplica FISCAL_PROVIDER_ERROR (dedup por fiscalEmitterId)', async () => {
        const err = new Error('timeout');
        const { deps, calls } = makeDeps({
            solicitarDistribuicaoNfe: (async () => {
                throw err;
            }) as any,
        });
        const { job: job1 } = makeJob('fe-1');
        const { job: job2 } = makeJob('fe-1');

        await assert.rejects(() => processDistribuicaoNfeSyncJob(job1, deps), err);
        await assert.rejects(() => processDistribuicaoNfeSyncJob(job2, deps), err);

        assert.equal(calls.createSystemAlert.length, 2, 'createOrMergeSystemAlert é chamado 2x — quem dedupa de fato é o systemAlertService, testado à parte');
        const [firstArgs] = calls.createSystemAlert[0] as [{ dedupMatch?: (ctx: Record<string, unknown>) => boolean }];
        assert.ok(firstArgs.dedupMatch?.({ fiscalEmitterId: 'fe-1' }), 'dedupMatch deve casar pelo mesmo fiscalEmitterId');
        assert.ok(!firstArgs.dedupMatch?.({ fiscalEmitterId: 'fe-2' }), 'dedupMatch não deve casar com outro emitente');
    });
});
