import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { isAcbrCredentialsConfigured } from '../services/acbr/acbrConfig.js';
import { emitMdfeViaAcbr } from '../services/acbr/acbrMdfeEmit.js';
import { buildCiotPlaceholder } from '../services/ciotService.js';
import { getManifestMargin } from '../services/pricingService.js';
import {
    addOrderToManifest,
    completeManifest,
    OPERATIONAL_TRIP_TYPES,
    removeOrderFromManifest,
    startManifest,
    validateCreateManifestInput,
} from '../services/manifestLifecycle.js';

function mapManifestLegsToDemands(manifest: any) {
    if (!manifest) return null;
    const demands = (manifest.legs || []).map((leg: any) => {
        if (!leg.order || !leg.order.demand) return null;
        return {
            ...leg.order.demand,
            client: leg.order.demand.client,
            order: {
                id: leg.order.id,
                status: leg.order.status
            }
        };
    }).filter(Boolean);

    const demandsCount = demands.length;
    const { legs, _count, ...rest } = manifest;
    return {
        ...rest,
        demands,
        _count: _count ? { ..._count, demands: demandsCount } : undefined
    };
}

const router = Router();

const operationalTripTypeSchema = z.enum(OPERATIONAL_TRIP_TYPES);

// Validation schemas
const manifestSchema = z
    .object({
        vehicleTypeId: z.string().uuid('Invalid vehicle type ID'),
        origin: z.string().min(1, 'Origin is required'),
        destination: z.string().min(1, 'Destination is required'),
        tripType: operationalTripTypeSchema.default('TRANSFER'),
        hubId: z.string().uuid().optional(),
        destHubId: z.string().uuid().optional(),
        stops: z
            .array(
                z.object({
                    city: z.string(),
                    order: z.number(),
                })
            )
            .optional(),
    })
    .superRefine((data, ctx) => {
        if (data.tripType === 'TRANSFER' && !data.destHubId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'destHubId é obrigatório para viagens do tipo TRANSFER',
                path: ['destHubId'],
            });
        }
    });

