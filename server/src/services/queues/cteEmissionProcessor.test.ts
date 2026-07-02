import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { DelayedError, type Job } from 'bullmq';

import { processCteEmissionJob, type CteEmissionProcessorDeps } from './cteEmissionProcessor.js';
import type { CteEmissionJobData } from './cteEmissionQueue.js';
import { AcbrHttpError } from '../acbr/acbrHttp.js';
import type { CteEmissionInput, CteProviderResult } from '../cteService.js';
import type { CtePollOutcome, FiscalEmitterContext } from '../acbr/acbrCteEmit.js';

// Todos os testes abaixo injetam `deps` com mocks (ver `cteEmissionQueue: { pause: ... }`
// nos casos de teste) — nunca tocam a fila/Redis reais nem `defaultCteEmissionProcessorDeps`.
// `getCteEmissionQueue()` (cteEmissionQueue.ts) só constrói a Queue/conexão real sob demanda,
// então simplesmente importar `cteEmissionProcessor.ts` aqui não abre nenhum socket — não há
// handle real pra fechar neste arquivo.

type FakeJobRecord = {
    id: string;
    calcId: string;
    providerDocId: string | null;
    phase: string;
    attemptCount: number;
    maxAttempts: number;
    lastHttpStatus: number | null;
    lastError: string | null;
    pausedForQuota: boolean;
    xmlDownloadedAt: Date | null;
    pdfDownloadedAt: Date | null;
};

function makeJobRecord(overrides: Partial<FakeJobRecord> = {}): FakeJobRecord {
    return {
        id: 'job-1',
        calcId: 'calc-1',
        providerDocId: null,
        phase: 'QUEUED',
        attemptCount: 0,
        maxAttempts: 5,
        lastHttpStatus: null,
        lastError: null,
        pausedForQuota: false,
        xmlDownloadedAt: null,
        pdfDownloadedAt: null,
        ...overrides,
    };
}

/** Prisma falso: mantém o mesmo formato de chamada ($transaction([...]) / model.update({data})) sem falar com Postgres. */
function makeFakePrisma(initialJob: FakeJobRecord, initialCalc: Record<string, unknown> = {}) {
    const jobState = { ...initialJob };
    const calcState = { ...initialCalc };

    const findUniqueOrThrow = mock.fn(async () => ({ ...jobState }));
    const jobUpdate = mock.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(jobState, data);
        return { ...jobState };
    });
    const calcUpdate = mock.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(calcState, data);
        return { ...calcState };
    });
    const $transaction = mock.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops));

    const prisma: CteEmissionProcessorDeps['prisma'] = {
        cteEmissionJob: { findUniqueOrThrow, update: jobUpdate } as unknown as CteEmissionProcessorDeps['prisma']['cteEmissionJob'],
        orderFreightCalculation: { update: calcUpdate } as unknown as CteEmissionProcessorDeps['prisma']['orderFreightCalculation'],
        $transaction,
    };

    return { prisma, jobState, calcState, findUniqueOrThrow, jobUpdate, calcUpdate, $transaction };
}

function makeJob(data: CteEmissionJobData): { job: Job<CteEmissionJobData>; moveToDelayed: ReturnType<typeof mock.fn> } {
    const moveToDelayed = mock.fn(async (_ts: number, _token?: string) => {});
    const job = {
        data,
        token: 'lock-token-1',
        moveToDelayed,
    } as unknown as Job<CteEmissionJobData>;
    return { job, moveToDelayed };
}

function makeInput(): CteEmissionInput {
    return { ambiente: 'HOMOLOGACAO' } as unknown as CteEmissionInput;
}

function makeDeps(overrides: Partial<CteEmissionProcessorDeps> = {}, prismaBundle: ReturnType<typeof makeFakePrisma>): CteEmissionProcessorDeps {
    return {
        prisma: prismaBundle.prisma,
        submitCteToAcbr: mock.fn(async () => {
            throw new Error('submitCteToAcbr não deveria ser chamado neste teste (providerDocId já existe).');
        }),
        pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'PENDING' })),
        downloadCteXml: mock.fn(async () => '<xml/>'),
        downloadCtePdf: mock.fn(async () => Buffer.from('pdf')),
        buildCteEmissionInputForJob: mock.fn(async () => ({
            input: makeInput(),
            fiscalEmitterContext: null as FiscalEmitterContext | null,
        })),
        uploadBase64Object: mock.fn(async ({ keyPrefix }: { keyPrefix: string }) => ({ storageKey: `${keyPrefix}/stored` })) as unknown as CteEmissionProcessorDeps['uploadBase64Object'],
        cteEmissionQueue: { pause: mock.fn(async () => {}) },
        createSystemAlert: mock.fn(async () => {}),
        ...overrides,
    } as CteEmissionProcessorDeps;
}

