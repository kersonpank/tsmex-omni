import type { Job } from 'bullmq';
import { DelayedError } from 'bullmq';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { EfreteApiError } from '../efrete/efreteHttp.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from '../vehicleUnitService.js';
import { resolveManifestComposition, tractionRntrc, type VehicleUnitParty } from '../vehicleUnitRules.js';
import { ensureMotoristaRegistrado, ensureProprietarioRegistrado, ensureVeiculoRegistrado, proprietarioFromLink } from '../efrete/efreteCadastro.js';
import { submitCiotToEfrete, consultarStatusCiot } from '../efrete/efreteCiotEmit.js';
import { obterCiotPdf } from '../efrete/efreteCiotEmit.js';
import { buildCiotPayload } from '../efrete/efreteCiotMapper.js';
import { buildCiotEmissionInputForJob } from './ciotEmissionJobInput.js';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import type { CiotEmissionJobData } from './ciotEmissionQueue.js';
import { persistCiotProviderState } from '../ciotProviderState.js';

const RETRY_DELAY_MS = 5_000;
const isConfirmedFailure = (error: unknown) => error instanceof AppError || error instanceof EfreteApiError && (error.httpStatus === undefined || error.httpStatus === 200) && Boolean(error.excecaoMensagem);

type CiotEmissionJobRecord = Awaited<ReturnType<typeof prisma.ciotEmissionJob.findUniqueOrThrow>>;

/**
 * Dependências injetáveis — mesmo racional de `cteEmissionProcessor.ts`: permite testar o
 * state machine (cadastros/idempotência/submit/erro) sem falar com Postgres/Redis/eFrete de
 * verdade.
 */
export interface CiotEmissionProcessorDeps {
    prisma: {
        ciotEmissionJob: Pick<typeof prisma.ciotEmissionJob, 'findUniqueOrThrow' | 'update'>;
        manifest: Pick<typeof prisma.manifest, 'findUniqueOrThrow'>;
        manifestFiscalDocument: Pick<typeof prisma.manifestFiscalDocument, 'create'> & Partial<Pick<typeof prisma.manifestFiscalDocument, 'findFirst' | 'update'>>;
        /** Endereço do responsável RNTRC para o Gravar Proprietário. */
        person?: Pick<typeof prisma.person, 'findUnique'>;
        ciotEmissionAttempt?: Pick<typeof prisma.ciotEmissionAttempt, 'create' | 'update'>;
    };
    ensureMotoristaRegistrado: typeof ensureMotoristaRegistrado;
    ensureProprietarioRegistrado: typeof ensureProprietarioRegistrado;
    ensureVeiculoRegistrado: typeof ensureVeiculoRegistrado;
    consultarStatusCiot: typeof consultarStatusCiot;
    submitCiotToEfrete: typeof submitCiotToEfrete;
    obterCiotPdf: typeof obterCiotPdf;
    uploadBase64Object: typeof uploadBase64Object;
    buildCiotEmissionInputForJob: typeof buildCiotEmissionInputForJob;
}

export const defaultCiotEmissionProcessorDeps: CiotEmissionProcessorDeps = {
    prisma: {
        ciotEmissionJob: prisma.ciotEmissionJob,
        manifest: prisma.manifest,
        manifestFiscalDocument: prisma.manifestFiscalDocument,
        person: prisma.person,
        ciotEmissionAttempt: prisma.ciotEmissionAttempt,
    },
    ensureMotoristaRegistrado,
    ensureProprietarioRegistrado,
    ensureVeiculoRegistrado,
    consultarStatusCiot,
    submitCiotToEfrete,
    obterCiotPdf,
    uploadBase64Object,
    buildCiotEmissionInputForJob,
};

async function rescheduleJob(job: Job<CiotEmissionJobData>, delayMs: number): Promise<never> {
    await job.moveToDelayed(Date.now() + delayMs, job.token);
    throw new DelayedError();
}

