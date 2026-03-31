import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Validation schemas
const manifestSchema = z.object({
    vehicleTypeId: z.string().uuid('Invalid vehicle type ID'),
    origin: z.string().min(1, 'Origin is required'),
    destination: z.string().min(1, 'Destination is required'),
    hubId: z.string().uuid().optional(),
    stops: z.array(z.object({
        city: z.string(),
        order: z.number(),
    })).optional(),
});

// GET /api/manifests - List manifests
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { status, linkId, hubId } = req.query;

        // Links can only see their own manifests
        let linkFilter: Record<string, unknown> = linkId ? { linkId: linkId as string } : {};
        let hubFilter: Record<string, unknown> = hubId ? { hubId: hubId as string } : {};
        if (req.user!.roles.includes('LINK')) {
            const link = await prisma.link.findFirst({
                where: { userId: req.user!.id }
            });
            if (!link) throw new AppError('Link profile not found', 404);
            linkFilter = { linkId: link.id };
        }
        if (req.user!.roles.includes('HUB') && req.user!.hubId) {
            hubFilter = { hubId: req.user!.hubId };
        }

        const manifests = await prisma.manifest.findMany({
            where: {
                ...linkFilter,
                ...hubFilter,
                ...(status ? { status: status as any } : {}),
            },
            include: {
                vehicleType: true,
                link: {
                    select: { name: true, phone: true }
                },
                hub: {
                    select: { name: true, code: true }
                },
                demands: {
                    select: { id: true, origin: true, destination: true, commodity: true, weight: true }
                },
                _count: {
                    select: { demands: true }
                }
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            success: true,
            data: manifests,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/manifests/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const manifest = await prisma.manifest.findUnique({
            where: { id: id },
            include: {
                vehicleType: true,
                link: true,
                hub: true,
                demands: {
                    include: {
                        client: {
                            select: { companyName: true }
                        }
                    }
                },
            }
        });

        if (!manifest) {
            throw new AppError('Manifest not found', 404);
        }

        // Check access for links
        if (req.user!.roles.includes('LINK')) {
            const link = await prisma.link.findFirst({
                where: { userId: req.user!.id }
            });
            if (!link || link.id !== manifest.linkId) {
                throw new AppError('Not authorized', 403);
            }
        }

        res.json({
            success: true,
            data: manifest,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/manifests - Create manifest (Admin or HUB for own hub)
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const data = manifestSchema.parse(req.body);

        // HUB can only create manifests for their own hub
        const effectiveHubId = req.user!.roles.includes('HUB')
            ? req.user!.hubId
            : data.hubId;
        if (req.user!.roles.includes('HUB') && (!effectiveHubId || effectiveHubId !== req.user!.hubId)) {
            throw new AppError('Hub user can only create manifests for their own hub', 403);
        }

        // Get vehicle type to set initial capacity
        const vehicleType = await prisma.vehicleType.findUnique({
            where: { id: data.vehicleTypeId }
        });

        if (!vehicleType) {
            throw new AppError('Vehicle type not found', 404);
        }

        const manifest = await prisma.manifest.create({
            data: {
                vehicleTypeId: data.vehicleTypeId,
                origin: data.origin,
                destination: data.destination,
                hubId: effectiveHubId ?? undefined,
                stops: data.stops ? data.stops : undefined,
            },
            include: {
                vehicleType: true,
            }
        });

        res.status(201).json({
            success: true,
            data: manifest,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/manifests/:id/demands - Add demand to manifest (Admin or HUB for own hub manifest)
router.post('/:id/demands', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const { demandId } = req.body;

        if (!demandId) {
            throw new AppError('Demand ID is required', 400);
        }

        // Get manifest with vehicle type
        const manifest = await prisma.manifest.findUnique({
            where: { id: id },
            include: { vehicleType: true, demands: true }
        });

        if (!manifest) {
            throw new AppError('Manifest not found', 404);
        }

        if (req.user!.roles.includes('HUB') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }

        if (manifest.status !== 'DRAFT') {
            throw new AppError('Cannot modify manifest in current status', 400);
        }

        // Get demand
        const demand = await prisma.demand.findUnique({
            where: { id: demandId }
        });

        if (!demand) {
            throw new AppError('Demand not found', 404);
        }

        if (demand.manifestId) {
            throw new AppError('Demand is already assigned to a manifest', 400);
        }

        // Check capacity
        const effectiveWeight = Math.max(demand.weight, demand.cubedWeight || 0);
        const newTotalWeight = manifest.totalWeight + effectiveWeight;
        const newTotalVolume = manifest.totalVolume + demand.volume;
        const newTotalValue = manifest.totalValue + demand.nfValue;

        if (newTotalWeight > manifest.vehicleType.maxWeight) {
            throw new AppError(`Exceeds weight capacity: ${newTotalWeight}kg / ${manifest.vehicleType.maxWeight}kg`, 400);
        }

        if (newTotalVolume > manifest.vehicleType.maxVolume) {
            throw new AppError(`Exceeds volume capacity: ${newTotalVolume}m³ / ${manifest.vehicleType.maxVolume}m³`, 400);
        }

        if (newTotalValue > manifest.vehicleType.maxValue) {
            throw new AppError(`Exceeds value limit: R$ ${newTotalValue} / R$ ${manifest.vehicleType.maxValue}`, 400);
        }

        // Update demand and manifest
        await prisma.$transaction([
            prisma.demand.update({
                where: { id: demandId },
                data: { manifestId: id, status: 'ASSIGNED' }
            }),
            prisma.manifest.update({
                where: { id },
                data: {
                    totalWeight: newTotalWeight,
                    totalVolume: newTotalVolume,
                    totalValue: newTotalValue,
                }
            }),
            prisma.demandEvent.create({
                data: {
                    demandId,
                    status: 'ASSIGNED',
                    description: `Alocada ao manifesto #${id.slice(0, 8)}`,
                }
            })
        ]);

        const updated = await prisma.manifest.findUnique({
            where: { id },
            include: {
                vehicleType: true,
                demands: true,
            }
        });

        res.json({
            success: true,
            data: updated,
            utilization: {
                weight: (newTotalWeight / manifest.vehicleType.maxWeight * 100).toFixed(1) + '%',
                volume: (newTotalVolume / manifest.vehicleType.maxVolume * 100).toFixed(1) + '%',
                value: (newTotalValue / manifest.vehicleType.maxValue * 100).toFixed(1) + '%',
            }
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/manifests/:id/demands/:demandId - Remove demand from manifest
router.delete('/:id/demands/:demandId', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const demandId = req.params.demandId as string;

        const manifest = await prisma.manifest.findUnique({
            where: { id: id },
            include: { vehicleType: true }
        });

        if (!manifest) {
            throw new AppError('Manifest not found', 404);
        }

        if (manifest.status !== 'DRAFT') {
            throw new AppError('Cannot modify manifest in current status', 400);
        }

        const demand = await prisma.demand.findUnique({
            where: { id: demandId }
        });

        if (!demand || demand.manifestId !== id) {
            throw new AppError('Demand not found in this manifest', 404);
        }

        const effectiveWeight = Math.max(demand.weight, demand.cubedWeight || 0);

        await prisma.$transaction([
            prisma.demand.update({
                where: { id: demandId },
                data: { manifestId: null, status: 'APPROVED' }
            }),
            prisma.manifest.update({
                where: { id },
                data: {
                    totalWeight: manifest.totalWeight - effectiveWeight,
                    totalVolume: manifest.totalVolume - demand.volume,
                    totalValue: manifest.totalValue - demand.nfValue,
                }
            })
        ]);

        res.json({
            success: true,
            message: 'Demand removed from manifest',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/assign - Assign manifest to link
router.patch('/:id/assign', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { linkId } = req.body;

        if (!linkId) {
            throw new AppError('Link ID is required', 400);
        }

        const link = await prisma.link.findUnique({
            where: { id: linkId as string }
        });

        if (!link || link.approvalStatus !== 'APPROVED') {
            throw new AppError('Link not found or not approved', 404);
        }

        const manifest = await prisma.manifest.update({
            where: { id: id },
            data: {
                linkId,
                status: 'PENDING_ACCEPT',
                offeredAt: new Date(),
            },
            include: {
                link: true,
                vehicleType: true,
                demands: true,
            }
        });

        // TODO: Send WhatsApp notification to link

        res.json({
            success: true,
            data: manifest,
            message: 'Manifest offered to link',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/accept - Link accepts manifest
router.patch('/:id/accept', authenticate, authorize('LINK'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const link = await prisma.link.findFirst({
            where: { userId: req.user!.id }
        });

        if (!link) {
            throw new AppError('Link profile not found', 404);
        }

        const manifest = await prisma.manifest.findUnique({
            where: { id: id }
        });

        if (!manifest || manifest.linkId !== link.id) {
            throw new AppError('Manifest not found or not assigned to you', 404);
        }

        if (manifest.status !== 'PENDING_ACCEPT') {
            throw new AppError('Manifest is not pending acceptance', 400);
        }

        const updated = await prisma.manifest.update({
            where: { id: id },
            data: {
                status: 'ACCEPTED',
                acceptedAt: new Date(),
            },
        });

        res.json({
            success: true,
            data: updated,
            message: 'Manifest accepted',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/reject - Link rejects manifest
router.patch('/:id/reject', authenticate, authorize('LINK'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { reason } = req.body;

        const link = await prisma.link.findFirst({
            where: { userId: req.user!.id }
        });

        if (!link) {
            throw new AppError('Link profile not found', 404);
        }

        const manifest = await prisma.manifest.findUnique({
            where: { id: id }
        });

        if (!manifest || manifest.linkId !== link.id) {
            throw new AppError('Manifest not found or not assigned to you', 404);
        }

        const updated = await prisma.manifest.update({
            where: { id: id },
            data: {
                status: 'DRAFT',
                linkId: null,
                rejectedAt: new Date(),
                rejectionReason: reason,
                offeredAt: null,
            },
        });

        res.json({
            success: true,
            data: updated,
            message: 'Manifest rejected',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/start - Start manifest execution
router.patch('/:id/start', authenticate, authorize('LINK'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const manifest = await prisma.manifest.findUnique({
            where: { id: id },
            include: { demands: true, vehicleType: true }
        });

        if (!manifest || manifest.status !== 'ACCEPTED') {
            throw new AppError('Manifest not found or not in accepted status', 400);
        }

        await prisma.$transaction([
            prisma.manifest.update({
                where: { id: id },
                data: {
                    status: 'IN_PROGRESS',
                    startedAt: new Date(),
                },
            }),
            ...manifest.demands.map(d =>
                prisma.demand.update({
                    where: { id: d.id },
                    data: { status: 'IN_TRANSIT' }
                })
            ),
            ...manifest.demands.map(d =>
                prisma.demandEvent.create({
                    data: {
                        demandId: d.id,
                        status: 'IN_TRANSIT',
                        description: 'Carga saiu para entrega',
                        location: manifest.origin,
                    }
                })
            )
        ]);

        res.json({
            success: true,
            message: 'Manifest started',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/complete - Complete manifest
router.patch('/:id/complete', authenticate, authorize('LINK', 'ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const manifest = await prisma.manifest.findUnique({
            where: { id: id },
            include: { demands: true, vehicleType: true }
        });

        if (!manifest || manifest.status !== 'IN_PROGRESS') {
            throw new AppError('Manifest not found or not in progress', 400);
        }

        await prisma.$transaction([
            prisma.manifest.update({
                where: { id: id },
                data: {
                    status: 'COMPLETED',
                    completedAt: new Date(),
                },
            }),
            ...manifest.demands.map(d =>
                prisma.demand.update({
                    where: { id: d.id },
                    data: { status: 'DELIVERED' }
                })
            ),
            ...manifest.demands.map(d =>
                prisma.demandEvent.create({
                    data: {
                        demandId: d.id,
                        status: 'DELIVERED',
                        description: 'Carga entregue ao destinatário',
                        location: manifest.destination,
                    }
                })
            )
        ]);

        // Update link score
        if (manifest.linkId) {
            await prisma.link.update({
                where: { id: manifest.linkId },
                data: {
                    deliveryCount: { increment: manifest.demands.length },
                }
            });
        }

        res.json({
            success: true,
            message: 'Manifest completed',
        });
    } catch (error) {
        next(error);
    }
});

export { router as manifestsRouter };
