import { Router, type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { acknowledgeHubException, listHubExceptions, resolveHubException } from '../services/exceptions/hubExceptionService.js';

const router = Router();

router.use(authenticate, authorize('ADMIN', 'HUB'));

const resolveSchema = z.object({ resolutionNote: z.string().max(2000) });

/** HUB só enxerga o próprio hub; ADMIN vê tudo ou filtra por ?hubId=. */
function scopeOf(req: AuthRequest): { hubId: string | null } {
    if (req.user!.hubId) return { hubId: req.user!.hubId };
    if (!req.user!.roles.includes('ADMIN')) throw new AppError('Sem hub vinculado ao usuário.', 403);
    const requested = typeof req.query.hubId === 'string' && req.query.hubId ? req.query.hubId : null;
    return { hubId: requested };
}

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await listHubExceptions(scopeOf(req)) });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/acknowledge', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = await acknowledgeHubException({ id: req.params.id as string, userId: req.user!.id, scope: scopeOf(req) });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/resolve', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const body = resolveSchema.safeParse(req.body ?? {});
        if (!body.success) throw new AppError('Informe a nota de resolução.', 400);
        const data = await resolveHubException({
            id: req.params.id as string, userId: req.user!.id, note: body.data.resolutionNote, scope: scopeOf(req),
        });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

export { router as hubExceptionsRouter };