async function markFailed(
    deps: CiotEmissionProcessorDeps,
    ciotEmissionJobId: string,
    manifestId: string,
    fiscalEmitterId: string | null,
    reason: string,
    rawPayload?: unknown,
    rawResponse?: unknown,
): Promise<void> {
    await deps.prisma.ciotEmissionJob.update({ where: { id: ciotEmissionJobId }, data: { phase: 'FAILED', lastError: reason } });
    await deps.prisma.manifestFiscalDocument.create({
        data: {
            manifestId,
            fiscalEmitterId,
            documentType: 'CIOT',
            status: 'REJECTED',
            statusReason: reason,
            rawPayload: rawPayload as object | undefined,
            rawResponse: rawResponse as object | undefined,
            rejectedAt: new Date(),
        },
    });
}

async function markPendingReconciliation(deps: CiotEmissionProcessorDeps, ciotEmissionJobId: string, reason: string): Promise<void> {
    await deps.prisma.ciotEmissionJob.update({
        where: { id: ciotEmissionJobId },
        data: { phase: 'PENDING_RECONCILIATION', lastError: reason },
    });
}

async function archiveCiotPdf(deps: CiotEmissionProcessorDeps, job: CiotEmissionJobRecord, code: string, environment: 'producao' | 'homologacao', authorized: any, protocol?: string, rawPayload?: unknown, rawResponse?: unknown) {
    const pdf = await deps.obterCiotPdf(code, environment);
    const uploaded = await deps.uploadBase64Object({ base64: pdf, fileName: `${code}.pdf`, mimeType: 'application/pdf', keyPrefix: `manifests/${job.manifestId}/ciot` });
    const data = { manifestId: job.manifestId, documentType: 'CIOT' as const, status: 'AUTHORIZED' as const, number: code, protocol, environment: environment === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO', rawPayload: rawPayload as object | undefined, rawResponse: rawResponse as object | undefined, pdfUrl: `s3:${uploaded.storageKey}`, authorizedAt: authorized?.authorizedAt ?? new Date(), statusReason: null };
    if (authorized && deps.prisma.manifestFiscalDocument.update) await deps.prisma.manifestFiscalDocument.update({ where: { id: authorized.id }, data });
    else await deps.prisma.manifestFiscalDocument.create({ data });
    await deps.prisma.ciotEmissionJob.update({ where: { id: job.id }, data: { phase: 'DONE', attemptCount: 0 } });
}

export async function processCiotEmissionJob(
    job: Job<CiotEmissionJobData>,
    deps: CiotEmissionProcessorDeps = defaultCiotEmissionProcessorDeps,
): Promise<void> {
    const { ciotEmissionJobId } = job.data;
    let ciotJob: CiotEmissionJobRecord | null = null;
    let definiteRejectionPossible = false;
    let attemptId: string | undefined;
    let rawPayload: unknown;

    try {
        ciotJob = await deps.prisma.ciotEmissionJob.findUniqueOrThrow({ where: { id: ciotEmissionJobId } });
        if (ciotJob.phase === 'DONE') return;
        const attempt = await deps.prisma.ciotEmissionAttempt?.create({ data: { jobId: ciotJob.id, requestData: ciotJob.requestData ?? {}, phase: 'PROCESSING' } });
        attemptId = attempt?.id;
        definiteRejectionPossible = ciotJob.phase === 'QUEUED';

        const storedEnvironment = ciotJob.environment === 'PRODUCAO' ? 'producao' : ciotJob.environment === 'HOMOLOGACAO' ? 'homologacao' : undefined;
        if (ciotJob.phase === 'DOWNLOADING_FILES' && ciotJob.codigoIdentificacaoOperacao && storedEnvironment && !(ciotJob.requestData as { matrizCnpj?: string } | null)?.matrizCnpj) {
            const authorized = await deps.prisma.manifestFiscalDocument.findFirst?.({ where: { manifestId: ciotJob.manifestId, documentType: 'CIOT', status: { in: ['READY', 'AUTHORIZED'] }, number: ciotJob.codigoIdentificacaoOperacao } });
            if (authorized?.pdfUrl?.startsWith('s3:')) { await deps.prisma.ciotEmissionJob.update({ where: { id: ciotJob.id }, data: { phase: 'DONE', attemptCount: 0 } }); return; }
            await archiveCiotPdf(deps, ciotJob, ciotJob.codigoIdentificacaoOperacao, storedEnvironment, authorized);
            if (attemptId) await deps.prisma.ciotEmissionAttempt!.update({ where: { id: attemptId }, data: { phase: 'DONE' } });
            return;
        }
        // Consultar primeiro evita alterar cadastros de uma operação já existente após timeout.
        let built = storedEnvironment ? undefined : await deps.buildCiotEmissionInputForJob(ciotEmissionJobId);
        const environment = storedEnvironment ?? built!.environment;
        definiteRejectionPossible = false;
        const storedMatrix = (ciotJob.requestData as { matrizCnpj?: string } | null)?.matrizCnpj;
        if (!storedMatrix && !built) built = await deps.buildCiotEmissionInputForJob(ciotEmissionJobId);
        const existing = await deps.consultarStatusCiot(ciotJob.idOperacaoCliente, environment, storedMatrix ?? built!.mapperInput.matrizCnpj);
        if (!existing.exists && ciotJob.codigoIdentificacaoOperacao) throw new Error('CIOT conhecido não confirmado pela consulta. Mantenha a conciliação pendente.');
        if (existing.exists) {
            if (!existing.codigoIdentificacaoOperacao || !existing.estado) throw new Error('Consulta de CIOT inconclusiva.');
            const document = await persistCiotProviderState({ ...ciotJob, environment: environment === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO' }, existing, deps.prisma as Parameters<typeof persistCiotProviderState>[2]);
            if (attemptId) await deps.prisma.ciotEmissionAttempt!.update({ where: { id: attemptId }, data: { rawResponse: existing as unknown as object, phase: existing.estado === 'EmViagem' ? 'DOWNLOADING_FILES' : 'DONE' } });
            ciotJob.codigoIdentificacaoOperacao = existing.codigoIdentificacaoOperacao;
            ciotJob.phase = existing.estado === 'EmViagem' ? 'DOWNLOADING_FILES' : 'DONE';
            await deps.prisma.ciotEmissionJob.update({ where: { id: ciotJob.id }, data: { phase: ciotJob.phase, codigoIdentificacaoOperacao: existing.codigoIdentificacaoOperacao, environment: environment === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO', lastError: existing.estado === 'EmViagem' ? null : `CIOT ${existing.estado}. Regularize os documentos vinculados.` } });
            if (existing.estado === 'EmViagem') await archiveCiotPdf(deps, ciotJob, existing.codigoIdentificacaoOperacao, environment, document, existing.protocoloServico);
            if (attemptId) await deps.prisma.ciotEmissionAttempt!.update({ where: { id: attemptId }, data: { phase: 'DONE' } });
            return;
        }
        definiteRejectionPossible = true;
        built ??= await deps.buildCiotEmissionInputForJob(ciotEmissionJobId);
        const { mapperInput } = built;

        const manifest = await deps.prisma.manifest.findUniqueOrThrow({
            where: { id: ciotJob.manifestId },
            include: { link: { include: { person: true, ...linkVehicleInclude } }, driver: { include: { person: true } }, vehicleAssignments: manifestVehicleAssignmentsInclude },
        });
        if (!manifest.link) throw new Error(`Manifesto ${ciotJob.manifestId} sem Link atribuído — estado inconsistente.`);
        if (!manifest.driver) throw new Error(`Manifesto ${ciotJob.manifestId} sem Driver atribuído — estado inconsistente.`);

        // Fase 1: cadastros (idempotentes na própria eFrete — sempre antes de emitir operação).
        if (ciotJob.phase === 'QUEUED') {
            definiteRejectionPossible = true;
            await deps.ensureMotoristaRegistrado(manifest.driver, environment);
            // Proprietário na eFrete = responsável RNTRC de cada unidade, lido do retrato da viagem
            // (nunca do cadastro atual). Retrato antigo sem responsável: legado do Link/cavalo.
            const composition = resolveManifestComposition(manifest);
            if (!composition.traction) throw new Error(`Manifesto ${ciotJob.manifestId} sem cavalo na composição veicular — estado inconsistente.`);
            const holders = new Map<string, VehicleUnitParty>();
            for (const unit of composition.units) if (unit.rntrcHolder) holders.set(unit.rntrcHolder.personId, unit.rntrcHolder);
            if (composition.traction.rntrcHolder === undefined) {
                await deps.ensureProprietarioRegistrado({
                    ...proprietarioFromLink(manifest.link),
                    rntrc: tractionRntrc(composition, manifest.link.rntrc),
                    ...(composition.traction.ownerDocument ? { document: composition.traction.ownerDocument } : {}),
                    ...(composition.traction.ownerName ? { name: composition.traction.ownerName } : {}),
                }, environment);
            }
            for (const holder of holders.values()) {
                const person = (await deps.prisma.person?.findUnique({ where: { id: holder.personId } })) ?? null;
                await deps.ensureProprietarioRegistrado({ document: holder.document, name: holder.name, rntrc: holder.rntrc, person }, environment);
            }
            // Cada placa da composição (cavalo e reboques) precisa estar gravada na e-Frete antes do CIOT.
            for (const unit of composition.units) await deps.ensureVeiculoRegistrado(unit, environment);
            await deps.prisma.ciotEmissionJob.update({ where: { id: ciotEmissionJobId }, data: { phase: 'CADASTROS_ENSURING' } });
        }

        // Fase 2: idempotência — NUNCA reenviar sem checar primeiro se já existe CIOT pra este
        // idOperacaoCliente (timeout anterior pode ter sido aceito do lado da eFrete mesmo sem
        // resposta chegar aqui; reenviar direto duplicaria o CIOT e gera multa ANTT).
        definiteRejectionPossible = false;
        let codigoIdentificacaoOperacao = existing.codigoIdentificacaoOperacao;
        let protocoloServico = existing.protocoloServico;
        let rawResponse: unknown = existing.exists ? existing : undefined;

        if (!existing.exists) {
            definiteRejectionPossible = true;
            const payload = buildCiotPayload(mapperInput);
            rawPayload = payload;
            if (attemptId) await deps.prisma.ciotEmissionAttempt!.update({ where: { id: attemptId }, data: { phase: 'SUBMITTED', rawPayload: payload as unknown as object } });
            const submitted = await deps.submitCiotToEfrete(payload, environment);
            codigoIdentificacaoOperacao = submitted.codigoIdentificacaoOperacao;
            protocoloServico = submitted.protocoloServico;
            rawResponse = submitted.raw;
            if (attemptId) await deps.prisma.ciotEmissionAttempt!.update({ where: { id: attemptId }, data: { phase: 'DOWNLOADING_FILES', rawResponse: rawResponse as object } });
        }

        if (!codigoIdentificacaoOperacao) {
            throw new Error('eFrete não retornou CodigoIdentificacaoOperacao nem na consulta de idempotência nem na emissão.');
        }

        const authorized = await deps.prisma.manifestFiscalDocument.findFirst?.({
            where: { manifestId: ciotJob.manifestId, documentType: 'CIOT', status: 'AUTHORIZED', number: codigoIdentificacaoOperacao },
        });
        if (authorized?.pdfUrl?.startsWith('s3:')) {
            await deps.prisma.ciotEmissionJob.update({ where: { id: ciotEmissionJobId }, data: { phase: 'DONE', codigoIdentificacaoOperacao, attemptCount: 0 } });
            return;
        }
        // Compatibilidade dos testes/consumidores que injetam apenas o fluxo de emissão;
        // o processor padrão sempre injeta o arquivamento obrigatório abaixo.
        await deps.prisma.ciotEmissionJob.update({
            where: { id: ciotEmissionJobId },
            data: { phase: 'DOWNLOADING_FILES', codigoIdentificacaoOperacao, environment: environment === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO' },
        });
        ciotJob.phase = 'DOWNLOADING_FILES';
        ciotJob.codigoIdentificacaoOperacao = codigoIdentificacaoOperacao;
        const pendingDocument = await deps.prisma.manifestFiscalDocument.create({ data: { manifestId: ciotJob.manifestId, documentType: 'CIOT', status: 'READY', number: codigoIdentificacaoOperacao, protocol: protocoloServico, environment: environment === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO', rawPayload: rawPayload as object, rawResponse: rawResponse as object, statusReason: 'CIOT confirmado; recuperação do PDF pendente.' } });
        await archiveCiotPdf(deps, ciotJob, codigoIdentificacaoOperacao, environment, pendingDocument, protocoloServico, rawPayload, rawResponse);
        if (attemptId) await deps.prisma.ciotEmissionAttempt!.update({ where: { id: attemptId }, data: { phase: 'DONE' } });
    } catch (err) {
        if (err instanceof DelayedError) throw err;

        if (!ciotJob) {
            // findUniqueOrThrow inicial falhou — sem attemptCount/maxAttempts pra decidir reagendar.
            throw err;
        }
        const confirmedFailure = definiteRejectionPossible && isConfirmedFailure(err);
        if (attemptId) await deps.prisma.ciotEmissionAttempt!.update({ where: { id: attemptId }, data: {
            phase: ciotJob.phase === 'DOWNLOADING_FILES' ? 'DOWNLOADING_FILES' : confirmedFailure ? 'REJECTED' : 'UNKNOWN',
            lastError: err instanceof Error ? err.message : String(err),
            ...(err instanceof EfreteApiError ? { rawResponse: { code: err.excecaoCodigo, message: err.excecaoMensagem, httpStatus: err.httpStatus } } : {}),
        } });

        if (ciotJob.phase === 'DOWNLOADING_FILES' && ciotJob.codigoIdentificacaoOperacao) {
            await deps.prisma.ciotEmissionJob.update({ where: { id: ciotEmissionJobId }, data: { phase: 'DOWNLOADING_FILES', lastError: err instanceof Error ? err.message : String(err) } });
            return;
        }

        // Rejeição de negócio da própria eFrete (`Sucesso: false` com Excecao preenchida — ex.:
        // piso mínimo do Lotação) é definitiva, não transitória: reenviar não muda o resultado.
        if (confirmedFailure) {
            if (!(err instanceof EfreteApiError) && !(err instanceof AppError)) throw err;
            const reason = err instanceof EfreteApiError ? err.excecaoMensagem! : err.message;
            await markFailed(
                deps,
                ciotEmissionJobId,
                ciotJob.manifestId,
                null,
                reason,
                rawPayload,
                err instanceof EfreteApiError ? { excecaoCodigo: err.excecaoCodigo, excecaoMensagem: err.excecaoMensagem } : { stage: 'PREFLIGHT', error: reason },
            );
            return;
        }

        // Timeout de rede ou instabilidade transitória: reagenda até maxAttempts, depois
        // reconciliação manual — nunca marca REJECTED por timeout (pode ter sido aceito do
        // outro lado; só reconciliação humana confirma).
        const nextAttempt = ciotJob.attemptCount + 1;
        if (nextAttempt >= ciotJob.maxAttempts) {
            await markPendingReconciliation(deps, ciotEmissionJobId, `Falha de comunicação persistente com a eFrete: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        await deps.prisma.ciotEmissionJob.update({
            where: { id: ciotEmissionJobId },
            data: { attemptCount: nextAttempt, lastError: err instanceof Error ? err.message : String(err) },
        });
        await rescheduleJob(job, RETRY_DELAY_MS);
    }
}

/**
 * Chamado pelo `worker.ts` no `.on('failed', ...)` do worker `ciot-emission`, só quando o
 * BullMQ esgotou todas as `attempts` (não vai retentar mais) — fecha o buraco final do
 * pipeline: sem isso, um job morto por exceção não classificada travaria o manifesto sem
 * nenhum caminho de reconciliação manual (mesmo racional de `handleCteJobExhausted`).
 */
export async function handleCiotJobExhausted(
    jobData: CiotEmissionJobData,
    err: Error,
    deps: CiotEmissionProcessorDeps = defaultCiotEmissionProcessorDeps,
): Promise<void> {
    const { ciotEmissionJobId } = jobData;
    const job = await deps.prisma.ciotEmissionJob.findUniqueOrThrow({ where: { id: ciotEmissionJobId } }).catch(() => null);
    if (job && ['DONE', 'FAILED', 'PENDING_RECONCILIATION'].includes(job.phase)) return;
    await markPendingReconciliation(deps, ciotEmissionJobId, `Job esgotou todas as tentativas automáticas da fila: ${err.message}`);
}
