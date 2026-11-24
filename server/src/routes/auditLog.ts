import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

const router = Router();

const querySchema = z.object({
    actorUserId: z.string().optional(),
    entityId: z.string().optional(),
    subject: z.string().optional(),
    route: z.string().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    before: z.coerce.date().optional(),
});

// GET /api/audit-log — ADMIN consulta a trilha (mais recente primeiro; pagina por `before`).
router.get('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const q = querySchema.parse(req.query);
        const createdAt: Prisma.DateTimeFilter = {};
        if (q.from) createdAt.gte = q.from;
        if (q.to) createdAt.lte = q.to;
        if (q.before) createdAt.lt = q.before;
        const where: Prisma.AuditLogWhereInput = {
            ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
            ...(q.entityId ? { entityId: q.entityId } : {}),
            ...(q.subject ? { subject: q.subject.trim().toLowerCase() } : {}),
            ...(q.route ? { route: { contains: q.route } } : {}),
            ...(Object.keys(createdAt).length ? { createdAt } : {}),
        };
        const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit });
        const userIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => Boolean(v)))];
        const users = userIds.length
            ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
            : [];
        const emailById = new Map(users.map((u) => [u.id, u.email]));
        res.json({
            success: true,
            data: rows.map((r) => ({ ...r, actorEmail: r.actorUserId ? emailById.get(r.actorUserId) ?? null : null })),
            nextBefore: rows.length === q.limit ? rows[rows.length - 1].createdAt : null,
        });
    } catch (error) {
        next(error);
    }
});

export { router as auditLogRouter };
