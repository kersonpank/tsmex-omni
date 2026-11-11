import type { Prisma, SystemAlertCategory } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

/** Fila de exceções do hub: SystemAlert com dono (hubId), prazo e desfecho. */

export const MIN_RESOLUTION_NOTE = 10;
const LIST_LIMIT = 300;

export interface HubExceptionItem {
    id: string;
    category: SystemAlertCategory;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    status: 'OPEN' | 'ACKNOWLEDGED';
    title: string;
    message: string;
    hubId: string | null;
    createdAt: string;
    dueAt: string | null;
    overdue: boolean;
    orderId: string | null;
    manifestId: string | null;
}

export interface HubExceptionList {
    counts: { total: number; overdue: number; CRITICAL: number; WARNING: number; INFO: number };
    items: HubExceptionItem[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export async function listHubExceptions(
    scope: { hubId?: string | null },
    now: Date = new Date(),
    db: typeof prisma = prisma,
): Promise<HubExceptionList> {
    const rows = await db.systemAlert.findMany({
        where: { status: { not: 'RESOLVED' }, ...(scope.hubId ? { hubId: scope.hubId } : {}) },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: LIST_LIMIT,
    });
    const items: HubExceptionItem[] = rows.map((r) => {
        const ctx = (r.context as Record<string, unknown> | null) ?? {};
        return {
            id: r.id,
            category: r.category,
            severity: r.severity,
            status: r.status as 'OPEN' | 'ACKNOWLEDGED',
            title: r.title,
            message: r.message,
            hubId: r.hubId,
            createdAt: r.createdAt.toISOString(),
            dueAt: r.dueAt ? r.dueAt.toISOString() : null,
            overdue: r.dueAt ? r.dueAt.getTime() < now.getTime() : false,
            orderId: str(ctx.orderId),
            manifestId: str(ctx.manifestId),
        };
    });
    // Vencidas primeiro (mais antigas no topo), depois por prazo; sem prazo por último.
    items.sort((a, b) => Number(b.overdue) - Number(a.overdue)
        || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')
        || a.createdAt.localeCompare(b.createdAt));
    return {
        counts: {
            total: items.length,
            overdue: items.filter((i) => i.overdue).length,
            CRITICAL: items.filter((i) => i.severity === 'CRITICAL').length,
            WARNING: items.filter((i) => i.severity === 'WARNING').length,
            INFO: items.filter((i) => i.severity === 'INFO').length,
        },
        items,
    };
}

/** Anti-IDOR: alerta fora do escopo do hub é indistinguível de inexistente (404). */
async function findInScope(db: typeof prisma, id: string, scope: { hubId?: string | null }) {
    const alert = await db.systemAlert.findFirst({ where: { id, ...(scope.hubId ? { hubId: scope.hubId } : {}) } });
    if (!alert) throw new AppError('Exceção não encontrada', 404);
    return alert;
}

export async function acknowledgeHubException(
    params: { id: string; userId: string; scope: { hubId?: string | null } },
    db: typeof prisma = prisma,
) {
    const alert = await findInScope(db, params.id, params.scope);
    if (alert.status === 'RESOLVED') throw new AppError('Esta exceção já foi resolvida.', 409);
    if (alert.status === 'ACKNOWLEDGED') return alert;
    return db.systemAlert.update({
        where: { id: alert.id },
        data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedByUserId: params.userId },
    });
}

export async function resolveHubException(
    params: { id: string; userId: string; note: string; scope: { hubId?: string | null } },
    db: typeof prisma = prisma,
) {
    const note = params.note.trim();
    if (note.length < MIN_RESOLUTION_NOTE) {
        throw new AppError(`Explique o que foi feito (mínimo ${MIN_RESOLUTION_NOTE} caracteres).`, 400);
    }
    const alert = await findInScope(db, params.id, params.scope);
    if (alert.status === 'RESOLVED') throw new AppError('Esta exceção já foi resolvida.', 409);
    const orderId = str((alert.context as Record<string, unknown> | null)?.orderId);

    return db.$transaction(async (tx: Prisma.TransactionClient) => {
        const changed = await tx.systemAlert.updateMany({
            where: { id: alert.id, status: { not: 'RESOLVED' } },
            data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByUserId: params.userId, resolutionNote: note },
        });
        if (changed.count === 0) throw new AppError('Esta exceção já foi resolvida.', 409);
        // Evento com porquê: o desfecho fica também na linha do tempo do pedido.
        if (orderId) {
            await tx.orderHistory.create({
                data: {
                    orderId, eventType: 'NOTE', actorUserId: params.userId,
                    description: `[EXCEÇÃO RESOLVIDA] ${alert.title} — ${note}`,
                },
            });
        }
        return tx.systemAlert.findUniqueOrThrow({ where: { id: alert.id } });
    });
}
