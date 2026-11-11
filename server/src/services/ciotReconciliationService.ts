import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { consultarStatusCiot } from './efrete/efreteCiotEmit.js';
import { enqueueCiotEmissionJob } from './queues/ciotEmissionQueue.js';
import { persistCiotProviderState } from './ciotProviderState.js';
import type { StoredCiotRequestData } from './queues/ciotEmissionJobInput.js';

/** Consulta somente: não altera dados da operação nem envia uma nova emissão. */
export async function reconcileCiot(manifestId: string, deps = { db: prisma, consult: consultarStatusCiot, enqueue: enqueueCiotEmissionJob }) {
    const job = await deps.db.ciotEmissionJob.findFirst({ where: { manifestId }, orderBy: { createdAt: 'desc' } });
    if (!job || !['PENDING_RECONCILIATION', 'DOWNLOADING_FILES'].includes(job.phase)) throw new AppError('Não há tentativa de CIOT pendente de consulta.', 409);
    if (!job.environment) throw new AppError('Ambiente da tentativa não registrado. Verifique a operação antes de consultar.', 409);
    const matrizCnpj = (job.requestData as unknown as StoredCiotRequestData).matrizCnpj;
    if (!matrizCnpj) throw new AppError('Tentativa antiga sem CNPJ da matriz registrado. Confira o emitente original antes de reconciliar; não reenvie a operação.', 409);
    const result = await deps.consult(job.idOperacaoCliente, job.environment === 'PRODUCAO' ? 'producao' : 'homologacao', matrizCnpj);
    if (result.exists && (!result.codigoIdentificacaoOperacao || !result.estado)) throw new AppError('Consulta inconclusiva. Consulte novamente; não reenvie o CIOT.', 409);
    const terminal = result.exists && result.estado !== 'EmViagem';
    // Não regressa um CIOT conhecido cuja consulta ficou sem código.
    if (!result.exists && job.codigoIdentificacaoOperacao) throw new AppError('A operação já tem código de CIOT. A consulta não confirmou sua situação; mantenha a conciliação pendente.', 409);
    await deps.db.$transaction(async tx => {
        const updated = await tx.ciotEmissionJob.updateMany({
            where: { id: job.id, phase: job.phase, updatedAt: job.updatedAt },
            data: result.exists
                ? { phase: terminal ? 'DONE' : 'DOWNLOADING_FILES', codigoIdentificacaoOperacao: result.codigoIdentificacaoOperacao, lastError: terminal ? `CIOT ${result.estado}. Regularize os documentos vinculados antes de continuar.` : null }
                : { phase: 'FAILED', lastError: `Consulta confirmou ausência de CIOT. Corrija os dados e tente novamente. ${job.lastError ?? ''}` },
        });
        if (updated.count !== 1) throw new AppError('A tentativa mudou de estado durante a consulta.', 409);
        if (result.exists) await persistCiotProviderState(job, result, tx);
    }, { isolationLevel: 'Serializable' });
    if (result.exists && !terminal) await deps.enqueue({ ciotEmissionJobId: job.id });
    return { exists: result.exists, estado: result.estado, message: terminal ? `CIOT ${result.estado}. Histórico atualizado; regularize os documentos vinculados.` : result.exists ? 'CIOT encontrado. Recuperando documento sem reemitir.' : 'Nenhum CIOT encontrado. Correção e nova tentativa disponíveis.' };
}
