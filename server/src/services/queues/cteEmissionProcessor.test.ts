import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { DelayedError, type Job } from 'bullmq';
import { processCteEmissionJob, handleCteJobExhausted, xmlConfirmsCteAuthorization, type CteEmissionProcessorDeps } from './cteEmissionProcessor.js';
import type { CteEmissionJobData } from './cteEmissionQueue.js';
import { AcbrHttpError } from '../acbr/acbrHttp.js';
import { pollCteStatusOnce, type CtePollOutcome, type CteSubmitDeps } from '../acbr/acbrCteEmit.js';

type FakeRecord = {
    id: string; calcId: string; queueJobId: string | null; providerDocId: string | null;
    phase: string; submissionGuardVersion: number | null; submitStartedAt: Date | null;
    attemptCount: number; maxAttempts: number; lastError: string | null; lastHttpStatus: number | null;
    pausedForQuota: boolean; xmlDownloadedAt: Date | null; pdfDownloadedAt: Date | null;
    rejectionCode: string | null; rejectionReason: string | null;
};

const key = '1'.repeat(44);
const protocol = '123456789';
const authorizedXml = `<cteProc><CTe><infCte Id="CTe${key}"/></CTe><protCTe><infProt><chCTe>${key}</chCTe><nProt>${protocol}</nProt><dhRecbto>2026-10-27T09:30:00-03:00</dhRecbto><cStat>100</cStat></infProt></protCTe></cteProc>`;

function fakeDatabase(overrides: Partial<FakeRecord> = {}, calcOverrides: Record<string, unknown> = {}) {
    const record: FakeRecord = {
        id: 'job-1', calcId: 'calc-1', queueJobId: null, providerDocId: null, phase: 'QUEUED',
        submissionGuardVersion: 1, submitStartedAt: null, attemptCount: 0, maxAttempts: 5,
        lastError: null, lastHttpStatus: null, pausedForQuota: false, xmlDownloadedAt: null, pdfDownloadedAt: null,
        rejectionCode: null, rejectionReason: null,
        ...overrides,
    };
    const calc: Record<string, unknown> = { id: 'calc-1', status: 'CTE_SENT', cteXml: null, ...calcOverrides };
    let tail = Promise.resolve();
    let failProviderIdOnce = false;
    const equal = (a: unknown, b: unknown) => a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    const matches = (state: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([name, value]) => {
        if (value && typeof value === 'object' && !(value instanceof Date) && 'in' in value) return (value as { in: unknown[] }).in.includes(state[name]);
        return equal(state[name], value);
    });
    const tx = {
        cteEmissionJob: {
            updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
                if (failProviderIdOnce && data.providerDocId) { failProviderIdOnce = false; throw new Error('falha transitória ao persistir ID'); }
                if (!matches(record, where)) return { count: 0 };
                Object.assign(record, data);
                return { count: 1 };
            },
        },
        orderFreightCalculation: {
            updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
                if (!matches(calc, where)) return { count: 0 };
                Object.assign(calc, data);
                return { count: 1 };
            },
        },
    };
    const db = {
        cteEmissionJob: { ...tx.cteEmissionJob, findUniqueOrThrow: async () => ({ ...record }) },
        orderFreightCalculation: { ...tx.orderFreightCalculation, findUniqueOrThrow: async () => ({ ...calc }) },
        $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => {
            const previous = tail;
            let release!: () => void;
            tail = new Promise<void>((resolve) => { release = resolve; });
            await previous;
            const oldRecord = { ...record };
            const oldCalc = { ...calc };
            try { return await fn(tx); }
            catch (err) { Object.assign(record, oldRecord); Object.assign(calc, oldCalc); throw err; }
            finally { release(); }
        },
    } as unknown as CteEmissionProcessorDeps['prisma'];
    return { record, calc, db, failNextIdWrite: () => { failProviderIdOnce = true; } };
}

