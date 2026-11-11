import type { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import type { LegDeliveryOutcome } from './deliveryAttempts.js';

type SettleLeg = { id: string; orderId: string };

/**
 * Aplica o desfecho de cada perna de entrega ao pedido, dentro da transação de conclusão.
 * - Entregue: pedido DELIVERED (fim da jornada).
 * - Não entregue (FAILED, ou saldo de PARTIAL): o pedido volta ao estoque do hub de origem da viagem
 *   (AT_HUB) com nota explicando; assim reaparece sozinho na fila de consolidação desse hub.
 *   Não existe "pedido filho" para entrega parcial: o pedido volta inteiro e o histórico registra
 *   quantos volumes foram entregues e quantos voltaram.
 * Retorna quantas entregas foram efetivas (só elas contam para o transportador).
 */
export async function settleDeliveryLegs(
    tx: Prisma.TransactionClient,
    params: {
        legs: SettleLeg[];
        outcomes: Map<string, LegDeliveryOutcome>;
        hubId: string | null;
        hubLabel: string;
        location: string | null;
        deliveredDescription: string;
        actorUserId: string | null;
        now: Date;
    },
): Promise<{ deliveredCount: number }> {
    let deliveredCount = 0;
    for (const leg of params.legs) {
        const outcome = params.outcomes.get(leg.id);
        if (!outcome) throw new AppError('Desfecho da entrega não encontrado para um dos pedidos.', 422);
        if (outcome.kind === 'DELIVERED') {
            deliveredCount += 1;
            await tx.order.update({ where: { id: leg.orderId }, data: { status: 'DELIVERED', currentHubId: null } });
            await tx.orderHistory.create({
                data: {
                    orderId: leg.orderId, eventType: 'DELIVERED', description: params.deliveredDescription,
                    location: params.location, actorUserId: params.actorUserId,
                },
            });
            continue;
        }
        if (!params.hubId) throw new AppError('Viagem sem hub de origem: não há estoque para onde devolver a carga não entregue.', 422);
        await tx.order.update({
            where: { id: leg.orderId },
            data: { status: 'AT_HUB', currentHubId: params.hubId, enteredAtHubAt: params.now },
        });
        const split = outcome.delivered > 0
            ? ` ${outcome.delivered} volume(s) entregue(s) e ${outcome.returned} volume(s) voltaram; o pedido volta inteiro ao estoque com esta nota.`
            : '';
        const followUp = outcome.nextAction === 'TRANSFER'
            ? ' Precisa ser encaminhado a outro hub.'
            : '';
        await tx.orderHistory.create({
            data: {
                orderId: leg.orderId, eventType: 'AT_HUB',
                description: `Entrega não realizada: ${outcome.reason}. Carga de volta ao estoque de ${params.hubLabel} para nova tentativa.${split}${followUp}`,
                location: params.location, actorUserId: params.actorUserId,
            },
        });
    }
    return { deliveredCount };
}
