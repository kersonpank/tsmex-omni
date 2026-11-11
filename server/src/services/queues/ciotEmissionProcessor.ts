import type { Job } from 'bullmq';
import { DelayedError } from 'bullmq';
import { Prisma } from '@prisma/client';
import { AppError } from '../../middleware/errorHandler.js';
import prisma from '../../lib/prisma.js';
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

function readableEfreteMessage(message: string): string {
    const start = message.indexOf('["Rejeição');
    if (start < 0) return message;
    try {
        const rejections: unknown = JSON.parse(message.slice(start, message.lastIndexOf(']') + 1));
        if (Array.isArray(rejections) && rejections.every((item) => typeof item === 'string')) return rejections.join(' | ');
    } catch { /* Preserva a mensagem original quando o conteúdo não é JSON válido. */ }
    return message;
}

const RETRY_DELAY_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** Espera crescente (5s, 10s, 20s ... até 5 min) entre tentativas de arquivar o PDF. */
export function pdfRetryDelayMs(attemptCount: number): number {
    return Math.min(RETRY_DELAY_MS * 2 ** Math.max(0, attemptCount), MAX_BACKOFF_MS);
}

/** Erro de dado/validação local (nada saiu para a eFrete): AppError ou erro de formato, nunca de banco. */
function isLocalValidationError(err: unknown): boolean {
    if (err instanceof AppError) return err.statusCode < 500;
    if (err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientInitializationError
        || err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientRustPanicError) return false;
    return err instanceof Error && !(err instanceof EfreteApiError);
}