function bullJob(data: Partial<CteEmissionJobData> = {}, id?: string) {
    const updateData = mock.fn(async (newData: CteEmissionJobData) => { job.data = newData; });
    const moveToDelayed = mock.fn(async () => {});
    const job = { id, data: { calcId: 'calc-1', cteEmissionJobId: 'job-1', ...data }, token: 'token', updateData, moveToDelayed } as unknown as Job<CteEmissionJobData>;
    return { job, updateData, moveToDelayed };
}

function depsFor(db: ReturnType<typeof fakeDatabase>, overrides: Partial<CteEmissionProcessorDeps> = {}): CteEmissionProcessorDeps {
    return {
        prisma: db.db,
        submitCteToAcbr: mock.fn(async () => { throw new Error('POST inesperado'); }),
        pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'PENDING' })),
        downloadCteXml: mock.fn(async () => authorizedXml),
        downloadCtePdf: mock.fn(async () => Buffer.from('pdf')),
        buildCteEmissionInputForJob: mock.fn(async () => ({ input: { ambiente: 'HOMOLOGACAO' }, fiscalEmitterContext: null })) as unknown as CteEmissionProcessorDeps['buildCteEmissionInputForJob'],
        uploadBase64Object: mock.fn(async () => ({ storageKey: 'stored' })) as unknown as CteEmissionProcessorDeps['uploadBase64Object'],
        cteEmissionQueue: { pause: mock.fn(async () => {}) },
        createSystemAlert: mock.fn(async () => {}) as unknown as CteEmissionProcessorDeps['createSystemAlert'],
        createOrMergeSystemAlert: mock.fn(async () => {}) as unknown as CteEmissionProcessorDeps['createOrMergeSystemAlert'],
        ...overrides,
    };
}

function guardedSubmit(fn: () => Promise<{ providerDocId: string }>): CteEmissionProcessorDeps['submitCteToAcbr'] {
    return async (_input, _ref, _emitter, beforePost) => {
        if (!beforePost || !(await beforePost())) return { skipped: true };
        return fn();
    };
}

