import { Router, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { getCteEmissionQueue } from '../services/queues/cteEmissionQueue.js';
import { getDistribuicaoNfeQueue } from '../services/queues/distribuicaoNfeQueue.js';

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

// GET .../cte-queue-status — visibilidade direta do estado da fila, sem depender de um
// SystemAlert existir. O pause() em si vive no Redis, desacoplado do ciclo de vida do alerta no
// Postgres — se o alerta que causou a pausa for reconhecido/resolvido sem o resume() ter sido
// de fato chamado, a fila fica pausada indefinidamente sem nenhum sinal visível hoje.
router.get('/cte-queue-status', authenticate, authorize('ADMIN'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const queue = getCteEmissionQueue();
        const [paused, waiting, active, delayed, failed] = await Promise.all([
            queue.isPaused(),
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getDelayedCount(),
            queue.getFailedCount(),
        ]);
        res.json({ success: true, data: { paused, counts: { waiting, active, delayed, failed } } });
    } catch (error) {
        next(error);
    }
});

// POST .../cte-queue/resume — resume incondicional, não exige um SystemAlert FISCAL_PROVIDER_QUOTA
// existente/OPEN. Via de escape quando o alerta original que causou a pausa já não existe mais
// (ex.: foi resolvido manualmente sem confirmar que a fila de fato retomou).
router.post('/cte-queue/resume', authenticate, authorize('ADMIN'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        await getCteEmissionQueue().resume();
        res.json({ success: true, message: 'Fila de emissão de CT-e retomada.' });
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
        await getCteEmissionQueue().resume();
        const updated = await prisma.systemAlert.update({
            where: { id: alert.id },
            data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
        res.json({ success: true, data: updated, message: 'Fila de emissão de CT-e retomada.' });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/resume-distribuicao-nfe-queue', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const alert = await prisma.systemAlert.findUnique({ where: { id: req.params.id as string } });
        if (!alert) throw new AppError('Alerta não encontrado', 404);
        if (alert.category !== 'FISCAL_DISTRIBUICAO_NFE_QUOTA') {
            throw new AppError('Este alerta não está associado à fila de distribuição de NF-e.', 400);
        }
        await getDistribuicaoNfeQueue().resume();
        const updated = await prisma.systemAlert.update({
            where: { id: alert.id },
            data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
        res.json({ success: true, data: updated, message: 'Fila de distribuição de NF-e retomada.' });
    } catch (error) {
        next(error);
    }
});

export { router as systemAlertsRouter };
