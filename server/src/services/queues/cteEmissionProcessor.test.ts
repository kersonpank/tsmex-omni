import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { DelayedError, type Job } from 'bullmq';

import { processCteEmissionJob, handleCteJobExhausted, type CteEmissionProcessorDeps } from './cteEmissionProcessor.js';
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

function makeJob(data: CteEmissionJobData): { job: Job<CteEmissionJobData>; moveToDelayed: ReturnType<typeof mock.fn>; updateData: ReturnType<typeof mock.fn> } {
    const moveToDelayed = mock.fn(async (_ts: number, _token?: string) => {});
    const updateData = mock.fn(async (newData: CteEmissionJobData) => {
        Object.assign(job.data, newData);
    });
    const job = {
        data,
        token: 'lock-token-1',
        moveToDelayed,
        updateData,
    } as unknown as Job<CteEmissionJobData>;
    return { job, moveToDelayed, updateData };
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
        createOrMergeSystemAlert: mock.fn(
            async (_params: Parameters<CteEmissionProcessorDeps['createOrMergeSystemAlert']>[0]) => {},
        ) as unknown as CteEmissionProcessorDeps['createOrMergeSystemAlert'],
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

    it('7a. sem providerDocId ainda, submitCteToAcbr resolve com sucesso → persiste providerDocId, calc CTE_PROCESSING, e cai no mesmo tick para o polling', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: null, phase: 'QUEUED', attemptCount: 0, maxAttempts: 5 }));
        const { job, moveToDelayed } = makeJob({ calcId: 'calc-1', cteEmissionJobId: 'job-1', phaseHint: 'submit' });
        const submitMock = mock.fn(async () => ({ providerDocId: 'new-doc-id' }));
        const pollMock = mock.fn(async (_providerDocId: string, _ambiente: string, _attempt: number): Promise<CtePollOutcome> => ({ kind: 'PENDING' }));
        const deps = makeDeps(
            {
                submitCteToAcbr: submitMock as unknown as CteEmissionProcessorDeps['submitCteToAcbr'],
                pollCteStatusOnce: pollMock as unknown as CteEmissionProcessorDeps['pollCteStatusOnce'],
            },
            prismaBundle,
        );

        // A tentativa 0 → 1 ainda está abaixo de maxAttempts(5), então o poll PENDING desta
        // mesma execução reagenda via DelayedError — não é uma falha, é o fluxo normal de poll.
        await assert.rejects(processCteEmissionJob(job, deps), (err) => err instanceof DelayedError);

        assert.equal(submitMock.mock.callCount(), 1, 'deve submeter exatamente 1 vez (não havia providerDocId ainda)');
        assert.equal(prismaBundle.jobState.providerDocId, 'new-doc-id', 'providerDocId retornado pelo submit deve ser persistido');
        assert.equal(prismaBundle.jobState.phase, 'POLLING', 'após o submit bem-sucedido e um poll PENDING, a fase avança para POLLING (reagendado)');
        assert.equal(prismaBundle.calcState.status, 'CTE_PROCESSING', 'calc deve virar CTE_PROCESSING assim que o submit é aceito pela ACBr');
        assert.equal(pollMock.mock.callCount(), 1, 'no mesmo tick, após o submit, deve cair para o polling (não é um job run separado)');
        assert.equal(pollMock.mock.calls[0].arguments[0], 'new-doc-id', 'o poll deve usar o providerDocId recém-obtido do submit');
        assert.equal(moveToDelayed.mock.callCount(), 1);
    });

    it('7b. sem providerDocId ainda, submitCteToAcbr resolve com rejeição → calc CTE_REJECTED, job FAILED, pollCteStatusOnce NUNCA chamado', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: null, phase: 'QUEUED', attemptCount: 0, maxAttempts: 5 }));
        const { job } = makeJob({ calcId: 'calc-1', cteEmissionJobId: 'job-1', phaseHint: 'submit' });
        const rejection: CteProviderResult = { status: 'REJECTED', rejectionCode: '204', rejectionReason: 'CT-e já emitido para esta referência', rawResponse: {} };
        const submitMock = mock.fn(async () => ({ rejected: rejection }));
        const pollMock = mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'PENDING' }));
        const deps = makeDeps(
            {
                submitCteToAcbr: submitMock as unknown as CteEmissionProcessorDeps['submitCteToAcbr'],
                pollCteStatusOnce: pollMock,
            },
            prismaBundle,
        );

        await processCteEmissionJob(job, deps);

        assert.equal(submitMock.mock.callCount(), 1);
        assert.equal(prismaBundle.calcState.status, 'CTE_REJECTED');
        assert.equal(prismaBundle.calcState.cteStatusReason, 'CT-e já emitido para esta referência');
        assert.equal(prismaBundle.jobState.phase, 'FAILED');
        assert.equal(prismaBundle.jobState.providerDocId, null, 'documento rejeitado não deve ganhar um providerDocId');
        assert.equal(pollMock.mock.callCount(), 0, 'nada a fazer polling — o submit foi rejeitado, não há documento na ACBr');
    });

    it('7c. phaseHint poll-only sem providerDocId (estado inconsistente que o código detecta e rejeita) — nem submit nem poll são chamados, erro é registrado e reagendado', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: null, phase: 'QUEUED', attemptCount: 0, maxAttempts: 5 }));
        const { job, moveToDelayed } = makeJob({ calcId: 'calc-1', cteEmissionJobId: 'job-1', phaseHint: 'poll-only' });
        const submitMock = mock.fn(async () => {
            throw new Error('submitCteToAcbr não deveria ser chamado em poll-only');
        });
        const pollMock = mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'PENDING' }));
        const deps = makeDeps(
            {
                submitCteToAcbr: submitMock as unknown as CteEmissionProcessorDeps['submitCteToAcbr'],
                pollCteStatusOnce: pollMock,
            },
            prismaBundle,
        );

        // O código atual detecta esse estado inconsistente (`poll-only` sem providerDocId) e
        // lança um Error explícito dentro do try principal; como não é DelayedError nem
        // AcbrHttpError, cai no ramo genérico do catch — que, com tentativas ainda disponíveis
        // (attemptCount 0 < maxAttempts 5), registra o erro em `lastError` e reagenda o job em
        // vez de deixá-lo travado silenciosamente. Este teste documenta esse comportamento
        // existente (não o altera).
        await assert.rejects(processCteEmissionJob(job, deps), (err) => err instanceof DelayedError);

        assert.equal(submitMock.mock.callCount(), 0, 'poll-only nunca deve chamar submit');
        assert.equal(pollMock.mock.callCount(), 0, 'sem providerDocId não há o que consultar — poll nunca deveria ser chamado');
        assert.match(prismaBundle.jobState.lastError ?? '', /poll-only sem providerDocId/, 'o erro de estado inconsistente deve ficar registrado em lastError');
        assert.equal(prismaBundle.jobState.attemptCount, 1);
        assert.equal(moveToDelayed.mock.callCount(), 1);
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

    it('Onda 0 — retry com providerDocIdPending já gravado no job.data (Redis) NUNCA rechama submitCteToAcbr, só completa a persistência no Postgres', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: null, phase: 'QUEUED', attemptCount: 0, maxAttempts: 5 }));
        const { job } = makeJob({
            calcId: 'calc-1',
            cteEmissionJobId: 'job-1',
            phaseHint: 'submit',
            providerDocIdPending: 'doc-from-previous-attempt',
        });
        const submitMock = mock.fn(async () => ({ providerDocId: 'should-never-be-used' }));
        const pollMock = mock.fn(async (_providerDocId: string, _ambiente: string, _attempt: number): Promise<CtePollOutcome> => ({ kind: 'PENDING' }));
        const deps = makeDeps(
            {
                submitCteToAcbr: submitMock as unknown as CteEmissionProcessorDeps['submitCteToAcbr'],
                pollCteStatusOnce: pollMock as unknown as CteEmissionProcessorDeps['pollCteStatusOnce'],
            },
            prismaBundle,
        );

        await assert.rejects(processCteEmissionJob(job, deps), (err) => err instanceof DelayedError);

        assert.equal(submitMock.mock.callCount(), 0, 'não deve rechamar a ACBr — o doc já tinha sido confirmado antes do blip do Postgres');
        assert.equal(prismaBundle.jobState.providerDocId, 'doc-from-previous-attempt');
        assert.equal(prismaBundle.calcState.status, 'CTE_PROCESSING');
    });
});

