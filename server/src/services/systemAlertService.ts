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
 * Como `createSystemAlert`, mas evita poluir o painel quando a mesma condição se repete:
 *
 * - Sem `dedupMatch` (uso original): se já existe um alerta `OPEN` da mesma categoria criado
 *   dentro da janela de dedup (padrão 15 min), só atualiza esse alerta (acumula contagem em
 *   `context.occurrences`) em vez de criar uma linha nova. Pensado pra incidente transitório de
 *   infra (Postgres/Redis fora do ar por alguns minutos derrubando muitos jobs de uma vez).
 * - Com `dedupMatch` (alertas por-entidade, ex.: por `fiscalEmitterId`): ignora a janela de tempo
 *   — a condição é de estado persistente, não um pico (ex.: cron de 12h checando se o NSU
 *   continua sem seed) — e mescla no primeiro `OPEN` da categoria cujo `context` bate no
 *   `dedupMatch`. Sem isso, dedup só por categoria juntaria erroneamente alertas de entidades
 *   diferentes (ex.: dois emitentes distintos, ambos sem NSU) na mesma linha.
 */
export async function createOrMergeSystemAlert(params: {
    category: SystemAlertCategory;
    severity: SystemAlertSeverity;
    title: string;
    message: string;
    context?: Record<string, unknown>;
    dedupWindowMs?: number;
    dedupMatch?: (context: Record<string, unknown>) => boolean;
}): Promise<void> {
    const existing = params.dedupMatch
        ? (
            await prisma.systemAlert.findMany({
                where: { category: params.category, status: 'OPEN' },
                orderBy: { createdAt: 'desc' },
            })
        ).find((alert) => params.dedupMatch!((alert.context as Record<string, unknown> | null) ?? {})) ?? null
        : await prisma.systemAlert.findFirst({
            where: {
                category: params.category,
                status: 'OPEN',
                createdAt: { gte: new Date(Date.now() - (params.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS)) },
            },
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

/**
 * Fecha em massa alertas `OPEN` de uma categoria cujo `context` bate no `match` — usado quando a
 * condição que motivou o alerta se corrige (ex.: NSU semeado, sync voltou a funcionar) e ninguém
 * precisa clicar em nada pra ele sumir do painel. Retorna quantos foram resolvidos.
 */
export async function resolveOpenSystemAlerts(params: {
    category: SystemAlertCategory;
    match: (context: Record<string, unknown>) => boolean;
}): Promise<number> {
    const candidates = await prisma.systemAlert.findMany({
        where: { category: params.category, status: 'OPEN' },
    });
    const toResolve = candidates.filter((alert) =>
        params.match((alert.context as Record<string, unknown> | null) ?? {}),
    );
    if (toResolve.length === 0) return 0;

    await prisma.systemAlert.updateMany({
        where: { id: { in: toResolve.map((alert) => alert.id) } },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return toResolve.length;
}
