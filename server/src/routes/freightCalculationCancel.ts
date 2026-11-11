import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import {
    describeCteCancel,
    reconcileCteCancel,
    reconcileCteCorrection,
    requestCteCancel,
    requestCteCorrection,
} from '../services/freight/cteCancelService.js';

/**
 * Cancelamento (evento 110111) e carta de correção (evento 110110) de CT-e.
 * Montado em `/api/orders/:orderId/freight-calculations` (ver orders.ts), ao lado das rotas de cálculo.
 */
const router = Router({ mergeParams: true });

/** ADMIN em qualquer pedido; HUB só no pedido que está no seu hub. */
async function assertCanActOnOrder(req: AuthRequest, orderId: string): Promise<void> {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { currentHubId: true } });
    if (!order) throw new AppError('Order not found', 404);
    if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
        throw new AppError('Not authorized to access this order', 403);
    }
}

const cancelSchema = z.object({ reason: z.string().max(2000) });
const cceSchema = z.object({
    correcoes: z.array(z.object({
        grupo: z.string().max(100),
        campo: z.string().max(100),
        valor: z.string().max(1000),
        item: z.union([z.number(), z.string()]).nullable().optional(),
    })).max(50),
});

function guard(handler: (req: AuthRequest, res: Response, orderId: string, calcId: string) => Promise<void>) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const orderId = req.params.orderId as string;
            await assertCanActOnOrder(req, orderId);
            await handler(req, res, orderId, req.params.calcId as string);
        } catch (error) {
            if (error instanceof z.ZodError) return next(new AppError(error.errors[0]?.message ?? 'Dados inválidos.', 400));
            next(error);
        }
    };
}

// GET .../:calcId/cancel-cte — pode cancelar? se não, por quê (para a tela mostrar antes de pedir o motivo).
router.get('/:calcId/cancel-cte', authenticate, authorize('ADMIN', 'HUB'), guard(async (_req, res, orderId, calcId) => {
    res.json({ success: true, data: await describeCteCancel({ orderId, calcId }) });
}));

// POST .../:calcId/cancel-cte { reason } — pede o cancelamento ao provedor (uma única chamada).
router.post('/:calcId/cancel-cte', authenticate, authorize('ADMIN', 'HUB'), guard(async (req, res, orderId, calcId) => {
    const { reason } = cancelSchema.parse(req.body);
    const result = await requestCteCancel({ orderId, calcId, reason, actor: { id: req.user!.id } });
    res.status(result.state === 'PENDING' ? 202 : 200).json({ success: true, data: result });
}));

// POST .../:calcId/cancel-cte/reconcile — consulta o evento pendente (GET no provedor; nunca reenvia).
router.post('/:calcId/cancel-cte/reconcile', authenticate, authorize('ADMIN', 'HUB'), guard(async (req, res, orderId, calcId) => {
    const result = await reconcileCteCancel({ orderId, calcId, actor: { id: req.user!.id } });
    res.json({ success: true, data: result });
}));

// POST .../:calcId/cce { correcoes: [{ grupo, campo, valor, item? }] } — carta de correção.
router.post('/:calcId/cce', authenticate, authorize('ADMIN', 'HUB'), guard(async (req, res, orderId, calcId) => {
    const { correcoes } = cceSchema.parse(req.body);
    const result = await requestCteCorrection({ orderId, calcId, correcoes, actor: { id: req.user!.id } });
    res.status(result.record.status === 'registrada' ? 200 : 202).json({ success: true, data: result });
}));

// POST .../:calcId/cce/reconcile — consulta a carta pendente.
router.post('/:calcId/cce/reconcile', authenticate, authorize('ADMIN', 'HUB'), guard(async (req, res, orderId, calcId) => {
    res.json({ success: true, data: await reconcileCteCorrection({ orderId, calcId, actor: { id: req.user!.id } }) });
}));

export { router as freightCalculationCancelRouter };
