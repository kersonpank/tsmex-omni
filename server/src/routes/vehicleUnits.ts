import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import {
    getVehicleUnit,
    searchVehicleUnits,
    updateVehicleUnit,
    upsertVehicleUnit,
    vehicleUnitInputSchema,
} from '../services/vehicleUnitService.js';
import { unitFieldIssues, unitRntrc } from '../services/vehicleUnitRules.js';

const router = Router();

const roleSchema = z.enum(['TRACTION', 'TRAILER']);
const zodMessage = (error: unknown, next: NextFunction) =>
    error instanceof z.ZodError ? next(new AppError(error.errors[0].message, 400)) : next(error);

// GET /api/vehicle-units?q=ABC&role=TRAILER — busca por placa antes de qualquer formulário de cadastro.
router.get('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { q, role, limit } = z.object({
            q: z.string().optional(),
            role: roleSchema.optional(),
            limit: z.coerce.number().int().min(1).max(25).optional(),
        }).parse(req.query);
        res.json({ success: true, data: await searchVehicleUnits({ q, role, limit }) });
    } catch (error) {
        zodMessage(error, next);
    }
});

router.get('/:id', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await getVehicleUnit(req.params.id as string) });
    } catch (error) {
        next(error);
    }
});

// POST /api/vehicle-units — cadastro mestre (ou complemento) pela placa. Papel obrigatório.
router.post('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { role, ...input } = vehicleUnitInputSchema.extend({ role: roleSchema }).parse(req.body);
        const unit = await prisma.$transaction((tx) => upsertVehicleUnit(tx, role, input));
        res.status(201).json({ success: true, data: { ...unit, rntrc: unitRntrc(unit), missingFields: unitFieldIssues(unit) } });
    } catch (error) {
        zodMessage(error, next);
    }
});

// PATCH /api/vehicle-units/:id — dados da unidade; a placa é a identidade e não muda.
router.patch('/:id', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const input = vehicleUnitInputSchema.omit({ plate: true }).parse(req.body);
        res.json({ success: true, data: await updateVehicleUnit(req.params.id as string, input) });
    } catch (error) {
        zodMessage(error, next);
    }
});

export { router as vehicleUnitsRouter };
