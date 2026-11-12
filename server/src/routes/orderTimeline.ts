import { Router, type Response, type NextFunction } from 'express';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { ensureHubOrderAccessById } from '../lib/hubOrderAccess.js';
import { loadOrderTimeline } from '../services/orderTimeline.js';

/** GET /api/orders/:id/timeline — ADMIN, ou HUB com o mesmo escopo de acesso do pedido. */
export const orderTimelineRouter = Router({ mergeParams: true });

orderTimelineRouter.get('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        if (!req.user!.roles.includes('ADMIN')) await ensureHubOrderAccessById(req, id);
        res.json({ success: true, data: await loadOrderTimeline(id) });
    } catch (error) {
        next(error);
    }
});
