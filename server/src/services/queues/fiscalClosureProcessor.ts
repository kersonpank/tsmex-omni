import prisma from '../../lib/prisma.js';
import { closeFiscalDocumentsForCompletedManifest } from '../manifestFiscalClosureService.js';
import { DEFAULT_DUE_HOURS, dueIn, originHubIdOfManifest } from '../exceptions/alertOwner.js';

/**
 * Repetição automática do encerramento fiscal (CIOT/MDF-e) com espera crescente.
 * 6 tentativas no total (a 1ª + 5 repetições, esperas de 10, 20, 45, 90 e 180 min ≈ 5h45).
 * Esgotadas, a tarefa fica em RECONCILIATION_REQUIRED como sempre foi (alerta + botão
 * `POST /api/manifests/:id/fiscal-closure/retry`, que zera a contagem).
 * Resultado DESCONHECIDO (worker morreu no meio) continua sem repetição automática.
 */
export const FISCAL_CLOSURE_MAX_ATTEMPTS = 6;
export const FISCAL_CLOSURE_BACKOFF_MINUTES = [10, 20, 45, 90, 180] as const;

/** Espera antes da próxima tentativa, dado quantas já foram feitas; null = esgotou. */
export function fiscalClosureBackoffMs(attemptsMade: number): number | null {
    if (attemptsMade >= FISCAL_CLOSURE_MAX_ATTEMPTS) return null;
    const minutes = FISCAL_CLOSURE_BACKOFF_MINUTES[Math.max(attemptsMade, 1) - 1];
    return minutes == null ? null : minutes * 60_000;
}

export interface FiscalClosureDeps {
    db: typeof prisma;
    now: () => Date;
    close: typeof closeFiscalDocumentsForCompletedManifest;
}

/** A claim survives restarts. Unknown results are never repeated automatically. */
export async function processPendingFiscalClosures(overrides: Partial<FiscalClosureDeps> = {}): Promise<void> {
    const db = overrides.db ?? prisma;
    const now = overrides.now ?? (() => new Date());
    const close = overrides.close ?? closeFiscalDocumentsForCompletedManifest;

    const stale = await db.fiscalClosureTask.findMany({
        where: { status: 'PROCESSING', startedAt: { lt: new Date(now().getTime() - 5 * 60_000) } },
        select: { id: true, manifestId: true }, take: 20,
    });
    for (const task of stale) {
        const hubId = await originHubIdOfManifest(task.manifestId);
        await db.$transaction(async (tx) => {
            const changed = await tx.fiscalClosureTask.updateMany({
                where: { id: task.id, status: 'PROCESSING' },
                data: { status: 'RECONCILIATION_REQUIRED', reason: 'Worker interrompido durante o encerramento. Confira CIOT e MDF-e nos provedores antes de repetir.', finishedAt: now() },
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

    const tasks = await db.fiscalClosureTask.findMany({
        where: { status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now() } }] },
        orderBy: { createdAt: 'asc' }, take: 10,
    });
    for (const task of tasks) {
        const claim = await db.fiscalClosureTask.updateMany({
            where: { id: task.id, status: 'PENDING' },
            data: { status: 'PROCESSING', startedAt: now(), nextAttemptAt: null },
        });
        if (!claim.count) continue;
        const attemptsMade = task.attemptCount + 1;
        // Falha conhecida (exceção ou documento ainda aberto): repete sozinho com espera crescente até esgotar.
        const failed = async (reason: string) => {
            const wait = fiscalClosureBackoffMs(attemptsMade);
            await db.fiscalClosureTask.updateMany({
                where: { id: task.id, status: 'PROCESSING' },
                data: wait == null
                    ? { status: 'RECONCILIATION_REQUIRED', reason, attemptCount: attemptsMade, nextAttemptAt: null, finishedAt: now() }
                    : { status: 'PENDING', reason: `${reason} (nova tentativa automática ${attemptsMade + 1} de ${FISCAL_CLOSURE_MAX_ATTEMPTS} em ${Math.round(wait / 60_000)} min)`, attemptCount: attemptsMade, nextAttemptAt: new Date(now().getTime() + wait), finishedAt: null },
            });
        };
        try {
            const pending = await close(task.manifestId);
            if (pending.length) {
                await failed(`Documentos pendentes: ${pending.join(', ')}`);
            } else {
                await db.fiscalClosureTask.updateMany({
                    where: { id: task.id, status: 'PROCESSING' },
                    data: { status: 'DONE', reason: null, attemptCount: attemptsMade, nextAttemptAt: null, finishedAt: now() },
                });
            }
        } catch (error) {
            await failed(error instanceof Error ? error.message : String(error));
        }
    }
}
