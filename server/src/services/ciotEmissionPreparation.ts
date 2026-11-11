import { Prisma, type CiotTipoViagem } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { getManifestReadiness } from './manifestReadinessService.js';
import type { StoredCiotRequestData } from './queues/ciotEmissionJobInput.js';
import { resolveMatrizCnpj } from './efrete/efreteConfig.js';

/** Reserva uma única tentativa sob o mesmo bloqueio usado para reabrir a viagem. */
export async function prepareCiotEmission(input: { manifestId: string; expectedUpdatedAt: Date; tipoViagem: CiotTipoViagem; override?: CiotTipoViagem; requestData: StoredCiotRequestData }) {
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Manifest" WHERE "id" = ${input.manifestId} FOR UPDATE`;
        const manifest = await tx.manifest.findUniqueOrThrow({ where: { id: input.manifestId }, include: { fiscalEmitter: { select: { efreteEnvironment: true, rntrc: true, person: { select: { document: true } } } } } });
        if (manifest.status !== 'ACCEPTED' || manifest.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new AppError('A viagem mudou durante a emissão. Atualize e confira os dados.', 409);
        const readiness = await getManifestReadiness(input.manifestId, tx);
        if (!readiness.canEmitCiot) throw new AppError(readiness.actionIssues.ciot.map(item => item.message).join(' '), 422);
        if (input.tipoViagem === 'TAC_AGREGADO' && !/^\d{8,9}$/.test((manifest.fiscalEmitter?.rntrc ?? '').replace(/\D/g, ''))) throw new AppError('TAC Agregado exige RNTRC válido da contratante (empresa emitente).', 422);
        const closed = await tx.manifestFiscalDocument.findFirst({ where: { manifestId: input.manifestId, documentType: 'CIOT', status: 'CLOSED' } });
        if (closed) throw new AppError('CIOT encerrado: confira a conclusão da viagem e regularize os documentos vinculados antes de criar outra operação.', 409);
        const authorized = await tx.manifestFiscalDocument.findFirst({ where: { manifestId: input.manifestId, documentType: 'CIOT', status: 'AUTHORIZED' } });
        if (authorized) throw new AppError('Já existe CIOT autorizado. Regularize a operação antes de reemitir.', 409);
        const existing = await tx.ciotEmissionJob.findFirst({ where: { manifestId: input.manifestId }, orderBy: { createdAt: 'desc' } });
        const environment = manifest.fiscalEmitter?.efreteEnvironment ?? 'HOMOLOGACAO';
        const matrizCnpj = resolveMatrizCnpj((manifest.fiscalEmitter?.person?.document ?? '').replace(/\D/g, ''), environment === 'PRODUCAO' ? 'producao' : 'homologacao');
        if (!/^\d{14}$/.test(matrizCnpj)) throw new AppError('Confira o CNPJ da empresa contratante/matriz da integração.', 422);
        const requestData = { ...input.requestData, matrizCnpj } as unknown as Prisma.InputJsonValue;
        if (existing && !['FAILED', 'DONE'].includes(existing.phase)) throw new AppError('CIOT em processamento ou aguardando conciliação. Consulte antes de reenviar.', 409);
        if (existing?.phase === 'DONE' && existing.tipoViagem === 'PADRAO') {
            const mdfe = await tx.manifestFiscalDocument.findFirst({ where: { manifestId: input.manifestId, documentType: 'MDFE', status: { in: ['SENT', 'READY', 'AUTHORIZED'] } } });
            if (mdfe) throw new AppError('Regularize o MDF-e vinculado ao CIOT Lotação cancelado antes de emitir uma nova operação.', 409);
        }
        if (input.override) await tx.manifest.update({ where: { id: input.manifestId }, data: { ciotTipoViagemOverride: input.override } });
        if (existing?.phase === 'FAILED') {
            await tx.ciotEmissionAttempt.create({ data: { jobId: existing.id, requestData: existing.requestData ?? {}, phase: 'SUPERSEDED', lastError: existing.lastError } });
            // Respostas de rejeição ficam nos documentos fiscais; mantém a chave idempotente.
            const originalMatrix = (existing.requestData as unknown as StoredCiotRequestData)?.matrizCnpj;
            if ((!originalMatrix || originalMatrix === matrizCnpj) && (!existing.environment || existing.environment === environment)) return tx.ciotEmissionJob.update({ where: { id: existing.id }, data: { tipoViagem: input.tipoViagem, requestData, environment, phase: 'QUEUED', attemptCount: 0, lastError: null } });
        }
        const suffix = await tx.ciotEmissionJob.count({ where: { manifestId: input.manifestId } }) + 1;
        return tx.ciotEmissionJob.create({ data: { manifestId: input.manifestId, idOperacaoCliente: `CIOT-${input.manifestId}-${suffix}`, tipoViagem: input.tipoViagem, requestData, environment } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new AppError('Outra ação alterou a viagem durante a emissão. Consulte o processamento antes de tentar novamente.', 409);
        throw error;
    });
}
