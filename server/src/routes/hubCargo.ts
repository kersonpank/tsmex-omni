import { Router, type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import {
    authenticate,
    authorize,
    type AuthRequest,
} from '../middleware/auth.js';
import {
    getHubCargoSummary,
    hubCargoCapabilities,
    listHubCargoItems,
} from '../services/hubCargo/hubCargoReadModel.js';
import { resolveHubCargoCode } from '../services/hubCargo/resolveHubCargoCode.js';
import { getConsolidationQueues } from '../services/hubCargo/consolidationQueue.js';

const router = Router();

router.use(authenticate, authorize('ADMIN', 'HUB'));

const bucketSchema = z.enum(['stock', 'incoming', 'awaiting', 'triage', 'other']);
const listSchema = z.object({
    bucket: bucketSchema.default('stock'),
    q: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    withoutTrip: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true'),
    sort: z
        .enum(['recent', 'oldest', 'destination', 'weight', 'arrival'])
        .default('recent'),
    hubId: z.string().uuid().optional(),
});
const resolveSchema = z.object({
    code: z.string().min(1).max(1000),
    hubId: z.string().uuid().optional(),
});

function resolveActingHubId(req: AuthRequest, requested?: string): string {
    if (req.user!.hubId) return req.user!.hubId;
    if (req.user!.roles.includes('ADMIN') && requested) return requested;
    throw new AppError('Selecione um Hub para abrir a operação de carga.', 400);
}

router.get('/summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const requested = typeof req.query.hubId === 'string' ? req.query.hubId : undefined;
        const hubId = resolveActingHubId(req, requested);
        const capabilities = hubCargoCapabilities(
            req.user!.roles,
            req.user!.permissions,
        );
        if (!capabilities.canViewOrders && !capabilities.canReceive) {
            throw new AppError('Sem permissão para consultar a carga deste Hub.', 403);
        }
        const data = await getHubCargoSummary(hubId);
        res.json({ success: true, data, capabilities });
    } catch (error) {
        next(error);
    }
});

router.get('/items', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const query = listSchema.parse(req.query);
        const hubId = resolveActingHubId(req, query.hubId);
        const capabilities = hubCargoCapabilities(
            req.user!.roles,
            req.user!.permissions,
        );
        const receiveBucket = query.bucket === 'awaiting' || query.bucket === 'triage';
        if (
            (receiveBucket && !capabilities.canReceive) ||
            (!receiveBucket && !capabilities.canViewOrders)
        ) {
            throw new AppError('Sem permissão para abrir esta visão.', 403);
        }
        const result = await listHubCargoItems({
            hubId,
            bucket: query.bucket,
            capabilities,
            q: query.q,
            limit: query.limit,
            offset: query.offset,
            withoutTrip: query.withoutTrip,
            sort: query.sort,
        });
        res.json({
            success: true,
            data: result.items,
            pagination: {
                total: result.total,
                limit: query.limit,
                offset: query.offset,
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0]?.message ?? 'Filtro inválido.', 400));
        }
        next(error);
    }
});

// GET /api/hub/cargo/queues — fila de consolidação por próximo salto (G1).
router.get('/queues', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const requested = typeof req.query.hubId === 'string' ? req.query.hubId : undefined;
        const hubId = resolveActingHubId(req, requested);
        const capabilities = hubCargoCapabilities(req.user!.roles, req.user!.permissions);
        if (!capabilities.canViewOrders && !capabilities.canCreateTrip) {
            throw new AppError('Sem permissão para ver a fila de consolidação deste Hub.', 403);
        }
        const data = await getConsolidationQueues(hubId);
        res.json({ success: true, data, capabilities });
    } catch (error) {
        next(error);
    }
});

router.post('/resolve', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const body = resolveSchema.parse(req.body);
        const hubId = resolveActingHubId(req, body.hubId);
        const capabilities = hubCargoCapabilities(
            req.user!.roles,
            req.user!.permissions,
        );
        if (!capabilities.canViewOrders && !capabilities.canReceive) {
            throw new AppError('Sem permissão para buscar carga neste Hub.', 403);
        }
        const data = await resolveHubCargoCode({
            code: body.code,
            hubId,
            roles: req.user!.roles,
            capabilities,
        });
        res.json({ success: true, data });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0]?.message ?? 'Código inválido.', 400));
        }
        next(error);
    }
});

export { router as hubCargoRouter };
