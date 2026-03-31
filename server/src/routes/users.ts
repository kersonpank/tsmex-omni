import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

const router = Router();

const updatePermissionsSchema = z.object({
    permissions: z.array(z.string()),
});

// GET /api/users - List users (Admin only); optional filters role, hubId
router.get('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { role, hubId } = req.query;

        const where: Record<string, unknown> = {};
        if (role) where.roles = { has: role as any };
        if (hubId) where.hubId = hubId as string;

        const users = await prisma.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                roles: true,
                active: true,
                hubId: true,
                permissions: true,
                hub: { select: { id: true, name: true, code: true } },
                admin: { select: { name: true } },
                link: { select: { id: true, name: true, approvalStatus: true } },
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            success: true,
            data: users,
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/users/:id/permissions - Update user permissions (Admin only)
router.patch('/:id/permissions', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const body = updatePermissionsSchema.parse(req.body);

        const user = await prisma.user.update({
            where: { id },
            data: { permissions: body.permissions },
            select: {
                id: true,
                email: true,
                roles: true,
                permissions: true,
                hubId: true,
            },
        });

        res.json({
            success: true,
            data: user,
            message: 'Permissões atualizadas',
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

export { router as usersRouter };
