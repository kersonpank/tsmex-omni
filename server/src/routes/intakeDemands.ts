import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
    createIntakeDemand,
    createIntakeDemandFromNfeKey,
} from '../services/intake/createIntakeDemand.js';
import { INTAKE_SOURCE_TYPES, isIntakeSource } from '../services/intake/intakeDemandPolicy.js';

const router = Router();

router.use(authenticate, authorize('ADMIN', 'HUB'));

const declarationDataSchema = z
    .object({
        description: z.string().min(1).optional(),
        remetenteName: z.string().optional(),
        destinatarioName: z.string().optional(),
        value: z.number().positive().optional(),
    })
    .passthrough();

const createIntakeSchema = z.object({
    sourceType: z.enum(['MANUAL_HUB', 'DECLARATION']),
    clientId: z.string().uuid(),
    expectedHubId: z.string().uuid().optional(),
    externalReference: z.string().optional(),
    documentType: z
        .enum(['NFE', 'DECLARATION', 'CTE', 'MANUAL_REFERENCE', 'NO_DOCUMENT_YET'])
        .optional(),
    documentKey: z.string().optional(),
    nfNumber: z.string().min(1).optional(),
    nfValue: z.number().nonnegative().optional(),
    origin: z.string().min(1).optional(),
    destination: z.string().min(1).optional(),
    commodity: z.string().min(1).optional(),
    weight: z.number().positive().optional(),
    volume: z.number().positive().optional(),
    units: z.number().int().positive().optional(),
    riskClass: z.enum(['A', 'B', 'C']).optional(),
    intentType: z.enum(['QUOTE_ONLY', 'COLLECT', 'DROP_AT_HUB']).optional(),
    declarationData: declarationDataSchema.optional(),
    rawInputData: z.record(z.unknown()).optional(),
});

const fromNfeKeySchema = z.object({
    chave: z.string().min(1),
    clientId: z.string().uuid(),
    expectedHubId: z.string().uuid().optional(),
    rawInputData: z.record(z.unknown()).optional(),
});

function resolveExpectedHubId(req: AuthRequest, bodyHubId?: string): string | null {
    if (req.user!.roles.includes('HUB')) {
        if (!req.user!.hubId) {
            throw new AppError('Hub user has no hub assigned', 403);
        }
        if (bodyHubId && bodyHubId !== req.user!.hubId) {
            throw new AppError('Hub user cannot assign another hub', 403);
        }
        return req.user!.hubId;
    }
    return bodyHubId ?? null;
}

function intakeListWhere(req: AuthRequest, query: { expectedHubId?: string; status?: string }) {
    const status = query.status ?? 'AWAITING_ARRIVAL';
    const where: Record<string, unknown> = {
        status,
        sourceType: { in: INTAKE_SOURCE_TYPES },
    };

    if (req.user!.roles.includes('HUB')) {
        if (!req.user!.hubId) {
            throw new AppError('Hub user has no hub assigned', 403);
        }
        where.expectedHubId = req.user!.hubId;
    } else if (query.expectedHubId) {
        where.expectedHubId = query.expectedHubId;
    }

    return where;
}

async function assertCanViewIntakeDemand(req: AuthRequest, demandId: string) {
    const demand = await prisma.demand.findUnique({
        where: { id: demandId },
        include: { order: true, client: { select: { companyName: true } }, events: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!demand) throw new AppError('Demand not found', 404);
    if (!isIntakeSource(demand.sourceType)) {
        throw new AppError('Not an intake demand', 404);
    }
    if (req.user!.roles.includes('HUB')) {
        if (!req.user!.hubId || demand.expectedHubId !== req.user!.hubId) {
            throw new AppError('Not authorized', 403);
        }
    }
    return demand;
}

// POST /api/intake/demands
router.post('/demands', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = createIntakeSchema.parse(req.body);
        const expectedHubId = resolveExpectedHubId(req, data.expectedHubId);

        const documentType =
            data.documentType ??
            (data.sourceType === 'DECLARATION' ? 'DECLARATION' : 'NO_DOCUMENT_YET');

        const demand = await createIntakeDemand({
            sourceType: data.sourceType,
            clientId: data.clientId,
            expectedHubId,
            externalReference: data.externalReference,
            documentType,
            documentKey: data.documentKey,
            nfNumber: data.nfNumber,
            nfValue: data.nfValue,
            origin: data.origin,
            destination: data.destination,
            commodity: data.commodity,
            weight: data.weight,
            volume: data.volume,
            units: data.units,
            riskClass: data.riskClass,
            intentType: data.intentType,
            declarationData: data.declarationData as Prisma.InputJsonValue | undefined,
            rawInputData: data.rawInputData as Prisma.InputJsonValue | undefined,
        });

        res.status(201).json({ success: true, data: demand });
    } catch (e) {
        if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
        if (e instanceof Error && e.message.includes('Chave NF-e')) {
            return next(new AppError(e.message, 400));
        }
        next(e);
    }
});

// POST /api/intake/demands/from-nfe-key
router.post('/demands/from-nfe-key', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = fromNfeKeySchema.parse(req.body);
        const expectedHubId = resolveExpectedHubId(req, data.expectedHubId);

        const { demand, lookup } = await createIntakeDemandFromNfeKey({
            chave: data.chave,
            clientId: data.clientId,
            expectedHubId,
            rawInputData: data.rawInputData as Prisma.InputJsonValue | undefined,
        });

        res.status(201).json({ success: true, data: demand, lookup });
    } catch (e) {
        if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
        if (e instanceof Error && e.message.includes('Chave NF-e')) {
            return next(new AppError(e.message, 400));
        }
        next(e);
    }
});

// GET /api/intake/demands
router.get('/demands', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { expectedHubId, status, limit = '50', offset = '0' } = req.query;
        const where = intakeListWhere(req, {
            expectedHubId: expectedHubId as string | undefined,
            status: status as string | undefined,
        });

        const [demands, total] = await Promise.all([
            prisma.demand.findMany({
                where,
                include: {
                    client: { select: { companyName: true } },
                    order: { select: { id: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: parseInt(limit as string, 10),
                skip: parseInt(offset as string, 10),
            }),
            prisma.demand.count({ where }),
        ]);

        res.json({
            success: true,
            data: demands,
            pagination: {
                total,
                limit: parseInt(limit as string, 10),
                offset: parseInt(offset as string, 10),
            },
        });
    } catch (e) {
        next(e);
    }
});

// GET /api/intake/demands/:id
router.get('/demands/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const demand = await assertCanViewIntakeDemand(req, id);
        res.json({ success: true, data: demand });
    } catch (e) {
        next(e);
    }
});

export { router as intakeDemandsRouter };
