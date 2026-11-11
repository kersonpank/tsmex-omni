import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Conferência de chegada com efeito (NORTE #26/#35): o que o operador marca na descarga muda o
 * estado do pedido na MESMA transação que conclui a viagem/parada.
 * - OK: entra no estoque do hub de chegada (como sempre foi).
 * - DAMAGED: entra no estoque do hub de chegada, com avaria estruturada no histórico + alerta.
 * - MISSING: NÃO vira estoque do hub de chegada. O enum OrderStatus não tem "extraviado"; o estado
 *   mais honesto sem criar status é AT_HUB no hub de ORIGEM da perna (a carga reaparece na fila de
 *   quem a despachou, nunca some nem fica IN_TRANSIT numa viagem concluída), com nota e alerta.
 */

export const ARRIVAL_RESULTS = ['OK', 'DAMAGED', 'MISSING'] as const;
export type ArrivalResult = (typeof ARRIVAL_RESULTS)[number];

export const arrivalsSchema = z
    .array(
        z.object({
            orderId: z.string().uuid(),
            result: z.enum(ARRIVAL_RESULTS),
            note: z.string().trim().max(500).optional(),
        }),
    )
    .max(500)
    .refine((rows) => new Set(rows.map((r) => r.orderId)).size === rows.length, 'Pedido repetido na conferência de chegada.');

export type ArrivalMark = z.infer<typeof arrivalsSchema>[number];
export type ArrivalSummary = { stocked: number; damaged: number; missing: number };

/** Indexa as marcações e recusa pedidos que não pertencem à descarga sendo concluída. */
export function indexArrivals(arrivals: ArrivalMark[] | undefined, validOrderIds: string[]): Map<string, ArrivalMark> {
    const index = new Map<string, ArrivalMark>();
    const valid = new Set(validOrderIds);
    for (const mark of arrivals ?? []) {
        if (!valid.has(mark.orderId)) throw new AppError('Um dos pedidos marcados não pertence a esta descarga.', 400);
        index.set(mark.orderId, mark);
    }
    return index;
}

export function emptyArrivalSummary(): ArrivalSummary {
    return { stocked: 0, damaged: 0, missing: 0 };
}

/**
 * Recebe uma perna de transferência no hub de chegada conforme a marcação.
 * Retorna true quando o pedido entrou no estoque do hub de chegada (OK/DAMAGED).
 */
export async function receiveTransferLeg(
    tx: Prisma.TransactionClient,
    p: {
        leg: { orderId: string; originHubId?: string | null };
        mark?: ArrivalMark;
        manifest: { id: string; hubId: string | null; hubLabel: string };
        arrivalHub: { id: string; label: string };
        location: string | null;
        actorUserId: string | null;
        now: Date;
        summary: ArrivalSummary;
    },
): Promise<boolean> {
    const result: ArrivalResult = p.mark?.result ?? 'OK';
    const note = p.mark?.note?.trim();
    const shortId = p.manifest.id.slice(0, 8);
    const orderId = p.leg.orderId;

    if (result === 'MISSING') {
        const originHubId = p.leg.originHubId ?? p.manifest.hubId;
        if (!originHubId) throw new AppError('Viagem sem hub de origem: não há estoque para onde devolver a carga que não chegou.', 422);
        await tx.order.update({ where: { id: orderId }, data: { status: 'AT_HUB', currentHubId: originHubId, enteredAtHubAt: p.now } });
        await tx.orderHistory.create({
            data: {
                orderId, eventType: 'NOTE', location: p.location, actorUserId: p.actorUserId,
                description: `Não chegou em ${p.arrivalHub.label} na viagem ${shortId}: verificar com ${p.manifest.hubLabel}.${note ? ` ${note}` : ''}`,
            },
        });
        p.summary.missing += 1;
    } else {
        await tx.order.update({ where: { id: orderId }, data: { status: 'AT_HUB', currentHubId: p.arrivalHub.id, enteredAtHubAt: p.now } });
        await tx.orderHistory.create({
            data: {
                orderId, eventType: 'AT_HUB', location: p.location, actorUserId: p.actorUserId,
                description: `Recebido no hub destino (${p.arrivalHub.label})`,
            },
        });
        p.summary.stocked += 1;
        if (result === 'DAMAGED') {
            await tx.orderHistory.create({
                data: {
                    orderId, eventType: 'NOTE', location: p.location, actorUserId: p.actorUserId,
                    description: `[AVARIA NA CHEGADA] chegou com avaria em ${p.arrivalHub.label} (viagem ${shortId})${note ? ` — ${note}` : ''}`,
                },
            });
            p.summary.damaged += 1;
        }
    }

    if (result !== 'OK') {
        await tx.systemAlert.create({
            data: {
                category: 'OPERATIONAL_ARRIVAL_DIVERGENCE',
                severity: result === 'MISSING' ? 'CRITICAL' : 'WARNING',
                title: `${result === 'MISSING' ? 'Carga não chegou' : 'Carga com avaria'} em ${p.arrivalHub.label} — viagem ${shortId}`,
                message: result === 'MISSING'
                    ? `O pedido não chegou em ${p.arrivalHub.label}; voltou ao estoque de ${p.manifest.hubLabel} para apuração.${note ? ` ${note}` : ''}`
                    : `O pedido chegou com avaria em ${p.arrivalHub.label}.${note ? ` ${note}` : ''}`,
                context: { manifestId: p.manifest.id, orderId, result, hubId: p.arrivalHub.id },
            },
        });
    }
    return result !== 'MISSING';
}
