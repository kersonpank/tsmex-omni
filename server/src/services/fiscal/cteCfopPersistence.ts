import type { Prisma } from '@prisma/client';
import { deriveCteCfop } from './cteCfopRule.js';
import type { CteEmissionInput } from '../cteService.js';

export async function persistDerivedCteCfop(tx: Prisma.TransactionClient, calc: { id: string; orderId: string; cfop: string | null }, input: CteEmissionInput, actorUserId?: string) {
    const cfop = input.calc.cfop;
    if (!cfop || cfop === calc.cfop) return;
    const { reason } = deriveCteCfop({ startUf: input.order.serviceStart!.state, endUf: input.order.serviceEnd!.state, emitterUf: input.person.state ?? '', baseCfop: cfop });
    await tx.orderFreightCalculation.update({ where: { id: calc.id }, data: { cfop } });
    await tx.orderHistory.create({ data: { orderId: calc.orderId, eventType: 'NOTE', actorUserId,
        description: `CFOP ajustado automaticamente de ${calc.cfop || 'não informado'} para ${cfop}: ${reason}` } });
}
