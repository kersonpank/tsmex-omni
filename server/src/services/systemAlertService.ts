import prisma from '../lib/prisma.js';
import type { Prisma, SystemAlertCategory, SystemAlertSeverity } from '@prisma/client';

export async function createSystemAlert(params: {
    category: SystemAlertCategory;
    severity: SystemAlertSeverity;
    title: string;
    message: string;
    context?: Record<string, unknown>;
}): Promise<void> {
    await prisma.systemAlert.create({
        data: {
            category: params.category,
            severity: params.severity,
            title: params.title,
            message: params.message,
            context: params.context as Prisma.InputJsonValue | undefined,
        },
    });
}

const DEFAULT_DEDUP_WINDOW_MS = 15 * 60 * 1000;

/**
 * Como `createSystemAlert`, mas evita poluir o painel quando um único incidente de infra
 * (Postgres/Redis fora do ar por alguns minutos) derruba muitos jobs ao mesmo tempo: se já
 * existe um alerta `OPEN` da mesma categoria criado dentro da janela de dedup, só atualiza
 * esse alerta (acumula contagem em `context.occurrences`) em vez de criar uma linha nova por
 * ocorrência.
 */
export async function createOrMergeSystemAlert(params: {
    category: SystemAlertCategory;
    severity: SystemAlertSeverity;
    title: string;
    message: string;
    context?: Record<string, unknown>;
    dedupWindowMs?: number;
}): Promise<void> {
    const since = new Date(Date.now() - (params.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS));
    const existing = await prisma.systemAlert.findFirst({
        where: { category: params.category, status: 'OPEN', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
    });

    if (!existing) {
        await createSystemAlert(params);
        return;
    }

    const prevContext = (existing.context as Record<string, unknown> | null) ?? {};
    const prevOccurrences = typeof prevContext.occurrences === 'number' ? prevContext.occurrences : 1;
    await prisma.systemAlert.update({
        where: { id: existing.id },
        data: {
            message: `${params.message} (ocorrências agrupadas neste incidente: ${prevOccurrences + 1})`,
            context: {
                ...prevContext,
                ...params.context,
                occurrences: prevOccurrences + 1,
                lastOccurrenceAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
        },
    });
}