describe('proteção do worker CT-e', () => {
    it('CAS serializa dois workers após o preflight e grava o marcador antes do único POST', async () => {
        const db = fakeDatabase();
        let arrived = 0;
        let release!: () => void;
        const bothArrived = new Promise<void>((resolve) => { release = resolve; });
        let posts = 0;
        const submit: CteEmissionProcessorDeps['submitCteToAcbr'] = async (_input, _ref, _emitter, beforePost) => {
            if (++arrived === 2) release();
            await bothArrived;
            if (!beforePost || !(await beforePost())) return { skipped: true };
            assert.ok(db.record.submitStartedAt instanceof Date);
            assert.equal(db.calc.status, 'CTE_PROCESSING');
            posts++;
            return { providerDocId: 'doc-1' };
        };
        const deps = depsFor(db, { submitCteToAcbr: submit });
        const results = await Promise.allSettled([processCteEmissionJob(bullJob().job, deps), processCteEmissionJob(bullJob().job, deps)]);
        assert.equal(posts, 1);
        assert.equal(db.record.providerDocId, 'doc-1');
        assert.equal(results.filter((r) => r.status === 'rejected' && r.reason instanceof DelayedError).length, 1);
    });

    it('timeout, 429, 400 e 503 após o marcador são incertos e nunca repetem o POST', async () => {
        for (const err of [new Error('timeout'), new AcbrHttpError('limite', 429), new AcbrHttpError('recusa HTTP', 400), new AcbrHttpError('erro servidor', 503)]) {
            const db = fakeDatabase();
            let posts = 0;
            const deps = depsFor(db, { submitCteToAcbr: guardedSubmit(async () => { posts++; throw err; }) });
            await processCteEmissionJob(bullJob().job, deps);
            await processCteEmissionJob(bullJob().job, deps);
            assert.equal(posts, 1);
            assert.ok(db.record.submitStartedAt);
            assert.equal(db.record.phase, 'PENDING_RECONCILIATION');
            assert.equal(db.calc.status, 'CTE_PENDING_RECONCILIATION');
            assert.match(String(db.calc.cteStatusReason), /pode ter ocorrido/i);
            assert.doesNotMatch(String(db.calc.cteStatusReason), /é seguro|nenhum documento foi submetido/i);
        }
    });

    it('crash após o marcador e jobs legados sem ID nunca chamam POST', async () => {
        for (const overrides of [
            { phase: 'EMPRESA_ENSURING', submitStartedAt: new Date() },
            { phase: 'QUEUED', submissionGuardVersion: null },
            { phase: 'EMPRESA_ENSURING', submissionGuardVersion: null },
        ] as Partial<FakeRecord>[]) {
            const db = fakeDatabase(overrides, { status: overrides.submitStartedAt ? 'CTE_PROCESSING' : 'CTE_SENT' });
            const submit = mock.fn(async () => ({ providerDocId: 'indevido' }));
            await processCteEmissionJob(bullJob().job, depsFor(db, { submitCteToAcbr: submit }));
            assert.equal(submit.mock.callCount(), 0);
            assert.equal(db.record.phase, 'PENDING_RECONCILIATION');
        }
    });

    it('erro de montagem antes do callback permite retry sem marcar submissão', async () => {
        const db = fakeDatabase();
        const submit = mock.fn(async () => { throw new Error('município desconhecido'); });
        const { job } = bullJob();
        await assert.rejects(processCteEmissionJob(job, depsFor(db, { submitCteToAcbr: submit })), DelayedError);
        assert.equal(db.record.submitStartedAt, null);
        assert.equal(db.record.phase, 'QUEUED');
        assert.equal(db.record.attemptCount, 1);
        assert.equal(db.calc.status, 'CTE_SENT');
    });

    it('cálculo não elegível perde o CAS e não inicia POST', async () => {
        const db = fakeDatabase({}, { status: 'CTE_PENDING_RECONCILIATION' });
        let posts = 0;
        const deps = depsFor(db, { submitCteToAcbr: guardedSubmit(async () => { posts++; return { providerDocId: 'doc' }; }) });
        await processCteEmissionJob(bullJob().job, deps);
        assert.equal(posts, 0);
        assert.equal(db.record.submitStartedAt, null);
    });

    it('falha ao confirmar o CAS após commit mantém marcador e não chama POST', async () => {
        const db = fakeDatabase();
        const originalTransaction = db.db.$transaction;
        let once = true;
        db.db.$transaction = async (fn) => {
            const result = await originalTransaction(fn);
            if (once) { once = false; throw new Error('confirmação do commit perdida'); }
            return result;
        };
        let posts = 0;
        const deps = depsFor(db, { submitCteToAcbr: guardedSubmit(async () => { posts++; return { providerDocId: 'doc' }; }) });
        await processCteEmissionJob(bullJob().job, deps);
        assert.equal(posts, 0);
        assert.ok(db.record.submitStartedAt);
        assert.equal(db.record.phase, 'PENDING_RECONCILIATION');
    });

    it('recupera ID do Redis após falha transitória do banco sem repetir POST', async () => {
        const db = fakeDatabase();
        db.failNextIdWrite();
        let posts = 0;
        const deps = depsFor(db, { submitCteToAcbr: guardedSubmit(async () => { posts++; return { providerDocId: 'doc-1' }; }) });
        const { job } = bullJob();
        await assert.rejects(processCteEmissionJob(job, deps), DelayedError);
        assert.equal(db.record.providerDocId, 'doc-1');
        assert.equal(job.data.providerDocIdPending, 'doc-1');
        await assert.rejects(processCteEmissionJob(job, deps), DelayedError);
        assert.equal(posts, 1);
    });

    it('persiste ID no banco mesmo que a gravação no Redis falhe', async () => {
        const db = fakeDatabase();
        const deps = depsFor(db, { submitCteToAcbr: guardedSubmit(async () => ({ providerDocId: 'doc-1' })) });
        const { job, updateData } = bullJob();
        updateData.mock.mockImplementation(async () => { throw new Error('Redis indisponível'); });
        await assert.rejects(processCteEmissionJob(job, deps), DelayedError);
        assert.equal(db.record.providerDocId, 'doc-1');
    });

    it('reconciliação sem ID e resultado desconhecido não enviam nem consultam', async () => {
        const db = fakeDatabase({ phase: 'POLLING', submitStartedAt: new Date() }, { status: 'CTE_PROCESSING' });
        const deps = depsFor(db);
        await processCteEmissionJob(bullJob({ phaseHint: 'poll-only' }).job, deps);
        assert.equal(db.record.phase, 'PENDING_RECONCILIATION');
        assert.equal((deps.submitCteToAcbr as any).mock.callCount(), 0);
        assert.equal((deps.pollCteStatusOnce as any).mock.callCount(), 0);
    });

    it('rejeição efetiva permite reenvio e preserva código no motivo e lastError', async () => {
        const db = fakeDatabase({ providerDocId: 'doc-1', phase: 'POLLING', submitStartedAt: new Date() }, { status: 'CTE_PROCESSING' });
        const deps = depsFor(db, { pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'REJECTED', result: { status: 'REJECTED', rejectionCode: '999', rejectionReason: 'Dados inválidos', rawResponse: {} } })) });
        await processCteEmissionJob(bullJob({ phaseHint: 'poll-only' }).job, deps);
        assert.equal(db.calc.status, 'CTE_REJECTED');
        assert.equal(db.record.phase, 'FAILED');
        assert.equal(db.record.rejectionCode, '999');
        assert.equal(db.record.rejectionReason, 'Dados inválidos');
        assert.match(String(db.calc.cteStatusReason), /999.*Dados inválidos/);
        assert.match(db.record.lastError!, /999/);
    });

    it('rejeição fiscal 524 do adapter chega ao histórico e libera correção', async () => {
        const db = fakeDatabase({ providerDocId: 'doc-1', phase: 'POLLING', submitStartedAt: new Date() }, { status: 'CTE_PROCESSING' });
        const fakeFetch = (async () => ({ status: 'erro', codigo_status: 500, autorizacao: { codigo_status: 524, motivo_status: 'Rejeição: CFOP inválido' } })) as CteSubmitDeps['acbrFetchJson'];
        const deps = depsFor(db, { pollCteStatusOnce: mock.fn(async () => pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0, fakeFetch)) });
        await processCteEmissionJob(bullJob({ phaseHint: 'poll-only' }).job, deps);
        assert.equal(db.calc.status, 'CTE_REJECTED');
        assert.equal(db.record.rejectionCode, '524');
        assert.equal(db.record.rejectionReason, 'Rejeição: CFOP inválido');
    });

    it('duplicidade mantém o bloqueio de reenvio e conserva o código para investigação', async () => {
        const db = fakeDatabase({ providerDocId: 'doc-1', phase: 'POLLING', submitStartedAt: new Date() }, { status: 'CTE_PROCESSING' });
        const deps = depsFor(db, { pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({
            kind: 'RECONCILIATION_REQUIRED', reason: 'Duplicidade de CT-e', rejectionCode: '204', rejectionReason: 'Rejeição: Duplicidade de CT-e',
        })) });
        await processCteEmissionJob(bullJob({ phaseHint: 'poll-only' }).job, deps);
        assert.equal(db.calc.status, 'CTE_PENDING_RECONCILIATION');
        assert.equal(db.record.phase, 'PENDING_RECONCILIATION');
        assert.equal(db.record.rejectionCode, '204');
        assert.equal(db.record.rejectionReason, 'Rejeição: Duplicidade de CT-e');
    });

    it('passa o ID do job ao builder também durante a reconciliação', async () => {
        const db = fakeDatabase({ providerDocId: 'doc-1', phase: 'POLLING' }, { status: 'CTE_PROCESSING' });
        const deps = depsFor(db);
        await assert.rejects(processCteEmissionJob(bullJob({ phaseHint: 'poll-only' }).job, deps), DelayedError);
        assert.deepEqual((deps.buildCteEmissionInputForJob as any).mock.calls[0].arguments, ['calc-1', 'job-1']);
    });

    it('poll com 429 retenta consulta; 402 pausa a fila', async () => {
        for (const status of [429, 402]) {
            const db = fakeDatabase({ providerDocId: 'doc-1', phase: 'POLLING', submitStartedAt: new Date() }, { status: 'CTE_PROCESSING' });
            const pause = mock.fn(async () => {});
            const deps = depsFor(db, { cteEmissionQueue: { pause }, pollCteStatusOnce: mock.fn(async () => { throw new AcbrHttpError('erro', status, { retryInSeconds: 12 }); }) });
            if (status === 429) {
                await assert.rejects(processCteEmissionJob(bullJob().job, deps), DelayedError);
                assert.equal(db.record.lastHttpStatus, 429);
                assert.equal(pause.mock.callCount(), 0);
            } else {
                await processCteEmissionJob(bullJob().job, deps);
                assert.equal(db.record.phase, 'PENDING_RECONCILIATION');
                assert.equal(pause.mock.callCount(), 1);
            }
        }
    });

    it('somente autoriza com chave, protocolo e XML coerente', async () => {
        for (const xml of [authorizedXml, '<cteProc/>']) {
            const db = fakeDatabase({ providerDocId: 'doc-1', phase: 'POLLING', submitStartedAt: new Date() }, { status: 'CTE_PROCESSING' });
            const deps = depsFor(db, {
                downloadCteXml: mock.fn(async () => xml),
                pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({ kind: 'AUTHORIZED', providerDocId: 'doc-1', result: { status: 'AUTHORIZED', accessKey: key, protocol, rawResponse: {} } })),
            });
            await processCteEmissionJob(bullJob().job, deps);
            assert.equal(db.calc.status, xml === authorizedXml ? 'CTE_AUTHORIZED' : 'CTE_PENDING_RECONCILIATION');
            if (xml === authorizedXml) {
                assert.equal(db.calc.cteXml, authorizedXml);
                assert.equal((db.calc.cteAuthorizedAt as Date).toISOString(), '2026-10-27T12:30:00.000Z');
            }
        }
        assert.equal(xmlConfirmsCteAuthorization(authorizedXml, key, protocol), true);
        assert.equal(xmlConfirmsCteAuthorization(authorizedXml, key, 'outro'), false);
        assert.equal(xmlConfirmsCteAuthorization(authorizedXml.replace('100', '204'), key, protocol), false);
        assert.equal(xmlConfirmsCteAuthorization(authorizedXml.replace(`CTe${key}`, `CTe${'2'.repeat(44)}`), key, protocol), false);
        assert.equal(xmlConfirmsCteAuthorization(authorizedXml.replace('2026-10-27T09:30:00-03:00', 'inválida'), key, protocol), false);
    });

    it('usa data do retorno quando o XML não a traz; sem data não fabrica autorização', async () => {
        const xmlWithoutDate = authorizedXml.replace('<dhRecbto>2026-10-27T09:30:00-03:00</dhRecbto>', '');
        for (const responseDate of ['2026-10-26T13:25:00-03:00', null]) {
            const db = fakeDatabase({ providerDocId: 'doc-1', phase: 'POLLING' }, { status: 'CTE_PROCESSING' });
            const deps = depsFor(db, {
                downloadCteXml: mock.fn(async () => xmlWithoutDate),
                pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => ({
                    kind: 'AUTHORIZED', providerDocId: 'doc-1', result: { status: 'AUTHORIZED', accessKey: key, protocol, rawResponse: { autorizacao: { data_autorizacao: responseDate } } },
                })),
            });
            await processCteEmissionJob(bullJob().job, deps);
            assert.equal(db.calc.status, responseDate ? 'CTE_AUTHORIZED' : 'CTE_PENDING_RECONCILIATION');
            if (responseDate) assert.equal((db.calc.cteAuthorizedAt as Date).toISOString(), '2026-10-26T16:25:00.000Z');
            else assert.equal(db.calc.cteAuthorizedAt, undefined);
        }
    });

    it('evento atrasado de execução anterior não sobrescreve reconciliação atual ou resultado terminal', async () => {
        const db = fakeDatabase({ queueJobId: 'reconcile-novo', providerDocId: 'doc-1', phase: 'POLLING' }, { status: 'CTE_PROCESSING' });
        const deps = depsFor(db);
        await handleCteJobExhausted({ calcId: 'calc-1', cteEmissionJobId: 'job-1' }, new Error('antigo'), deps, 'job-antigo');
        assert.equal(db.record.phase, 'POLLING');
        db.record.phase = 'DONE';
        db.calc.status = 'CTE_AUTHORIZED';
        await handleCteJobExhausted({ calcId: 'calc-1', cteEmissionJobId: 'job-1' }, new Error('tardio'), deps, 'reconcile-novo');
        assert.equal(db.calc.status, 'CTE_AUTHORIZED');
    });

    it('consulta iniciada antes da atualização de queueJobId espera sem consultar ou submeter', async () => {
        const db = fakeDatabase({ queueJobId: 'emissao-antiga', providerDocId: 'doc-1', phase: 'POLLING' }, { status: 'CTE_PROCESSING' });
        const deps = depsFor(db);
        const { job } = bullJob({ phaseHint: 'poll-only' }, 'consulta-nova');
        await assert.rejects(processCteEmissionJob(job, deps), DelayedError);
        assert.equal(job.data.queueIdWaitCount, 1);
        assert.equal((deps.pollCteStatusOnce as any).mock.callCount(), 0);
        db.record.queueJobId = 'consulta-nova';
        await assert.rejects(processCteEmissionJob(job, deps), DelayedError);
        assert.equal((deps.pollCteStatusOnce as any).mock.callCount(), 1);
    });

    it('resposta de consulta antiga perde CAS após troca de queueJobId', async () => {
        const db = fakeDatabase({ queueJobId: 'consulta-antiga', providerDocId: 'doc-1', phase: 'POLLING' }, { status: 'CTE_PROCESSING' });
        const deps = depsFor(db, { pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => {
            db.record.queueJobId = 'consulta-nova';
            return { kind: 'REJECTED', result: { status: 'REJECTED', rejectionCode: '999', rawResponse: {} } };
        }) });
        await processCteEmissionJob(bullJob({ phaseHint: 'poll-only' }, 'consulta-antiga').job, deps);
        assert.equal(db.record.phase, 'POLLING');
        assert.equal(db.calc.status, 'CTE_PROCESSING');
        assert.equal(db.record.rejectionCode, null);
    });

    it('resposta antiga não altera cálculo que voltou a CTE_SENT para outra tentativa', async () => {
        const db = fakeDatabase({ providerDocId: 'doc-1', phase: 'POLLING', submitStartedAt: new Date() }, { status: 'CTE_PROCESSING' });
        const deps = depsFor(db, { pollCteStatusOnce: mock.fn(async (): Promise<CtePollOutcome> => {
            db.calc.status = 'CTE_SENT';
            return { kind: 'REJECTED', result: { status: 'REJECTED', rejectionCode: '999', rawResponse: {} } };
        }) });
        await processCteEmissionJob(bullJob().job, deps);
        assert.equal(db.calc.status, 'CTE_SENT');
        assert.equal(db.record.phase, 'POLLING');
    });

    it('guarda ID recuperado sem alterar cálculo já substituído por outra tentativa', async () => {
        const db = fakeDatabase({ phase: 'EMPRESA_ENSURING', submitStartedAt: new Date() }, { status: 'CTE_SENT' });
        const deps = depsFor(db);
        await processCteEmissionJob(bullJob({ providerDocIdPending: 'doc-antigo' }).job, deps);
        assert.equal(db.record.providerDocId, 'doc-antigo');
        assert.equal(db.calc.status, 'CTE_SENT');
        assert.equal((deps.pollCteStatusOnce as any).mock.callCount(), 0);
    });
});