const jobData: CteEmissionJobData = { calcId: 'calc-1', cteEmissionJobId: 'job-1' };

describe('processCteEmissionJob', () => {
    it('1. poll PENDING com tentativas restantes → reagenda via moveToDelayed(~POLL_DELAY_MS) e rejeita com DelayedError', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1', attemptCount: 0, maxAttempts: 5 }));
        const { job, moveToDelayed } = makeJob(jobData);
        const deps = makeDeps(
            { pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'PENDING' })) },
            prismaBundle,
        );

        const before = Date.now();
        await assert.rejects(processCteEmissionJob(job, deps), (err) => err instanceof DelayedError);

        assert.equal(moveToDelayed.mock.callCount(), 1);
        const [ts, token] = moveToDelayed.mock.calls[0].arguments as [number, string];
        assert.equal(token, 'lock-token-1');
        assert.ok(ts - before >= 1000 && ts - before <= 3000, `delay deveria ficar perto de 1500ms, ficou ${ts - before}ms`);
        assert.equal((deps.submitCteToAcbr as unknown as { mock: { callCount: () => number } }).mock.callCount(), 0, 'não deve reenviar submit — providerDocId já existe');
        assert.equal(prismaBundle.jobState.attemptCount, 1);
        assert.equal(prismaBundle.jobState.phase, 'POLLING');
    });

    it('2. poll PENDING no limite de tentativas → markPendingReconciliation (CTE_PENDING_RECONCILIATION, nunca CTE_REJECTED)', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1', attemptCount: 4, maxAttempts: 5 }));
        const { job } = makeJob(jobData);
        const deps = makeDeps(
            { pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'PENDING' })) },
            prismaBundle,
        );

        await processCteEmissionJob(job, deps);

        assert.equal(prismaBundle.calcState.status, 'CTE_PENDING_RECONCILIATION');
        assert.notEqual(prismaBundle.calcState.status, 'CTE_REJECTED');
        assert.equal(prismaBundle.jobState.phase, 'PENDING_RECONCILIATION');
    });

    it('3. AcbrHttpError 402 durante o poll → fila pausada, SystemAlert criado, calc CTE_PENDING_RECONCILIATION', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1', attemptCount: 0, maxAttempts: 5 }));
        const { job } = makeJob(jobData);
        const pauseMock = mock.fn(async () => {});
        const alertMock = mock.fn(async (_params: { category: string; severity: string; title: string; message: string; context?: Record<string, unknown> }) => {});
        const deps = makeDeps(
            {
                pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => {
                    throw new AcbrHttpError('sem créditos', 402, { quotaErrorCode: 'INSUFFICIENT_CREDITS' });
                }),
                cteEmissionQueue: { pause: pauseMock },
                createSystemAlert: alertMock,
            },
            prismaBundle,
        );

        await processCteEmissionJob(job, deps);

        assert.equal(pauseMock.mock.callCount(), 1);
        assert.equal(alertMock.mock.callCount(), 1);
        const alertArgs = alertMock.mock.calls[0].arguments[0] as { category: string };
        assert.equal(alertArgs.category, 'FISCAL_PROVIDER_QUOTA');
        assert.equal(prismaBundle.calcState.status, 'CTE_PENDING_RECONCILIATION');
        assert.equal(prismaBundle.jobState.pausedForQuota, true);
    });

    it('4. AcbrHttpError 429 com retryAfterSeconds/retryInSeconds → reagenda com delay dos headers, capado em 5min', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1', attemptCount: 0, maxAttempts: 5 }));
        const { job, moveToDelayed } = makeJob(jobData);
        const deps = makeDeps(
            {
                pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => {
                    throw new AcbrHttpError('rate limited', 429, { retryInSeconds: 12 });
                }),
            },
            prismaBundle,
        );

        const before = Date.now();
        await assert.rejects(processCteEmissionJob(job, deps), (err) => err instanceof DelayedError);
        const [ts] = moveToDelayed.mock.calls[0].arguments as [number, string];
        assert.ok(ts - before >= 11_000 && ts - before <= 13_000, `delay deveria refletir retryInSeconds=12s, ficou ${ts - before}ms`);
    });

    it('4b. AcbrHttpError 429 com retryInSeconds gigante → delay capado em 5 minutos (300000ms)', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1', attemptCount: 0, maxAttempts: 5 }));
        const { job, moveToDelayed } = makeJob(jobData);
        const deps = makeDeps(
            {
                pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => {
                    throw new AcbrHttpError('rate limited', 429, { retryInSeconds: 999_999 });
                }),
            },
            prismaBundle,
        );

        const before = Date.now();
        await assert.rejects(processCteEmissionJob(job, deps), (err) => err instanceof DelayedError);
        const [ts] = moveToDelayed.mock.calls[0].arguments as [number, string];
        const delay = ts - before;
        assert.ok(delay <= 300_000 + 2000, `delay não deveria passar do cap de 5min, ficou ${delay}ms`);
        assert.ok(delay >= 299_000, `delay deveria bater no cap de 5min, ficou ${delay}ms`);
    });

    it('5a. poll AUTHORIZED com nada baixado ainda → baixa XML e PDF e persiste', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1', attemptCount: 0, maxAttempts: 5 }));
        const { job } = makeJob(jobData);
        const downloadXml = mock.fn(async () => '<xml>ok</xml>');
        const downloadPdf = mock.fn(async () => Buffer.from('pdf-bytes'));
        const result: CteProviderResult = { status: 'AUTHORIZED', accessKey: '1'.repeat(44), protocol: 'proto-1', rawResponse: {} };
        const deps = makeDeps(
            {
                pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'AUTHORIZED', result, providerDocId: 'doc-1' })),
                downloadCteXml: downloadXml,
                downloadCtePdf: downloadPdf,
            },
            prismaBundle,
        );

        await processCteEmissionJob(job, deps);

        assert.equal(downloadXml.mock.callCount(), 1);
        assert.equal(downloadPdf.mock.callCount(), 1);
        assert.equal(prismaBundle.calcState.status, 'CTE_AUTHORIZED');
        assert.equal(prismaBundle.jobState.phase, 'DONE');
    });

    it('5b. poll AUTHORIZED com XML/PDF já baixados → não baixa de novo (idempotência)', async () => {
        const prismaBundle = makeFakePrisma(
            makeJobRecord({ providerDocId: 'doc-1', attemptCount: 0, maxAttempts: 5, xmlDownloadedAt: new Date(), pdfDownloadedAt: new Date() }),
        );
        const { job } = makeJob(jobData);
        const downloadXml = mock.fn(async () => '<xml>ok</xml>');
        const downloadPdf = mock.fn(async () => Buffer.from('pdf-bytes'));
        const result: CteProviderResult = { status: 'AUTHORIZED', accessKey: '1'.repeat(44), protocol: 'proto-1', rawResponse: {} };
        const deps = makeDeps(
            {
                pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'AUTHORIZED', result, providerDocId: 'doc-1' })),
                downloadCteXml: downloadXml,
                downloadCtePdf: downloadPdf,
            },
            prismaBundle,
        );

        await processCteEmissionJob(job, deps);

        assert.equal(downloadXml.mock.callCount(), 0, 'XML já tinha sido baixado — não deve baixar de novo');
        assert.equal(downloadPdf.mock.callCount(), 0, 'PDF já tinha sido baixado — não deve baixar de novo');
        assert.equal(prismaBundle.calcState.status, 'CTE_AUTHORIZED');
    });

    it('6. poll REJECTED (SEFAZ) → calc marcado CTE_REJECTED', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1', attemptCount: 0, maxAttempts: 5 }));
        const { job } = makeJob(jobData);
        const result: CteProviderResult = { status: 'REJECTED', rejectionCode: '999', rejectionReason: 'Chave duplicada', rawResponse: {} };
        const deps = makeDeps(
            { pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'REJECTED', result })) },
            prismaBundle,
        );

        await processCteEmissionJob(job, deps);

        assert.equal(prismaBundle.calcState.status, 'CTE_REJECTED');
        assert.equal(prismaBundle.jobState.phase, 'FAILED');
    });

    it('bônus (issue 1): falha ao carregar o CteEmissionJob (findUniqueOrThrow) antes do try não escapa — cai em reconciliação sem crashar', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1' }));
        prismaBundle.findUniqueOrThrow.mock.mockImplementationOnce(async () => {
            throw new Error('blip transitório de conexão com o banco');
        });
        const { job } = makeJob(jobData);
        const deps = makeDeps({}, prismaBundle);

        await assert.doesNotReject(processCteEmissionJob(job, deps));

        assert.equal(prismaBundle.calcState.status, 'CTE_PENDING_RECONCILIATION');
    });
});