// GET /api/manifests - List manifests
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { status, linkId, hubId } = req.query;

        const andConditions: Prisma.ManifestWhereInput[] = [];

        if (req.user!.roles.includes('LINK')) {
            const link = await prisma.link.findFirst({ where: { userId: req.user!.id } });
            if (!link) throw new AppError('Link profile not found', 404);
            andConditions.push({ linkId: link.id });
        } else if (linkId) {
            andConditions.push({ linkId: linkId as string });
        }

        // HUB sees manifests where it is origin OR destination
        if (req.user!.roles.includes('HUB') && req.user!.hubId) {
            andConditions.push({ OR: [{ hubId: req.user!.hubId }, { destHubId: req.user!.hubId }] });
        } else if (hubId) {
            andConditions.push({ hubId: hubId as string });
        }

        if (status) andConditions.push({ status: status as any });

        const manifests = await prisma.manifest.findMany({
            where: andConditions.length > 0 ? { AND: andConditions } : {},
            include: {
                vehicleType: true,
                link: {
                    select: { name: true, phone: true }
                },
                hub: {
                    select: { name: true, code: true }
                },
                destHub: {
                    select: { name: true, code: true }
                },
                legs: {
                    include: {
                        order: {
                            include: {
                                demand: {
                                    select: { id: true, origin: true, destination: true, commodity: true, weight: true, volume: true, nfValue: true, status: true }
                                }
                            }
                        }
                    }
                },
                _count: {
                    select: { legs: true }
                }
            },
            orderBy: { createdAt: 'desc' },
        });

        const mappedManifests = manifests.map(mapManifestLegsToDemands);
        const dataWithMargins = await Promise.all(
            mappedManifests.map(async (m: any) => {
                const marginInfo = await getManifestMargin(m.id);
                return {
                    ...m,
                    ...marginInfo,
                };
            })
        );

        res.json({
            success: true,
            data: dataWithMargins,
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
                destHub: true,
                legs: {
                    include: {
                        order: {
                            include: {
                                demand: {
                                    include: {
                                        client: {
                                            select: { companyName: true }
                                        }
                                    }
                                }
                            }
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

        const marginInfo = await getManifestMargin(id);

        res.json({
            success: true,
            data: {
                ...mapManifestLegsToDemands(manifest),
                ...marginInfo,
            },
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

        await validateCreateManifestInput({
            vehicleTypeId: data.vehicleTypeId,
            origin: data.origin,
            destination: data.destination,
            tripType: data.tripType,
            hubId: effectiveHubId ?? undefined,
            destHubId: data.destHubId,
            stops: data.stops,
        });

        const manifest = await prisma.manifest.create({
            data: {
                vehicleTypeId: data.vehicleTypeId,
                origin: data.origin,
                destination: data.destination,
                tripType: data.tripType,
                hubId: effectiveHubId ?? undefined,
                destHubId: data.tripType === 'TRANSFER' ? data.destHubId : undefined,
                stops: data.stops ? data.stops : undefined,
            },
            include: {
                vehicleType: true,
                destHub: { select: { id: true, code: true, name: true } },
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

// POST /api/manifests/:id/demands - Add order to manifest (Admin or HUB for own hub manifest)
router.post('/:id/demands', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const { demandId, orderId } = req.body;

        const targetOrderId = orderId ?? (demandId ? (await prisma.order.findUnique({ where: { demandId } }))?.id : null);
        if (!targetOrderId) {
            throw new AppError('Order ID or Demand ID with associated order is required', 400);
        }

        const manifestCheck = await prisma.manifest.findUnique({
            where: { id },
            select: { hubId: true },
        });
        if (!manifestCheck) {
            throw new AppError('Manifest not found', 404);
        }
        if (req.user!.roles.includes('HUB') && manifestCheck.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }

        const admin = await prisma.admin.findUnique({ where: { userId: req.user!.id } });
        const actor = {
            userId: req.user!.id,
            role: req.user!.roles[0],
            adminId: admin?.id,
        };
        const { manifest, utilization } = await addOrderToManifest(id, targetOrderId, actor);

        res.json({
            success: true,
            data: mapManifestLegsToDemands(manifest),
            utilization,
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/manifests/:id/demands/:demandId - Remove order from manifest
router.delete('/:id/demands/:demandId', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const demandId = req.params.demandId as string;

        const targetOrderId = (await prisma.order.findUnique({ where: { demandId } }))?.id;
        if (!targetOrderId) {
            throw new AppError('Order not found for this demand', 404);
        }

        const manifestCheck = await prisma.manifest.findUnique({
            where: { id },
            select: { hubId: true },
        });
        if (!manifestCheck) {
            throw new AppError('Manifest not found', 404);
        }

        const admin = await prisma.admin.findUnique({ where: { userId: req.user!.id } });
        const actor = {
            userId: req.user!.id,
            role: req.user!.roles[0],
            adminId: admin?.id,
        };
        await removeOrderFromManifest(id, targetOrderId, actor);

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
                legs: {
                    include: {
                        order: {
                            include: {
                                demand: true
                            }
                        }
                    }
                },
            }
        });

        // TODO: Send WhatsApp notification to link

        res.json({
            success: true,
            data: mapManifestLegsToDemands(manifest),
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

        await startManifest(id);

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

        const admin = await prisma.admin.findUnique({ where: { userId: req.user!.id } });
        const actor = {
            userId: req.user!.id,
            role: req.user!.roles[0],
            adminId: admin?.id,
        };
        await completeManifest(id, actor);

        res.json({
            success: true,
            message: 'Manifest completed',
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/manifests/:id/emit-mdfe — MDF-e (ACBr) para viagem com CT-es autorizados
router.post('/:id/emit-mdfe', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        if (!isAcbrCredentialsConfigured()) {
            throw new AppError('MDF-e via ACBr requer ACBR_CLIENT_ID e ACBR_CLIENT_SECRET.', 503);
        }

        const manifest = await prisma.manifest.findUnique({ where: { id }, include: { hub: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && req.user!.hubId && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized', 403);
        }

        const dup = await prisma.manifestFiscalDocument.findFirst({
            where: { manifestId: id, documentType: 'MDFE', status: { in: ['AUTHORIZED', 'SENT', 'READY'] } },
        });
        if (dup) throw new AppError('MDF-e já existe ou está em processamento para este manifesto.', 409);

        const result = await emitMdfeViaAcbr(id, id);
        if (!result.ok) {
            await prisma.manifestFiscalDocument.create({
                data: {
                    manifestId: id,
                    documentType: 'MDFE',
                    status: 'REJECTED',
                    statusReason: result.error ?? 'Falha MDF-e',
                    rawResponse: (result.raw ?? { error: result.error }) as object,
                    rejectedAt: new Date(),
                },
            });
            throw new AppError(result.error ?? 'Falha ao emitir MDF-e', 400);
        }

        const doc = await prisma.manifestFiscalDocument.create({
            data: {
                manifestId: id,
                documentType: 'MDFE',
                status: 'AUTHORIZED',
                accessKey: result.accessKey,
                protocol: result.protocol,
                xmlUrl: null,
                pdfUrl: result.apiId ? `mdfe:${result.apiId}` : null,
                rawResponse: (result.raw ?? {}) as object,
                authorizedAt: new Date(),
            },
        });

        res.json({ success: true, data: doc, mdfe: result });
    } catch (error) {
        next(error);
    }
});

// POST /api/manifests/:id/ciot-placeholder — registro CIOT (planejado)
router.post('/:id/ciot-placeholder', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const manifest = await prisma.manifest.findUnique({ where: { id }, include: { hub: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && req.user!.hubId && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized', 403);
        }

        const info = buildCiotPlaceholder(id);
        const doc = await prisma.manifestFiscalDocument.create({
            data: {
                manifestId: id,
                documentType: 'CIOT',
                status: 'DRAFT',
                statusReason: info.message,
                rawPayload: info as object,
            },
        });
        res.status(202).json({ success: true, data: doc, ciot: info });
    } catch (error) {
        next(error);
    }
});

export { router as manifestsRouter };
