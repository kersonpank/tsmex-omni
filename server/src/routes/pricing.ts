import { Router, Response, NextFunction } from 'express';
import { IcmsUnit, type Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { applyIcms, ICMS_DIVISOR_MESSAGE, isValidIcmsDivisor } from '../services/freight/freightPricing.js';
import { assertClientPricingAccess, pricingVisibilityWhere } from '../services/pricingVisibility.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Validation schemas
const pricingRouteSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    originCode: z.string().min(1, 'Origin code is required'),
    originName: z.string().min(1, 'Origin name is required'),
    destCode: z.string().min(1, 'Destination code is required'),
    destName: z.string().min(1, 'Destination name is required'),
});

const minFreightRangeSchema = z.object({
    minWeight: z.number().min(0),
    maxWeight: z.number().optional(),
    value: z.number().positive(),
});

const pricingIcmsFields = z.object({
    icmsUnit: z.nativeEnum(IcmsUnit).default(IcmsUnit.PERCENT),
    icmsPercent: z.number().nullable().optional(),
});

const pricingIcmsSchema = pricingIcmsFields.superRefine(({ icmsUnit, icmsPercent }, ctx) => {
    let message: string | undefined;
    if (icmsUnit === IcmsUnit.DIVISOR && !isValidIcmsDivisor(icmsPercent)) {
        message = ICMS_DIVISOR_MESSAGE;
    } else if (icmsPercent != null && !Number.isFinite(icmsPercent)) {
        message = 'O valor do ICMS deve ser finito.';
    } else if (icmsPercent != null && icmsPercent < 0) {
        message = 'O valor do ICMS não pode ser negativo.';
    }
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['icmsPercent'], message });
});

const pricingTableSchema = z.object({
    description: z.string().min(1, 'Description is required'),
    code: z.string().optional(),
    type: z.enum(['SPECIAL', 'GENERAL']),
    coverageOnly: z.boolean().default(false),
    // IDs legados do seed não são UUID (ex.: "route-sp-ma"); a existência é garantida pela FK.
    clientId: z.string().min(1).nullable().optional(),
    accountId: z.string().min(1).nullable().optional(),
    routeId: z.string().min(1).nullable().optional(),

    // Freight
    freightValue: z.number().optional(),
    freightUnit: z.enum(['RS_KG', 'PERCENT', 'RS_M3', 'RS_UNIT']),

    // Minimum freight
    minFreightValue: z.number().optional(),
    minFreightUnit: z.enum(['RS', 'KG']).optional(),

    // Additional fees
    adValoremPercent: z.number().optional(),
    grisPercent: z.number().optional(),
    tollValue: z.number().optional(),
    tollUnit: z.enum(['RS_KG', 'FIXED']).optional(),
    dispatchFee: z.number().optional(),
    otherFees: z.number().optional(),

    // Cubing
    cubeEnabled: z.boolean().default(false),
    cubeFactor: z.number().optional(),

    // ICMS
    icmsIncluded: z.boolean().default(false),

    // Threshold
    adValoremThreshold: z.number().optional(),

    // Ranges
    minFreightRanges: z.array(minFreightRangeSchema).optional(),

    priority: z.number().int().default(0),
    active: z.boolean().default(true),
}).merge(pricingIcmsFields);

// ==================== ROUTES ====================

// GET /api/pricing/routes - List pricing routes
router.get('/routes', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const routes = await prisma.pricingRoute.findMany({
            where: includeInactive ? {} : { active: true },
            include: {
                _count: { select: { tables: true } }
            },
            orderBy: { name: 'asc' },
        });

        res.json({
            success: true,
            data: routes,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/pricing/routes/:id - Get single route (for editing)
router.get('/routes/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const route = await prisma.pricingRoute.findUnique({
            where: { id },
            include: { _count: { select: { tables: true } } },
        });
        if (!route) {
            throw new AppError('Route not found', 404);
        }
        res.json({ success: true, data: route });
    } catch (error) {
        next(error);
    }
});

