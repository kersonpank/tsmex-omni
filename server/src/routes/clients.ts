import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ManifestStatus } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { assertClientPricingAccess, pricingVisibilityWhere, visibleClientIdsForHub } from '../services/pricingVisibility.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

const router = Router();

const updateClientSchema = z.object({
    contactName: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().email().optional(),
});

// GET /api/clients - List all clients (Admin and HUB for entrada no hub dropdown)
router.get('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const hubOnly = req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN');
        const visibleIds = hubOnly && req.user!.hubId ? await visibleClientIdsForHub(req.user!.hubId) : [];
        const clients = await prisma.client.findMany({
            where: hubOnly ? { id: { in: visibleIds } } : undefined,
            include: {
                user: {
                    select: { email: true, active: true }
                },
                _count: {
                    select: { demands: true, pricingTables: true }
                }
            },
            orderBy: { companyName: 'asc' },
        });

        res.json({
            success: true,
            data: clients,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/clients/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        await assertClientPricingAccess(req.user!, id);
        const visibility = await pricingVisibilityWhere(req.user!);

        const client = await prisma.client.findUnique({
            where: { id: id },
            include: {
                user: {
                    select: { email: true, active: true }
                },
                pricingTables: {
                    where: { active: true, AND: [visibility] },
                    include: { route: true }
                },
            }
        });

        if (!client) {
            throw new AppError('Client not found', 404);
        }

        res.json({
            success: true,
            data: client,
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/clients/:id - Update client (Admin only; contactName, phone, email)
router.patch('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const data = updateClientSchema.parse(req.body);

        const client = await prisma.client.findUnique({
            where: { id },
            include: { user: true },
        });
        if (!client) {
            throw new AppError('Client not found', 404);
        }

        const updates: { contactName?: string; phone?: string } = {};
        if (data.contactName != null) updates.contactName = data.contactName;
        if (data.phone != null) updates.phone = data.phone;

        if (data.email != null && data.email !== client.user.email) {
            const existing = await prisma.user.findUnique({
                where: { email: data.email },
            });
            if (existing) {
                throw new AppError('Email já cadastrado', 400);
            }
            await prisma.user.update({
                where: { id: client.userId },
                data: { email: data.email },
            });
        }

        const updated = await prisma.client.update({
            where: { id },
            data: updates,
            include: {
                user: { select: { email: true, active: true } },
            },
        });

        res.json({
            success: true,
            data: updated,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// GET /api/clients/:id/demands
router.get('/:id/demands', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const status = req.query.status as string | undefined;
        const limit = (req.query.limit as string) || '50';
        const offset = (req.query.offset as string) || '0';

        const ACTIVE_MANIFEST_STATUSES: ManifestStatus[] = [
            'DRAFT',
            'PENDING_ACCEPT',
            'ACCEPTED',
            'IN_PROGRESS',
        ];

        // Clients can only view their own demands
        if (req.user!.roles.includes('CLIENT')) {
            const client = await prisma.client.findFirst({
                where: { userId: req.user!.id }
            });
            if (!client || client.id !== id) {
                throw new AppError('Not authorized', 403);
            }
        }

        const demands = await prisma.demand.findMany({
            where: {
                clientId: id,
                ...(status ? { status: status as any } : {}),
            },
            include: {
                order: {
                    include: {
                        legs: {
                            where: {
                                manifest: {
                                    status: { in: ACTIVE_MANIFEST_STATUSES }
                                }
                            },
                            include: {
                                manifest: {
                                    select: { id: true, status: true }
                                }
                            },
                            take: 1
                        }
                    }
                },
                _count: {
                    select: { events: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit as string),
            skip: parseInt(offset as string),
        });

        const mappedDemands = demands.map((d: any) => {
            const activeLeg = d.order?.legs?.[0];
            const manifest = activeLeg?.manifest || null;
            const { order, ...rest } = d;
            return {
                ...rest,
                manifest,
            };
        });

        res.json({
            success: true,
            data: mappedDemands,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/clients/:id/pricing - Get client's pricing tables
router.get('/:id/pricing', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        await assertClientPricingAccess(req.user!, id);
        const visibility = await pricingVisibilityWhere(req.user!);

        const pricingTables = await prisma.pricingTable.findMany({
            where: {
                AND: [visibility],
                clientId: id,
                active: true,
            },
            include: {
                route: true,
                minFreightRanges: true,
            },
            orderBy: { priority: 'desc' },
        });

        res.json({
            success: true,
            data: pricingTables,
        });
    } catch (error) {
        next(error);
    }
});

export { router as clientsRouter };
