import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
    closeHubAgreement,
    closeLinkAgreement,
    createHubAgreement,
    createLinkAgreement,
    listHubAgreements,
    listLinkAgreements,
} from '../services/pricing/costAgreements.js';

/**
 * Acordos de custo que alimentam a margem: transportador (`LinkPricingAgreement`) e comissão do
 * hub parceiro (`HubCommissionAgreement`). Só ADMIN. Encerrar = desativar; nada é apagado.
 */
const router = Router();
router.use(authenticate, authorize('ADMIN'));

const activeQuery = z.object({
    active: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
});

const linkBody = z.object({
    linkId: z.string().uuid(),
    originCity: z.string().trim().min(2).max(120),
    destinationCity: z.string().trim().min(2).max(120),
    vehicleTypeCode: z.string().trim().min(1).max(40),
    costMode: z.enum(['FLAT', 'PER_M3', 'PER_KG']).default('FLAT'),
    flatRate: z.number().min(0).max(10_000_000),
    ratePerM3: z.number().min(0).max(1_000_000).nullable().optional(),
    ratePerKg: z.number().min(0).max(1_000_000).nullable().optional(),
});

const hubBody = z.object({
    hubId: z.string().uuid(),
    handlingFeePerOrder: z.number().min(0).max(1_000_000).default(0),
    percentOfFreight: z.number().min(0).max(100).nullable().optional(),
});

const fail = (error: unknown, next: NextFunction) =>
    error instanceof z.ZodError ? next(new AppError(error.errors[0].message, 400)) : next(error);

router.get('/link', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { active } = activeQuery.parse(req.query);
        const linkId = typeof req.query.linkId === 'string' ? req.query.linkId : undefined;
        res.json({ success: true, data: await listLinkAgreements({ active, linkId }) });
    } catch (error) { fail(error, next); }
});

router.post('/link', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        res.status(201).json({ success: true, data: await createLinkAgreement(linkBody.parse(req.body)) });
    } catch (error) { fail(error, next); }
});

router.post('/link/:id/close', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await closeLinkAgreement(req.params.id as string) });
    } catch (error) { fail(error, next); }
});

router.get('/hub', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { active } = activeQuery.parse(req.query);
        const hubId = typeof req.query.hubId === 'string' ? req.query.hubId : undefined;
        res.json({ success: true, data: await listHubAgreements({ active, hubId }) });
    } catch (error) { fail(error, next); }
});

router.post('/hub', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        res.status(201).json({ success: true, data: await createHubAgreement(hubBody.parse(req.body)) });
    } catch (error) { fail(error, next); }
});

router.post('/hub/:id/close', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await closeHubAgreement(req.params.id as string) });
    } catch (error) { fail(error, next); }
});

export { router as costAgreementsRouter };
