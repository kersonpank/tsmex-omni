import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { resolveCteCfopCstForEmission } from '../services/fiscal/cteEmitterDefaults.js';
import { resolveCteServiceLocation } from '../services/fiscal/cteServiceLocation.js';
import { deriveCteCfop } from '../services/fiscal/cteCfopRule.js';

export const orderServiceStartRouter = Router({ mergeParams: true });
const lockedStatuses = ['CTE_AUTHORIZED', 'CTE_READY', 'CTE_SENT', 'CTE_PROCESSING', 'CTE_PENDING_RECONCILIATION'];
export function serviceStartBlocked(calcs: { documentType: string; status: string }[]) {
    return calcs.some((c) => c.documentType === 'CTE' && lockedStatuses.includes(c.status));
}
const schema = z.object({ mode: z.enum(['HUB', 'REMETENTE']) }).strict();
orderServiceStartRouter.use(authenticate, authorize('ADMIN', 'HUB'));
orderServiceStartRouter.get('/', async (req: AuthRequest, res, next) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id as string }, include: { freightCalculations: true } });
        if (!order) throw new AppError('Pedido não encontrado.', 404);
        if (!req.user!.roles.includes('ADMIN') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) throw new AppError('Pedido fora do hub atual.', 403);
        res.json({ success: true, data: { city: order.origemPrestacao, mode: order.intakeMode === 'HUB_DIRECT' ? 'HUB' : 'REMETENTE', allowed: !serviceStartBlocked(order.freightCalculations) } });
    } catch (error) { next(error); }
});
orderServiceStartRouter.patch('/', async (req: AuthRequest, res, next) => {
    try {
        const { mode } = schema.parse(req.body);
        const orderId = req.params.id as string;
        const result = await prisma.$transaction(async (tx) => {
            // O emissor reserva o cálculo por updateMany; esperar o lock antes de conferir o estado.
            await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM "OrderFreightCalculation" WHERE "orderId" = ${orderId} FOR UPDATE`;
            const order = await tx.order.findUnique({ where: { id: orderId }, include: { remetentePerson: true, destinatarioPerson: true, freightCalculations: { include: { fiscalEmitter: { include: { person: true } } } } } });
            if (!order) throw new AppError('Pedido não encontrado.', 404);
            if (!req.user!.roles.includes('ADMIN') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) throw new AppError('Pedido fora do hub atual.', 403);
            if (serviceStartBlocked(order.freightCalculations)) throw new AppError('O início não pode mudar com CT-e autorizado ou em envio/conferência.', 409);
            const source = mode === 'HUB'
                ? (order.currentHubId ? await tx.hub.findUnique({ where: { id: order.currentHubId } }) : null)
                : order.remetentePerson;
            if (!source?.city?.trim() || !source.state?.trim().match(/^[A-Za-z]{2}$/) || !source.cityIbgeCode) throw new AppError('Cadastre cidade, UF e código IBGE do início do serviço.', 400);
            const originCity = `${source.city.trim()}, ${source.state.trim().toUpperCase()}`;
            await tx.order.update({ where: { id: orderId }, data: { origemPrestacao: originCity, origemIbgeCode: source.cityIbgeCode, intakeMode: mode === 'HUB' ? 'HUB_DIRECT' : 'UNKNOWN', intakeHubId: order.currentHubId } });
            for (const calc of order.freightCalculations) {
                if (!['DRAFT', 'CALCULATED', 'CTE_REJECTED', 'DCE_REJECTED'].includes(calc.status)) continue;
                const previousCfop = calc.cfop;
                const end = resolveCteServiceLocation({ calculationCity: calc.destCity, orderCity: order.fimPrestacao, person: order.destinatarioPerson });
                const tax = calc.documentType === 'CTE' ? resolveCteCfopCstForEmission({ ...calc, originCity }, calc.fiscalEmitter, { startUf: source.state.toUpperCase(), endUf: end?.state }) : null;
                await tx.orderFreightCalculation.update({ where: { id: calc.id }, data: { originCity, ...(tax ? { cfop: tax.cfop, ...(calc.status === 'CTE_REJECTED' ? { status: 'CALCULATED' as const } : {}) } : {}) } });
                if (tax?.cfop && tax.cfop !== previousCfop) {
                    const endUf = end?.state ?? '';
                    const { reason } = deriveCteCfop({ startUf: source.state, endUf, emitterUf: calc.fiscalEmitter?.person.state ?? '', baseCfop: tax.cfop });
                    await tx.orderHistory.create({ data: { orderId, eventType: 'NOTE', actorUserId: req.user!.id, description: `CFOP ajustado automaticamente de ${previousCfop || 'não informado'} para ${tax.cfop}: ${reason}` } });
                }
            }
            await tx.orderHistory.create({ data: { orderId, eventType: 'NOTE', actorUserId: req.user!.id, description: `Início do serviço alterado para ${originCity} · ${mode === 'HUB' ? 'entrada direta no hub' : 'coletado no remetente'}` } });
            return { city: originCity, mode, allowed: true };
        });
        res.json({ success: true, data: result });
    } catch (error) {
        next(error instanceof z.ZodError ? new AppError('Escolha neste hub ou no remetente.', 400) : error);
    }
});
