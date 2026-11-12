import { Router, type Response, type NextFunction } from 'express';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { registerManifestArrival } from '../services/manifestArrival.js';

/** "A carreta chegou": PATCH /api/manifests/:id/arrive e /api/manifests/:id/stops/:stopId/arrive (ADMIN ou HUB do destino). */
export const manifestArrivalRouter = Router({ mergeParams: true });

const handler = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const actor = { userId: req.user!.id, roles: req.user!.roles as string[], hubId: req.user!.hubId ?? null };
        const stopId = req.params.stopId ? String(req.params.stopId) : null;
        const result = await registerManifestArrival(String(req.params.id), stopId, actor);
        res.json({
            success: true,
            data: result,
            message: result.alreadyArrived ? 'A chegada já estava registrada.' : 'Chegada registrada. Faça a conferência da carga.',
        });
    } catch (error) {
        next(error);
    }
};

manifestArrivalRouter.patch('/arrive', authenticate, authorize('ADMIN', 'HUB'), handler);
manifestArrivalRouter.patch('/stops/:stopId/arrive', authenticate, authorize('ADMIN', 'HUB'), handler);