// POST /api/pricing/routes - Create route (Admin only)
router.post('/routes', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = pricingRouteSchema.parse(req.body);

        const route = await prisma.pricingRoute.create({
            data,
        });

        res.status(201).json({
            success: true,
            data: route,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/pricing/routes/:id - Update route (Admin only)
router.patch('/routes/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const data = pricingRouteSchema.partial().parse(req.body);
        const route = await prisma.pricingRoute.findUnique({ where: { id } });
        if (!route) {
            throw new AppError('Route not found', 404);
        }
        const updated = await prisma.pricingRoute.update({
            where: { id },
            data,
        });
        res.json({ success: true, data: updated });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/pricing/routes/:id - Soft delete route (Admin only)
router.delete('/routes/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const route = await prisma.pricingRoute.findUnique({ where: { id } });
        if (!route) {
            throw new AppError('Route not found', 404);
        }
        await prisma.pricingRoute.update({
            where: { id },
            data: { active: false },
        });
        res.json({ success: true, message: 'Route deactivated' });
    } catch (error) {
        next(error);
    }
});

// ==================== TABLES ====================

// GET /api/pricing/tables - List pricing tables
router.get('/tables', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { type, clientId, routeId, active, coverageOnly } = req.query;
        const visibility = await pricingVisibilityWhere(req.user!);

        const tables = await prisma.pricingTable.findMany({
            where: {
                AND: [visibility],
                ...(type ? { type: type as any } : {}),
                ...(clientId ? { clientId: clientId as string } : {}),
                ...(routeId ? { routeId: routeId as string } : {}),
                ...(active !== undefined ? { active: active === 'true' } : {}),
                ...(coverageOnly !== undefined ? { coverageOnly: coverageOnly === 'true' } : {}),
            },
            include: {
                client: {
                    select: { companyName: true }
                },
                route: true,
                minFreightRanges: {
                    orderBy: { minWeight: 'asc' }
                },
            },
            orderBy: [
                { priority: 'desc' },
                { description: 'asc' },
            ],
        });

        res.json({
            success: true,
            data: tables,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/pricing/tables/:id
router.get('/tables/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const visibility = await pricingVisibilityWhere(req.user!);
        const table = await prisma.pricingTable.findFirst({
            where: { id, AND: [visibility] },
            include: {
                client: true,
                route: true,
                minFreightRanges: {
                    orderBy: { minWeight: 'asc' }
                },
            }
        });

        if (!table) {
            throw new AppError('Pricing table not found', 404);
        }

        res.json({
            success: true,
            data: table,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/pricing/tables - Create pricing table (Admin only)
router.post('/tables', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { minFreightRanges, ...data } = pricingTableSchema.parse(req.body);
        pricingIcmsSchema.parse(data);
        if (data.type !== 'GENERAL') data.coverageOnly = false;

        const table = await prisma.pricingTable.create({
            data: {
                ...data,
                minFreightRanges: minFreightRanges ? {
                    create: minFreightRanges,
                } : undefined,
            },
            include: {
                minFreightRanges: true,
            }
        });

        res.status(201).json({
            success: true,
            data: table,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/pricing/tables/:id - Update pricing table
router.patch('/tables/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { minFreightRanges, ...data } = pricingTableSchema.partial().parse(req.body);
        if (data.type === 'SPECIAL') data.coverageOnly = false;

        const hasIcmsUnit = data.icmsUnit !== undefined;
        const hasIcmsValue = data.icmsPercent !== undefined;
        const needsCurrentIcms = hasIcmsUnit !== hasIcmsValue;
        const update = async (db: Prisma.TransactionClient) => {
            if (needsCurrentIcms) {
                const current = await db.pricingTable.findUnique({
                    where: { id },
                    select: { icmsUnit: true, icmsPercent: true },
                });
                if (!current) throw new AppError('Tabela de preços não encontrada.', 404);
                pricingIcmsSchema.parse({
                    icmsUnit: data.icmsUnit ?? current.icmsUnit,
                    icmsPercent: data.icmsPercent === undefined ? current.icmsPercent : data.icmsPercent,
                });
            } else if (hasIcmsUnit) {
                pricingIcmsSchema.parse(data);
            }

            if (minFreightRanges) {
                await db.minFreightRange.deleteMany({ where: { pricingTableId: id } });
            }

            return db.pricingTable.update({
                where: { id },
                data: {
                    ...data,
                    minFreightRanges: minFreightRanges ? { create: minFreightRanges } : undefined,
                },
                include: { minFreightRanges: true },
            });
        };

        const table = needsCurrentIcms || minFreightRanges
            ? await prisma.$transaction(update, { isolationLevel: 'Serializable' })
            : await update(prisma);

        res.json({
            success: true,
            data: table,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        if ((error as { code?: string })?.code === 'P2034') {
            return next(new AppError('A tabela de preços foi alterada durante o salvamento. Tente novamente.', 409));
        }
        next(error);
    }
});

// DELETE /api/pricing/tables/:id - Soft delete
router.delete('/tables/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        await prisma.pricingTable.update({
            where: { id: id },
            data: { active: false },
        });

        res.json({
            success: true,
            message: 'Pricing table deactivated',
        });
    } catch (error) {
        next(error);
    }
});

// ==================== CALCULATE ====================

interface PricingInput {
    weight: number;
    volume: number;
    nfValue: number;
    units: number;
    clientId?: string;
    originCode?: string;
    destCode?: string;
}

interface PricingOutput {
    baseFreight: number;
    cubedWeight: number;
    effectiveWeight: number;
    minFreightApplied: boolean;
    minFreightValue: number;
    adValorem: number;
    gris: number;
    toll: number;
    dispatch: number;
    others: number;
    subtotal: number;
    icms: number;
    total: number;
    appliedTableId: string;
    appliedTableDesc: string;
    breakdown: { label: string; value: number }[];
}

// POST /api/pricing/calculate - Calculate price for given parameters
router.post('/calculate', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { weight, volume, nfValue, units = 1, clientId, originCode, destCode } = req.body as PricingInput;
        if (clientId) await assertClientPricingAccess(req.user!, clientId);
        const visibility = await pricingVisibilityWhere(req.user!, { includeGeneralForCalculation: true });

        if (!weight || !volume || !nfValue) {
            throw new AppError('Weight, volume, and NF value are required', 400);
        }

        // Find applicable pricing table using priority hierarchy
        // 1. Client SPECIAL + Route
        // 2. Client SPECIAL (no route)
        // 3. GENERAL + Route
        // 4. GENERAL (no route)

        let table = null;

        if (clientId && originCode && destCode) {
            // Try client-specific with route
            const route = await prisma.pricingRoute.findFirst({
                where: {
                    originCode,
                    destCode,
                    active: true,
                }
            });

            if (route) {
                table = await prisma.pricingTable.findFirst({
                    where: {
                        AND: [visibility],
                        clientId,
                        routeId: route.id,
                        type: 'SPECIAL',
                        active: true,
                    },
                    include: { minFreightRanges: true },
                    orderBy: { priority: 'desc' },
                });
            }
        }

        if (!table && clientId) {
            // Try client-specific without route
            table = await prisma.pricingTable.findFirst({
                where: {
                    AND: [visibility],
                    clientId,
                    routeId: null,
                    type: 'SPECIAL',
                    active: true,
                },
                include: { minFreightRanges: true },
                orderBy: { priority: 'desc' },
            });
        }

        if (!table && originCode && destCode) {
            // Try general with route
            const route = await prisma.pricingRoute.findFirst({
                where: {
                    originCode,
                    destCode,
                    active: true,
                }
            });

            if (route) {
                table = await prisma.pricingTable.findFirst({
                    where: {
                        AND: [visibility],
                        routeId: route.id,
                        type: 'GENERAL',
                        coverageOnly: false,
                        clientId: null,
                        active: true,
                    },
                    include: { minFreightRanges: true },
                    orderBy: { priority: 'desc' },
                });
            }
        }

        if (!table) {
            // Try general without route (default)
            table = await prisma.pricingTable.findFirst({
                where: {
                    AND: [visibility],
                    routeId: null,
                    type: 'GENERAL',
                    coverageOnly: false,
                    clientId: null,
                    active: true,
                },
                include: { minFreightRanges: true },
                orderBy: { priority: 'desc' },
            });
        }

        if (!table) {
            throw new AppError('No applicable pricing table found', 404);
        }

        // Calculate
        const cubeFactor = table.cubeFactor || 300;
        const cubedWeight = volume * cubeFactor;
        const effectiveWeight = Math.max(weight, cubedWeight);

        // Base freight
        let baseFreight = 0;
        switch (table.freightUnit) {
            case 'RS_KG':
                baseFreight = effectiveWeight * (table.freightValue || 0);
                break;
            case 'RS_M3':
                baseFreight = volume * (table.freightValue || 0);
                break;
            case 'RS_UNIT':
                baseFreight = units * (table.freightValue || 0);
                break;
            case 'PERCENT':
                baseFreight = nfValue * (table.freightValue || 0) / 100;
                break;
        }

        // Minimum freight from ranges
        let minFreightApplied = false;
        let minFreightValue = table.minFreightValue || 0;

        if (table.minFreightRanges && table.minFreightRanges.length > 0) {
            const applicableRange = table.minFreightRanges.find(
                r => effectiveWeight >= r.minWeight &&
                    (r.maxWeight === null || effectiveWeight <= r.maxWeight)
            );
            if (applicableRange && applicableRange.value > baseFreight) {
                minFreightValue = applicableRange.value;
                minFreightApplied = true;
                baseFreight = minFreightValue;
            }
        } else if (minFreightValue > baseFreight) {
            minFreightApplied = true;
            baseFreight = minFreightValue;
        }

        // Ad valorem (per R$ 1000)
        const adValorem = (table.adValoremPercent || 0) * (nfValue / 1000);

        // GRIS (per R$ 1000)
        const gris = (table.grisPercent || 0) * (nfValue / 1000);

        // Toll
        let toll = 0;
        if (table.tollUnit === 'RS_KG') {
            toll = effectiveWeight * (table.tollValue || 0);
        } else if (table.tollUnit === 'FIXED') {
            toll = table.tollValue || 0;
        }

        // Other fees
        const dispatch = table.dispatchFee || 0;
        const others = table.otherFees || 0;

        // Subtotal
        const subtotal = baseFreight + adValorem + gris + toll + dispatch + others;

        // ICMS
        const { icms, total } = applyIcms(subtotal, table);

        const result: PricingOutput = {
            baseFreight,
            cubedWeight,
            effectiveWeight,
            minFreightApplied,
            minFreightValue,
            adValorem,
            gris,
            toll,
            dispatch,
            others,
            subtotal,
            icms,
            total,
            appliedTableId: table.id,
            appliedTableDesc: table.description,
            breakdown: [
                { label: 'Frete Base', value: baseFreight },
                { label: 'Ad Valorem', value: adValorem },
                { label: 'GRIS', value: gris },
                { label: 'Pedágio', value: toll },
                { label: 'Despacho', value: dispatch },
                { label: 'Outros', value: others },
                { label: 'ICMS', value: icms },
            ].filter(b => b.value > 0),
        };

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
});

export { router as pricingRouter };
