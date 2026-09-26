import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export type DeliveryAttemptInput = {
    orderId: string;
    result: 'DELIVERED' | 'PARTIAL' | 'FAILED';
    deliveredQuantity?: number;
    receiverName?: string;
    occurredAt?: string;
    evidenceStorageKey?: string;
    exceptionReason?: string;
    nextAction?: 'REATTEMPT' | 'RETURN_TO_HUB' | 'TRANSFER';
    performedByUserId?: string;
    idempotencyKey: string;
};

export async function listManifestDeliveryProgress(manifestId: string) {
    const legs = await prisma.orderLeg.findMany({
        where: { manifestId, legType: 'ENTREGA' },
        include: {
            order: { select: { nfNumber: true, demand: { select: { orderNumber: true, units: true } } } },
            deliveryAttempts: { orderBy: { createdAt: 'asc' } },
            stop: { select: { id: true, destinationLabel: true } },
        },
        orderBy: { sequence: 'asc' },
    });
    return legs.map((leg) => {
        const delivered = leg.deliveryAttempts.reduce((sum, attempt) => sum + (attempt.deliveredQuantity ?? 0), 0);
        return {
            legId: leg.id, orderId: leg.orderId, stopId: leg.stopId,
            destinationLabel: leg.stop?.destinationLabel,
            orderNumber: leg.order.demand.orderNumber, nfNumber: leg.order.nfNumber,
            expectedQuantity: leg.order.demand.units,
            deliveredQuantity: delivered,
            remainingQuantity: Math.max(0, leg.order.demand.units - delivered),
            complete: leg.deliveryAttempts.at(-1)?.result === 'DELIVERED',
            attempts: leg.deliveryAttempts,
        };
    });
}

export async function recordDeliveryAttempt(manifestId: string, actorUserId: string, input: DeliveryAttemptInput) {
    return prisma.$transaction(async (tx) => {
        const previous = await tx.deliveryAttempt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (previous) {
            if (previous.manifestId !== manifestId || previous.orderId !== input.orderId) throw new AppError('Identificador de tentativa já utilizado.', 409);
            return previous;
        }
        const leg = await tx.orderLeg.findUnique({
            where: { orderId_manifestId: { orderId: input.orderId, manifestId } },
            include: { manifest: { select: { status: true, link: { select: { userId: true } } } }, order: { select: { demand: { select: { units: true } } } } },
        });
        if (!leg || leg.legType !== 'ENTREGA') throw new AppError('Pedido não vinculado a uma entrega desta viagem.', 404);
        if (leg.manifest.status !== 'IN_PROGRESS' || leg.completedAt) throw new AppError('Trecho não está aberto para registro de entrega.', 409);
        if (input.performedByUserId && input.performedByUserId !== actorUserId && input.performedByUserId !== leg.manifest.link?.userId) {
            throw new AppError('Quem executou a entrega deve ser o usuário que registra ou o motorista atribuído à viagem.', 400);
        }
        await tx.$queryRaw`SELECT id FROM "OrderLeg" WHERE id = ${leg.id} FOR UPDATE`;
        const attempts = await tx.deliveryAttempt.findMany({ where: { legId: leg.id }, orderBy: { createdAt: 'asc' } });
        if (attempts.at(-1)?.result === 'DELIVERED') throw new AppError('Entrega já confirmada para este trecho.', 409);
        const expected = leg.order.demand.units;
        const alreadyDelivered = attempts.reduce((sum, attempt) => sum + (attempt.deliveredQuantity ?? 0), 0);
        const remaining = expected - alreadyDelivered;
        if (remaining < 1) throw new AppError('Não há saldo para nova tentativa.', 409);
        let quantity = input.deliveredQuantity ?? 0;
        if (input.result === 'DELIVERED') {
            quantity = input.deliveredQuantity ?? remaining;
            if (quantity !== remaining) throw new AppError('Entrega final deve quitar o saldo de volumes.', 400);
            if (!input.receiverName?.trim()) throw new AppError('Informe quem recebeu a carga.', 400);
        } else {
            if (!input.nextAction) throw new AppError('Defina a próxima ação para a carga não entregue.', 400);
            if (input.result === 'FAILED' && quantity !== 0) throw new AppError('Tentativa sem entrega deve ter quantidade zero.', 400);
            if (input.result === 'PARTIAL' && (quantity < 1 || quantity >= remaining)) throw new AppError('Quantidade parcial deve ser maior que zero e menor que o saldo.', 400);
        }
        if (quantity > 0 && !input.evidenceStorageKey && (input.exceptionReason?.trim().length ?? 0) < 10) {
            throw new AppError('Anexe comprovante ou justifique a exceção com pelo menos 10 caracteres.', 400);
        }
        if (input.result === 'FAILED' && (input.exceptionReason?.trim().length ?? 0) < 10) throw new AppError('Descreva o motivo da tentativa sem entrega.', 400);
        const attempt = await tx.deliveryAttempt.create({ data: {
            manifestId, orderId: input.orderId, legId: leg.id, stopId: leg.stopId,
            result: input.result, expectedQuantity: expected, deliveredQuantity: quantity,
            receiverName: input.receiverName?.trim() || null,
            occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
            recordedByUserId: actorUserId, performedByUserId: input.performedByUserId ?? null,
            evidenceStorageKey: input.evidenceStorageKey || null,
            exceptionReason: input.exceptionReason?.trim() || null, nextAction: input.nextAction ?? null,
            idempotencyKey: input.idempotencyKey,
        } });
        await tx.orderHistory.create({ data: {
            orderId: input.orderId, eventType: 'NOTE',
            description: input.result === 'DELIVERED'
                ? `Entrega comprovada: ${quantity} volume(s), recebido por ${input.receiverName?.trim()}.`
                : input.result === 'PARTIAL'
                    ? `Entrega parcial: ${quantity} volume(s), saldo ${remaining - quantity}. Próxima ação: ${input.nextAction}.`
                    : `Tentativa de entrega sem sucesso. Próxima ação: ${input.nextAction}.`,
        } });
        return attempt;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function assertDeliveryConfirmed(legIds: string[]) {
    if (!legIds.length) return;
    const attempts = await prisma.deliveryAttempt.findMany({ where: { legId: { in: legIds } }, orderBy: { createdAt: 'desc' }, select: { legId: true, result: true } });
    const last = new Map<string, string>();
    for (const attempt of attempts) if (!last.has(attempt.legId)) last.set(attempt.legId, attempt.result);
    const missing = legIds.filter((id) => last.get(id) !== 'DELIVERED');
    if (missing.length) throw new AppError(`Comprove a entrega de cada pedido antes de concluir a descarga (${missing.length} pendente(s)).`, 422);
}
