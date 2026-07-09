import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { DemandStatus, Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
    createIntakeDemand,
    createIntakeDemandFromNfeKey,
} from '../services/intake/createIntakeDemand.js';
import { confirmIntakeArrival } from '../services/intake/confirmIntakeArrival.js';
import { buildIntakeDemandSearchWhere } from '../services/intake/intakeListQuery.js';
import { extractChaveFromInput } from '../lib/nfeChaveIntake.js';
import { INTAKE_SOURCE_TYPES, isIntakeSource } from '../services/intake/intakeDemandPolicy.js';
import { resolveIntakeByNfeKey } from '../services/intake/resolveIntakeByNfeKey.js';
import { resolveIntakeClientByDocument } from '../services/intake/resolveIntakeClientByDocument.js';
import {
    getCargoDataFromDistribuicaoDocument,
    defaultGetCargoDataDeps,
    type GetCargoDataDeps,
} from '../services/fiscal/nfeDistribuicaoCargoData.js';
import type { ParsedNfeCargo } from '../services/acbr/nfeXmlParser.js';

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

const lookupByKeySchema = z.object({
    chave: z.string().min(8),
});

const resolveByKeySchema = z.object({
    chave: z.string().min(1),
});

const resolveClientSchema = z.object({
    document: z.string().min(1),
});

const confirmArrivalSchema = z.object({
    destinatarioPersonId: z.string().uuid(),
    remetentePersonId: z.string().uuid().optional(),
    freightTerm: z.enum(['CIF', 'FOB', 'REDESPACHO']).optional(),
});

/**
 * Se a chave bipada já tiver sido descoberta pelo pipeline de Distribuição NF-e (ACBr) e o XML
 * completo já baixado, reaproveita os dados reais de carga em vez de forçar preenchimento manual.
 * Falha ao ler/parsear o XML não deve bloquear a criação da Demand — degrada pro comportamento
 * de placeholder atual (operador preenche manualmente, como sempre foi).
 */
export async function findCargoDataForChave(
    chave: string,
    cargoDeps: GetCargoDataDeps = defaultGetCargoDataDeps,
): Promise<ParsedNfeCargo | undefined> {
    const digits = extractChaveFromInput(chave);
    if (digits.length !== 44) return undefined;

    const doc = await prisma.nfeDistribuicaoDocumento.findUnique({
        where: { accessKey: digits },
        select: { tipo: true, xmlStorageKey: true },
    });
    if (!doc) return undefined;

    try {
        const cargo = await getCargoDataFromDistribuicaoDocument(doc, cargoDeps);
        return cargo ?? undefined;
    } catch (err) {
        console.warn(`[intake] Falha ao ler XML da Distribuição NF-e pra chave ${digits}:`, err);
        return undefined;
    }
}

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

function requireResolvedHubId(expectedHubId: string | null): string {
    if (!expectedHubId) {
        throw new AppError('Informe o hub de recebimento esperado (expectedHubId).', 400);
    }
    return expectedHubId;
}

function buildIntakeListWhere(
    req: AuthRequest,
    query: {
        expectedHubId?: string;
        status?: string;
        q?: string;
        onlyUnassignedHub?: string;
    },
): Prisma.DemandWhereInput {
    const status = (query.status ?? 'AWAITING_ARRIVAL') as DemandStatus;
    const parts: Prisma.DemandWhereInput[] = [
        { status },
        { sourceType: { in: INTAKE_SOURCE_TYPES } },
    ];

    if (req.user!.roles.includes('HUB')) {
        if (!req.user!.hubId) {
            throw new AppError('Hub user has no hub assigned', 403);
        }
        parts.push({ expectedHubId: req.user!.hubId });
    } else {
        const onlyUn =
            query.onlyUnassignedHub === '1' ||
            query.onlyUnassignedHub === 'true';
        if (onlyUn) {
            parts.push({ expectedHubId: null });
        } else if (query.expectedHubId) {
            parts.push({ expectedHubId: query.expectedHubId });
        }
    }

    const search = buildIntakeDemandSearchWhere(query.q);
    if (search && Object.keys(search).length > 0) {
        parts.push(search);
    }

    return { AND: parts };
}

function buildLookupWhere(req: AuthRequest, chave: string): Prisma.DemandWhereInput {
    const digits = extractChaveFromInput(chave).replace(/\D/g, '');
    const keyClause: Prisma.DemandWhereInput =
        digits.length === 44
            ? { documentKey: digits }
            : {
                  documentKey: {
                      contains: digits.length >= 8 ? digits : chave.trim(),
                      mode: 'insensitive',
                  },
              };

    const parts: Prisma.DemandWhereInput[] = [
        { status: 'AWAITING_ARRIVAL' },
        { sourceType: { in: INTAKE_SOURCE_TYPES } },
        { order: { is: null } },
        keyClause,
    ];

    if (req.user!.roles.includes('HUB')) {
        if (!req.user!.hubId) {
            throw new AppError('Hub user has no hub assigned', 403);
        }
        parts.push({ expectedHubId: req.user!.hubId });
    }

    return { AND: parts };
}