describe('handleCteJobExhausted', () => {
    const jobDataExhausted: CteEmissionJobData = { calcId: 'calc-1', cteEmissionJobId: 'job-1' };

    it('marca PENDING_RECONCILIATION e cria um SystemAlert na primeira ocorrência', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1', phase: 'POLLING' }));
        const alertMock = mock.fn(async (_params: Parameters<CteEmissionProcessorDeps['createOrMergeSystemAlert']>[0]) => {});
        const deps = makeDeps({ createOrMergeSystemAlert: alertMock as unknown as CteEmissionProcessorDeps['createOrMergeSystemAlert'] }, prismaBundle);

        await handleCteJobExhausted(jobDataExhausted, new Error('todas as tentativas do BullMQ esgotadas'), deps);

        assert.equal(prismaBundle.jobState.phase, 'PENDING_RECONCILIATION');
        assert.equal(prismaBundle.calcState.status, 'CTE_PENDING_RECONCILIATION');
        assert.equal(alertMock.mock.callCount(), 1);
        const alertArgs = alertMock.mock.calls[0].arguments[0] as { category: string; context?: { calcId?: string } };
        assert.equal(alertArgs.category, 'FISCAL_PROVIDER_ERROR');
        assert.equal(alertArgs.context?.calcId, 'calc-1');
    });

    it('não faz nada se o job já está em fase terminal (DONE) — evita sobrescrever um resultado já concluído', async () => {
        const prismaBundle = makeFakePrisma(makeJobRecord({ providerDocId: 'doc-1', phase: 'DONE' }), { status: 'CTE_AUTHORIZED' });
        const alertMock = mock.fn(async (_params: Parameters<CteEmissionProcessorDeps['createOrMergeSystemAlert']>[0]) => {});
        const deps = makeDeps({ createOrMergeSystemAlert: alertMock as unknown as CteEmissionProcessorDeps['createOrMergeSystemAlert'] }, prismaBundle);

        await handleCteJobExhausted(jobDataExhausted, new Error('não deveria importar'), deps);

        assert.equal(prismaBundle.jobState.phase, 'DONE');
        assert.equal(prismaBundle.calcState.status, 'CTE_AUTHORIZED');
        assert.equal(alertMock.mock.callCount(), 0);
    });
});
