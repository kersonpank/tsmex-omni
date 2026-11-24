import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import bcrypt from 'bcryptjs';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { newPasswordSchema } from '../lib/passwordPolicy.js';

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

function assertNotSelf(req: AuthRequest, id: string, what: string) {
    if (req.user!.id === id) throw new AppError(`Use a sua própria tela para ${what}.`, 400);
}

// POST /api/users/:id/reset-password — ADMIN define senha provisória; todas as sessões do usuário caem.
router.post('/:id/reset-password', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        assertNotSelf(req, id, 'trocar a senha');
        const { password } = z.object({ password: newPasswordSchema }).parse(req.body);
        const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new AppError('Usuário não encontrado.', 404);
        await prisma.user.update({
            where: { id },
            data: { password: await bcrypt.hash(password, 10), tokenVersion: { increment: 1 } },
        });
        res.json({ success: true, message: 'Senha redefinida. O usuário precisa entrar de novo.' });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// POST /api/users/:id/revoke-sessions — ADMIN derruba todas as sessões (aparelho perdido, desligamento).
router.post('/:id/revoke-sessions', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new AppError('Usuário não encontrado.', 404);
        await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
        res.json({ success: true, message: 'Sessões encerradas.' });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/users/:id/active — ADMIN ativa/desativa o acesso; desativar também derruba as sessões.
router.patch('/:id/active', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        assertNotSelf(req, id, 'alterar o próprio acesso');
        const { active } = z.object({ active: z.boolean() }).parse(req.body);
        const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new AppError('Usuário não encontrado.', 404);
        const user = await prisma.user.update({
            where: { id },
            data: active ? { active: true } : { active: false, tokenVersion: { increment: 1 } },
            select: { id: true, email: true, active: true },
        });
        res.json({ success: true, data: user, message: active ? 'Acesso reativado.' : 'Acesso desativado.' });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

export { router as usersRouter };
