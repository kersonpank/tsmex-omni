import type { SystemAlertCategory, SystemAlertSeverity } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { HUB_CARGO_ACTIVE_MANIFEST_STATUSES } from '../hubCargo/hubCargoPolicy.js';
import { buildCoverageIndex, resolveNextHop } from '../hubCargo/consolidationQueue.js';
import { dueIn } from './alertOwner.js';

/**
 * Exceções geradas por regra (varredura leve no worker, a cada 10 min). Idempotente: a chave do
 * objeto (pedido/viagem) é guardada em `context.subjectKey`; alerta aberto da mesma chave não é
 * duplicado e, quando a condição some, o próprio job resolve o alerta (ator = sistema).
 */

export const SYSTEM_RESOLUTION_NOTE = 'resolvido pelo sistema: condição não existe mais';
export const RULE_CATEGORIES: SystemAlertCategory[] = ['OPERATIONAL_STOCK_AGING', 'OPERATIONAL_TRIP_LATE', 'OPERATIONAL_UNROUTED'];
const BATCH_LIMIT = 500;

export interface ExceptionThresholds {
    stockAgingDays: number;
    tripLateHours: number;
    unroutedHours: number;
}

function envNumber(name: string, fallback: number): number {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function exceptionThresholdsFromEnv(): ExceptionThresholds {
    return {
        stockAgingDays: envNumber('EXCEPTION_STOCK_AGING_DAYS', 5),
        tripLateHours: envNumber('EXCEPTION_TRIP_LATE_HOURS', 12),
        unroutedHours: envNumber('EXCEPTION_UNROUTED_HOURS', 24),
    };
}

export interface Candidate {
    category: SystemAlertCategory;
    key: string;
    hubId: string | null;
    severity: SystemAlertSeverity;
    title: string;
    message: string;
    context: Record<string, unknown>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const shortId = (id: string) => id.slice(0, 8);
const orderLabel = (number: number | null | undefined, id: string) => (number != null ? `#${number}` : shortId(id));
const ago = (ms: number) => (ms >= 2 * DAY ? `${Math.floor(ms / DAY)} dias` : `${Math.max(1, Math.floor(ms / HOUR))} h`);

/** Pedidos em estoque (AT_HUB, fora de viagem ativa) — base das regras (a) e (c). */
function stockedOrders(db: typeof prisma, olderThan: Date) {
    return db.order.findMany({
        where: {
            status: 'AT_HUB',
            currentHubId: { not: null },
            enteredAtHubAt: { lt: olderThan },
            legs: { none: { manifest: { status: { in: HUB_CARGO_ACTIVE_MANIFEST_STATUSES } } } },
        },
        select: { id: true, currentHubId: true, enteredAtHubAt: true, fimIbgeCode: true, demand: { select: { orderNumber: true } } },
        orderBy: { enteredAtHubAt: 'asc' },
        take: BATCH_LIMIT,
    });
}

export async function collectCandidates(
    db: typeof prisma,
    now: Date,
    t: ExceptionThresholds,
): Promise<{ candidates: Candidate[]; truncated: Set<SystemAlertCategory> }> {
    const candidates: Candidate[] = [];
    const truncated = new Set<SystemAlertCategory>();
    const hubs = await db.hub.findMany({ select: { id: true, name: true, code: true, cityIbgeCode: true, active: true, gatewayHubId: true } });
    const hubName = (id: string | null) => hubs.find((h) => h.id === id)?.name ?? 'o hub';

    // (a) estoque parado — mesmo hub além do limiar.
    const aging = await stockedOrders(db, new Date(now.getTime() - t.stockAgingDays * DAY));
    if (aging.length >= BATCH_LIMIT) truncated.add('OPERATIONAL_STOCK_AGING');
    for (const o of aging) {
        const label = orderLabel(o.demand?.orderNumber, o.id);
        candidates.push({
            category: 'OPERATIONAL_STOCK_AGING', key: o.id, hubId: o.currentHubId, severity: 'WARNING',
            title: `Pedido ${label} parado no estoque de ${hubName(o.currentHubId)}`,
            message: `O pedido ${label} está há ${ago(now.getTime() - o.enteredAtHubAt!.getTime())} em estoque sem sair em viagem. Monte uma viagem ou registre por que está retido.`,
            context: { subjectKey: o.id, orderId: o.id, hubId: o.currentHubId },
        });
    }

    // (c) sem rota — destino sem IBGE ou sem hub que cubra a cidade.
    const unroutedBase = await stockedOrders(db, new Date(now.getTime() - t.unroutedHours * HOUR));
    if (unroutedBase.length >= BATCH_LIMIT) truncated.add('OPERATIONAL_UNROUTED');
    if (unroutedBase.length > 0) {
        const coverage = await db.hubCoverage.findMany({
            where: { active: true },
            select: { hubId: true, cityIbgeCode: true, priority: true, leadTimeDays: true },
        });
        const index = buildCoverageIndex(hubs, coverage);
        for (const o of unroutedBase) {
            if (resolveNextHop(index, o.fimIbgeCode, o.currentHubId!).kind !== 'UNROUTED') continue;
            const label = orderLabel(o.demand?.orderNumber, o.id);
            candidates.push({
                category: 'OPERATIONAL_UNROUTED', key: o.id, hubId: o.currentHubId, severity: 'WARNING',
                title: `Pedido ${label} sem rota de entrega`,
                message: `O pedido ${label} não tem destino reconhecido ou nenhum hub cobre a cidade de entrega (há ${ago(now.getTime() - o.enteredAtHubAt!.getTime())}). Corrija o destino ou cadastre a cobertura.`,
                context: { subjectKey: o.id, orderId: o.id, hubId: o.currentHubId },
            });
        }
    }

    // (b) viagem em curso com previsão de chegada vencida.
    const late = await db.manifest.findMany({
        where: { status: 'IN_PROGRESS', plannedArrivalAt: { lt: new Date(now.getTime() - t.tripLateHours * HOUR) } },
        select: { id: true, hubId: true, destHubId: true, origin: true, destination: true, plannedArrivalAt: true },
        orderBy: { plannedArrivalAt: 'asc' },
        take: BATCH_LIMIT,
    });
    if (late.length >= BATCH_LIMIT) truncated.add('OPERATIONAL_TRIP_LATE');
    for (const m of late) {
        candidates.push({
            category: 'OPERATIONAL_TRIP_LATE', key: m.id, hubId: m.destHubId ?? m.hubId, severity: 'CRITICAL',
            title: `Viagem ${shortId(m.id)} atrasada: ${m.origin} → ${m.destination}`,
            message: `A chegada prevista era há ${ago(now.getTime() - m.plannedArrivalAt!.getTime())} e a viagem ainda não concluiu. Fale com o transportador e confirme a posição da carga.`,
            context: { subjectKey: m.id, manifestId: m.id },
        });
    }
    return { candidates, truncated };
}

export async function runExceptionRules(
    options: { db?: typeof prisma; now?: Date; thresholds?: ExceptionThresholds } = {},
): Promise<{ created: number; resolved: number }> {
    const db = options.db ?? prisma;
    const now = options.now ?? new Date();
    const { candidates, truncated } = await collectCandidates(db, now, options.thresholds ?? exceptionThresholdsFromEnv());

    const open = await db.systemAlert.findMany({
        where: { category: { in: RULE_CATEGORIES }, status: { not: 'RESOLVED' } },
        select: { id: true, category: true, context: true },
    });
    const keyOf = (category: string, context: unknown) =>
        `${category}:${(context as { subjectKey?: string } | null)?.subjectKey ?? ''}`;
    const openKeys = new Set(open.map((a) => keyOf(a.category, a.context)));
    const wanted = new Set(candidates.map((c) => keyOf(c.category, c.context)));

    let created = 0;
    for (const c of candidates) {
        if (openKeys.has(keyOf(c.category, c.context))) continue;
        await db.systemAlert.create({
            data: {
                category: c.category, severity: c.severity, title: c.title, message: c.message,
                context: c.context as never, hubId: c.hubId, dueAt: dueIn(24, now),
            },
        });
        created += 1;
    }

    // Lote cheio = a lista de candidatos pode estar incompleta: nesse caso não se resolve nada da categoria.
    const stale = open.filter((a) => !wanted.has(keyOf(a.category, a.context)) && !truncated.has(a.category));
    if (stale.length > 0) {
        await db.systemAlert.updateMany({
            where: { id: { in: stale.map((a) => a.id) }, status: { not: 'RESOLVED' } },
            data: { status: 'RESOLVED', resolvedAt: now, resolvedByUserId: null, resolutionNote: SYSTEM_RESOLUTION_NOTE },
        });
    }
    return { created, resolved: stale.length };
}