class LocalInputError extends Error {
    constructor(readonly original: unknown) {
        super(original instanceof Error ? original.message : String(original));
    }
}

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
    const data = { manifestId: job.manifestId, documentType: 'CIOT' as const, status: 'AUTHORIZED' as const, number: code, protocol, environment: environment === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO', rawPayload: rawPayload as object | undefined, rawResponse: rawResponse as object | undefined, pdfUrl: `s3:${uploaded.storageKey}`, authorizedAt: new Date() };
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

    try {
        ciotJob = await deps.prisma.ciotEmissionJob.findUniqueOrThrow({ where: { id: ciotEmissionJobId } });
        if (ciotJob.phase === 'DONE') return;

        const storedEnvironment = ciotJob.environment === 'PRODUCAO' ? 'producao' : ciotJob.environment === 'HOMOLOGACAO' ? 'homologacao' : undefined;
        if (ciotJob.phase === 'DOWNLOADING_FILES' && ciotJob.codigoIdentificacaoOperacao && storedEnvironment) {
            const authorized = await deps.prisma.manifestFiscalDocument.findFirst?.({ where: { manifestId: ciotJob.manifestId, documentType: 'CIOT', status: 'AUTHORIZED', number: ciotJob.codigoIdentificacaoOperacao } });
            if (authorized?.pdfUrl?.startsWith('s3:')) { await deps.prisma.ciotEmissionJob.update({ where: { id: ciotJob.id }, data: { phase: 'DONE', attemptCount: 0 } }); return; }
            await archiveCiotPdf(deps, ciotJob, ciotJob.codigoIdentificacaoOperacao, storedEnvironment, authorized);
            return;
        }
        let built: Awaited<ReturnType<typeof deps.buildCiotEmissionInputForJob>>;
        try {
            built = await deps.buildCiotEmissionInputForJob(ciotEmissionJobId);
        } catch (buildError) {
            // Montagem do pedido é 100% local (nada foi enviado à eFrete): erro de cadastro/dado.
            if (isLocalValidationError(buildError)) throw new LocalInputError(buildError);
            throw buildError;
        }
        const { mapperInput, environment: builtEnvironment } = built;
        const environment = storedEnvironment ?? builtEnvironment;

        const manifest = await deps.prisma.manifest.findUniqueOrThrow({
            where: { id: ciotJob.manifestId },
            include: { link: { include: { person: true, ...linkVehicleInclude } }, driver: { include: { person: true } }, vehicleAssignments: manifestVehicleAssignmentsInclude },
        });
        if (!manifest.link) throw new Error(`Manifesto ${ciotJob.manifestId} sem Link atribuído — estado inconsistente.`);
        if (!manifest.driver) throw new Error(`Manifesto ${ciotJob.manifestId} sem Driver atribuído — estado inconsistente.`);

        // Fase 1: cadastros (idempotentes na própria eFrete — sempre antes de emitir operação).
        if (ciotJob.phase === 'QUEUED') {
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
        const existing = await deps.consultarStatusCiot(ciotJob.idOperacaoCliente, mapperInput.matrizCnpj, environment);
        let codigoIdentificacaoOperacao = existing.codigoIdentificacaoOperacao;
        let protocoloServico = existing.protocoloServico;
        let rawResponse: unknown = existing.exists ? existing : undefined;
        let rawPayload: unknown;

        if (!existing.exists) {
            const payload = buildCiotPayload(mapperInput);
            rawPayload = payload;
            const submitted = await deps.submitCiotToEfrete(payload, environment);
            codigoIdentificacaoOperacao = submitted.codigoIdentificacaoOperacao;
            protocoloServico = submitted.protocoloServico;
            rawResponse = submitted.raw;
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
        const pdf = await deps.obterCiotPdf(codigoIdentificacaoOperacao, environment);
        const uploaded = await deps.uploadBase64Object({ base64: pdf, fileName: `${codigoIdentificacaoOperacao}.pdf`, mimeType: 'application/pdf', keyPrefix: `manifests/${ciotJob.manifestId}/ciot` });
        const documentData = {
                manifestId: ciotJob.manifestId,
                documentType: 'CIOT' as const,
                status: 'AUTHORIZED' as const,
                number: codigoIdentificacaoOperacao,
                protocol: protocoloServico,
                environment: environment === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO',
                rawPayload: rawPayload as object | undefined,
                rawResponse: rawResponse as object | undefined,
                pdfUrl: `s3:${uploaded.storageKey}`,
                authorizedAt: new Date(),
        };
        if (authorized && deps.prisma.manifestFiscalDocument.update) await deps.prisma.manifestFiscalDocument.update({ where: { id: authorized.id }, data: { ...documentData, rawPayload: rawPayload as object | undefined, rawResponse: rawResponse as object | undefined } });
        else await deps.prisma.manifestFiscalDocument.create({ data: documentData });
        await deps.prisma.ciotEmissionJob.update({ where: { id: ciotEmissionJobId }, data: { phase: 'DONE', attemptCount: 0 } });
    } catch (err) {
        if (err instanceof DelayedError) throw err;

        if (!ciotJob) {
            // findUniqueOrThrow inicial falhou — sem attemptCount/maxAttempts pra decidir reagendar.
            throw err;
        }

        if (err instanceof LocalInputError) {
            // Falha de validação local antes de qualquer chamada ao provedor: FAILED com a mensagem real.
            await deps.prisma.ciotEmissionJob.update({ where: { id: ciotEmissionJobId }, data: { phase: 'FAILED', lastError: err.message } });
            return;
        }

        const message = err instanceof EfreteApiError ? readableEfreteMessage(err.excecaoMensagem || err.message) : err instanceof Error ? err.message : String(err);
        if (err instanceof EfreteApiError) {
            console.warn({ source: 'ciotEmission', manifestId: ciotJob.manifestId, idOperacaoCliente: ciotJob.idOperacaoCliente, excecaoCodigo: err.excecaoCodigo, message });
        }
        if (ciotJob.phase === 'DOWNLOADING_FILES' && ciotJob.codigoIdentificacaoOperacao) {
            // O CIOT já existe na eFrete: só falta arquivar o PDF. Tenta de novo com espera crescente
            // até maxAttempts; ao esgotar, deixa o motivo claro (reenviar pela rota retoma este job).
            const nextAttempt = ciotJob.attemptCount + 1;
            if (nextAttempt >= ciotJob.maxAttempts) {
                await deps.prisma.ciotEmissionJob.update({
                    where: { id: ciotEmissionJobId },
                    data: {
                        phase: 'DOWNLOADING_FILES',
                        attemptCount: 0,
                        lastError: `CIOT ${ciotJob.codigoIdentificacaoOperacao} emitido, mas o PDF não foi arquivado após ${nextAttempt} tentativas: ${message}. Reenvie a emissão para retomar o arquivamento.`,
                    },
                });
                return;
            }
            await deps.prisma.ciotEmissionJob.update({
                where: { id: ciotEmissionJobId },
                data: { phase: 'DOWNLOADING_FILES', attemptCount: nextAttempt, lastError: message },
            });
            await rescheduleJob(job, pdfRetryDelayMs(ciotJob.attemptCount));
        }

        // Rejeição de negócio da própria eFrete (`Sucesso: false` com Excecao preenchida — ex.:
        // piso mínimo do Lotação) é definitiva, não transitória: reenviar não muda o resultado.
        if (err instanceof EfreteApiError && err.excecaoMensagem) {
            await markFailed(
                deps,
                ciotEmissionJobId,
                ciotJob.manifestId,
                null,
                message,
                undefined,
                { excecaoCodigo: err.excecaoCodigo, excecaoMensagem: err.excecaoMensagem },
            );
            return;
        }

        // Timeout de rede ou instabilidade transitória: reagenda até maxAttempts, depois
        // reconciliação manual — nunca marca REJECTED por timeout (pode ter sido aceito do
        // outro lado; só reconciliação humana confirma).
        const nextAttempt = ciotJob.attemptCount + 1;
        if (nextAttempt >= ciotJob.maxAttempts) {
            await markPendingReconciliation(deps, ciotEmissionJobId, `Falha de comunicação persistente com a eFrete: ${message}`);
            return;
        }
        await deps.prisma.ciotEmissionJob.update({
            where: { id: ciotEmissionJobId },
            data: { attemptCount: nextAttempt, lastError: message },
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
