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
 * Evita fadiga de painel: se um incidente amplo derruba N jobs ao mesmo tempo, não cria N
 * alertas — funde no mesmo alerta OPEN da categoria dentro da janela de dedup.
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

    const previousContext = (existing.context as Record<string, unknown> | null) ?? {};
    const occurrences = (typeof previousContext.occurrences === 'number' ? previousContext.occurrences : 1) + 1;

    await prisma.systemAlert.update({
        where: { id: existing.id },
        data: {
            message: params.message,
            context: {
                ...previousContext,
                ...params.context,
                occurrences,
                lastOccurrenceAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
        },
    });
}
