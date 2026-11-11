import prisma from '../../lib/prisma.js';
import { closeFiscalDocumentsForCompletedManifest } from '../manifestFiscalClosureService.js';
import { DEFAULT_DUE_HOURS, dueIn, originHubIdOfManifest } from '../exceptions/alertOwner.js';

/** A claim survives restarts. Unknown results are never repeated automatically. */
export async function processPendingFiscalClosures(): Promise<void> {
    const stale = await prisma.fiscalClosureTask.findMany({
        where: { status: 'PROCESSING', startedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
        select: { id: true, manifestId: true }, take: 20,
    });
    for (const task of stale) {
        const hubId = await originHubIdOfManifest(task.manifestId);
        await prisma.$transaction(async (tx) => {
            const changed = await tx.fiscalClosureTask.updateMany({
                where: { id: task.id, status: 'PROCESSING' },
                data: { status: 'RECONCILIATION_REQUIRED', reason: 'Worker interrompido durante o encerramento. Confira CIOT e MDF-e nos provedores antes de repetir.', finishedAt: new Date() },
            });
            if (changed.count) await tx.systemAlert.create({ data: {
                category: 'FISCAL_ENCERRAMENTO_PENDENTE', severity: 'WARNING',
                hubId, dueAt: dueIn(DEFAULT_DUE_HOURS.FISCAL_CLOSURE),
                title: `Conciliação fiscal pendente — viagem ${task.manifestId.slice(0, 8)}`,
                message: 'O worker parou durante o encerramento. Confira o estado do CIOT e do MDF-e nos provedores antes de qualquer nova tentativa.',
                context: { manifestId: task.manifestId, fiscalClosureTaskId: task.id },
            } });
        });
    }

    const tasks = await prisma.fiscalClosureTask.findMany({
        where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 10,
    });
    for (const task of tasks) {
        const claim = await prisma.fiscalClosureTask.updateMany({
            where: { id: task.id, status: 'PENDING' },
            data: { status: 'PROCESSING', startedAt: new Date() },
        });
        if (!claim.count) continue;
        try {
            const pending = await closeFiscalDocumentsForCompletedManifest(task.manifestId);
            await prisma.fiscalClosureTask.updateMany({
                where: { id: task.id, status: 'PROCESSING' },
                data: pending.length
                    ? { status: 'RECONCILIATION_REQUIRED', reason: `Documentos pendentes: ${pending.join(', ')}`, finishedAt: new Date() }
                    : { status: 'DONE', reason: null, finishedAt: new Date() },
            });
        } catch (error) {
            await prisma.fiscalClosureTask.updateMany({
                where: { id: task.id, status: 'PROCESSING' },
                data: { status: 'RECONCILIATION_REQUIRED', reason: error instanceof Error ? error.message : String(error), finishedAt: new Date() },
            });
        }
    }
}
