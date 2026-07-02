import { Router, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { cteEmissionQueue } from '../services/queues/cteEmissionQueue.js';

const router = Router();

router.get('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
        const alerts = await prisma.systemAlert.findMany({
            where: statusParam ? { status: statusParam as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' } : undefined,
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        res.json({ success: true, data: alerts });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/acknowledge', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const alert = await prisma.systemAlert.update({
            where: { id: req.params.id as string },
            data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedByUserId: req.user!.id },
        });
        res.json({ success: true, data: alert });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/resume-cte-queue', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const alert = await prisma.systemAlert.findUnique({ where: { id: req.params.id as string } });
        if (!alert) throw new AppError('Alerta não encontrado', 404);
        if (alert.category !== 'FISCAL_PROVIDER_QUOTA') {
            throw new AppError('Este alerta não está associado à fila de emissão de CT-e.', 400);
        }
        await cteEmissionQueue.resume();
        const updated = await prisma.systemAlert.update({
            where: { id: alert.id },
            data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
        res.json({ success: true, data: updated, message: 'Fila de emissão de CT-e retomada.' });
    } catch (error) {
        next(error);
    }
});

export { router as systemAlertsRouter };
