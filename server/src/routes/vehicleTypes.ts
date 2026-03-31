import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Validation schema
const vehicleTypeSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    code: z.string().min(1, 'Code is required'),
    maxWeight: z.number().positive('Max weight must be positive'),
    maxVolume: z.number().positive('Max volume must be positive'),
    maxValue: z.number().positive('Max value must be positive'),
    length: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    enclosed: z.boolean().default(true),
    refrigerated: z.boolean().default(false),
    active: z.boolean().default(true),
});

// GET /api/vehicle-types - List all vehicle types
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { active } = req.query;

        const vehicleTypes = await prisma.vehicleType.findMany({
            where: active !== undefined ? { active: active === 'true' } : undefined,
            orderBy: { maxWeight: 'asc' },
        });

        res.json({
            success: true,
            data: vehicleTypes,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/vehicle-types/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const vehicleType = await prisma.vehicleType.findUnique({
            where: { id: id },
            include: {
                _count: {
                    select: { links: true, manifests: true }
                }
            }
        });

        if (!vehicleType) {
            throw new AppError('Vehicle type not found', 404);
        }

        res.json({
            success: true,
            data: vehicleType,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/vehicle-types - Create vehicle type (Admin only)
router.post('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = vehicleTypeSchema.parse(req.body);

        // Check if code exists
        const existing = await prisma.vehicleType.findUnique({
            where: { code: data.code }
        });

        if (existing) {
            throw new AppError('Vehicle type code already exists', 400);
        }

        const vehicleType = await prisma.vehicleType.create({
            data,
        });

        res.status(201).json({
            success: true,
            data: vehicleType,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/vehicle-types/:id - Update vehicle type (Admin only)
router.patch('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const data = vehicleTypeSchema.partial().parse(req.body);

        const vehicleType = await prisma.vehicleType.update({
            where: { id: id },
            data,
        });

        res.json({
            success: true,
            data: vehicleType,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/vehicle-types/:id - Soft delete (Admin only)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        await prisma.vehicleType.update({
            where: { id: id },
            data: { active: false },
        });

        res.json({
            success: true,
            message: 'Vehicle type deactivated',
        });
    } catch (error) {
        next(error);
    }
});

export { router as vehicleTypesRouter };