async function assertCanViewIntakeDemand(req: AuthRequest, demandId: string) {
    const demand = await prisma.demand.findUnique({
        where: { id: demandId },
        include: {
            order: true,
            client: { select: { companyName: true, document: true, personId: true } },
            events: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
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

// POST /api/intake/demands/resolve-by-key
router.post('/demands/resolve-by-key', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { chave } = resolveByKeySchema.parse(req.body);
        const data = await resolveIntakeByNfeKey({
            chave,
            actingRoles: req.user!.roles,
            actingHubId: req.user!.hubId,
        });
        res.json({ success: true, data });
    } catch (e) {
        if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
        next(e);
    }
});

// POST /api/intake/demands/resolve-client-by-document
router.post(
    '/demands/resolve-client-by-document',
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const { document } = resolveClientSchema.parse(req.body);
            const data = await resolveIntakeClientByDocument(document);
            res.json({ success: true, data });
        } catch (e) {
            if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
            next(e);
        }
    },
);

// POST /api/intake/demands/lookup-by-key
router.post('/demands/lookup-by-key', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { chave } = lookupByKeySchema.parse(req.body);
        const where = buildLookupWhere(req, chave);
        const matches = await prisma.demand.findMany({
            where,
            include: {
                client: { select: { companyName: true, document: true } },
                order: { select: { id: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });
        res.json({ success: true, data: { matches } });
    } catch (e) {
        if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
        next(e);
    }
});

// POST /api/intake/demands/:id/confirm-arrival
router.post(
    '/demands/:id/confirm-arrival',
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const id = req.params.id as string;
            const body = confirmArrivalSchema.parse(req.body);
            const result = await confirmIntakeArrival({
                demandId: id,
                actingRoles: req.user!.roles,
                actingHubId: req.user!.hubId,
                remetentePersonId: body.remetentePersonId,
                destinatarioPersonId: body.destinatarioPersonId,
                freightTerm: body.freightTerm,
            });
            const fullOrder = await prisma.order.findUnique({
                where: { id: result.order.id },
                include: {
                    demand: { include: { client: { select: { id: true, companyName: true } } } },
                    currentHub: { select: { id: true, name: true, code: true } },
                },
            });
            res.status(201).json({
                success: true,
                data: { demand: result.demand, order: fullOrder },
            });
        } catch (e) {
            if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
            next(e);
        }
    },
);

// POST /api/intake/demands
router.post('/demands', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = createIntakeSchema.parse(req.body);
        const expectedHubId = requireResolvedHubId(resolveExpectedHubId(req, data.expectedHubId));

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
        if (e instanceof AppError) return next(e);
        next(e);
    }
});

// POST /api/intake/demands/from-nfe-key
router.post('/demands/from-nfe-key', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = fromNfeKeySchema.parse(req.body);
        const expectedHubId = requireResolvedHubId(resolveExpectedHubId(req, data.expectedHubId));
        const cargoData = await findCargoDataForChave(data.chave);

        const { demand, lookup } = await createIntakeDemandFromNfeKey({
            chave: data.chave,
            clientId: data.clientId,
            expectedHubId,
            rawInputData: data.rawInputData as Prisma.InputJsonValue | undefined,
            cargoData,
        });

        res.status(201).json({ success: true, data: demand, lookup });
    } catch (e) {
        if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
        if (e instanceof Error && e.message.includes('Chave NF-e')) {
            return next(new AppError(e.message, 400));
        }
        if (e instanceof AppError) return next(e);
        next(e);
    }
});

// GET /api/intake/demands
router.get('/demands', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { expectedHubId, status, q, onlyUnassignedHub, limit = '50', offset = '0' } = req.query;
        if (
            (onlyUnassignedHub === '1' || onlyUnassignedHub === 'true') &&
            req.user!.roles.includes('HUB')
        ) {
            throw new AppError('Not authorized', 403);
        }

        const where = buildIntakeListWhere(req, {
            expectedHubId: expectedHubId as string | undefined,
            status: status as string | undefined,
            q: q as string | undefined,
            onlyUnassignedHub: onlyUnassignedHub as string | undefined,
        });

        const [demands, total] = await Promise.all([
            prisma.demand.findMany({
                where,
                include: {
                    client: { select: { companyName: true, document: true } },
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
