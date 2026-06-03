import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { freightCalculationsRouter } from './freightCalculations.js';
import {
    suggestFiscalDocType,
    collectionDataHasDeclaracao,
    orderEligibleForCteFreight,
    orderEligibleForDceFreight,
    getFiscalDocModeForFreight,
} from '../services/fiscal/fiscalDocPolicy.js';
import {
    deleteObjectByKey,
    getObjectDownloadUrl,
    inferAttachmentType,
    uploadBase64Object,
} from '../lib/objectStorage.js';
import {
    buildHubOrderVisibilityWhere,
    checkHubAccessIfHubRole,
    ensureHubOrderAccessById,
    hubOrderAccessSelect,
    shouldApplyLinkOrderScope,
} from '../lib/hubOrderAccess.js';
import { parseOrderStatusWhereInput } from '../lib/orderStatusFilter.js';

const router = Router();

router.use('/:orderId/freight-calculations', freightCalculationsRouter);

router.get('/:orderId/fiscal-doc-suggestion', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { invoicesRel: true },
        });
        if (!order) throw new AppError('Order not found', 404);
        checkHubAccessIfHubRole(req, order);
        const hint = suggestFiscalDocType(order);
        const mode = getFiscalDocModeForFreight(order);
        res.json({
            success: true,
            data: {
                ...hint,
                allowedFreightDocType: mode.allowed,
                blockingReason: mode.allowed === null ? mode.reason : undefined,
                hasNfeKey: orderEligibleForCteFreight(order),
                hasOutrasDeclaration: orderEligibleForDceFreight(order),
                hasCollectionDeclaration: collectionDataHasDeclaracao(order.collectionData),
            },
        });
    } catch (e) {
        next(e);
    }
});

const orderAttachmentCreateSchema = z.object({
    file: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    category: z.string().max(80).optional(),
});

// ==================== GET ORDERS ====================

// GET /api/orders - List orders
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const {
            status,
            statuses,
            accountId,
            limit = '50',
            offset = '0',
            hubId,
            originState,
            originCity,
            destinationState,
            destinationCity,
            senderState,
            senderCity,
            recipientState,
            recipientCity,
            q,
            collectionStatus,
            hasCollectionData,
            demandStatus,
            sortBy = 'updatedAt',
            sortDir = 'desc',
        } = req.query;

        const where: Prisma.OrderWhereInput = {};
        const andFilters: Prisma.OrderWhereInput[] = [];
        const parsedLimit = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 200);
        const parsedOffset = Math.max(parseInt(offset as string, 10) || 0, 0);

        const collectionDataPresent: Prisma.OrderWhereInput = { NOT: { collectionData: { equals: Prisma.AnyNull } } };
        const collectionDataMissing: Prisma.OrderWhereInput = { collectionData: { equals: Prisma.AnyNull } };

        if (status) {
            where.status = status as any;
        }

        if (hubId && !req.user!.roles.includes('HUB')) {
            where.currentHubId = hubId as string;
        }

        if (originCity) {
            andFilters.push({
                OR: [
                    { demand: { origin: { contains: String(originCity), mode: 'insensitive' } } },
                    { origemPrestacao: { contains: String(originCity), mode: 'insensitive' } },
                ],
            });
        }

        if (originState) {
            andFilters.push({
                OR: [
                    { demand: { origin: { contains: String(originState), mode: 'insensitive' } } },
                    { origemPrestacao: { contains: String(originState), mode: 'insensitive' } },
                ],
            });
        }

        if (destinationCity) {
            andFilters.push({
                OR: [
                    { demand: { destination: { contains: String(destinationCity), mode: 'insensitive' } } },
                    { fimPrestacao: { contains: String(destinationCity), mode: 'insensitive' } },
                ],
            });
        }

        if (destinationState) {
            andFilters.push({
                OR: [
                    { demand: { destination: { contains: String(destinationState), mode: 'insensitive' } } },
                    { fimPrestacao: { contains: String(destinationState), mode: 'insensitive' } },
                ],
            });
        }

        if (senderCity) {
            andFilters.push({
                remetentePerson: { city: { contains: String(senderCity), mode: 'insensitive' } },
            });
        }

        if (senderState) {
            andFilters.push({
                remetentePerson: { state: { equals: String(senderState).toUpperCase(), mode: 'insensitive' } },
            });
        }

        if (recipientCity) {
            andFilters.push({
                destinatarioPerson: { city: { contains: String(recipientCity), mode: 'insensitive' } },
            });
        }

        if (recipientState) {
            andFilters.push({
                destinatarioPerson: { state: { equals: String(recipientState).toUpperCase(), mode: 'insensitive' } },
            });
        }

        if (typeof hasCollectionData === 'string') {
            const hasData = hasCollectionData === 'true';
            andFilters.push(hasData ? collectionDataPresent : collectionDataMissing);
        }

        if (demandStatus) {
            andFilters.push({ demand: { status: String(demandStatus) as any } });
        }

        if (collectionStatus) {
            const cs = String(collectionStatus).toUpperCase();
            if (cs === 'COLLECTED') {
                andFilters.push({ status: { in: ['IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'] } });
            } else if (cs === 'NOT_COLLECTED') {
                andFilters.push({ status: 'PENDING' });
            } else if (cs === 'WITH_COLLECTION_DATA') {
                andFilters.push(collectionDataPresent);
            } else if (cs === 'WITHOUT_COLLECTION_DATA') {
                andFilters.push(collectionDataMissing);
            } else if (cs === 'INCONSISTENT') {
                andFilters.push({
                    OR: [
                        { AND: [{ status: { in: ['IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'] } }, collectionDataMissing] },
                        { AND: [{ status: 'PENDING' }, collectionDataPresent] },
                    ],
                });
            }
        }

        if (q && String(q).trim()) {
            const term = String(q).trim();
            andFilters.push({
                OR: [
                    { id: { contains: term, mode: 'insensitive' } },
                    { nfNumber: { contains: term, mode: 'insensitive' } },
                    { demand: { nfNumber: { contains: term, mode: 'insensitive' } } },
                    { demand: { origin: { contains: term, mode: 'insensitive' } } },
                    { demand: { destination: { contains: term, mode: 'insensitive' } } },
                    { origemPrestacao: { contains: term, mode: 'insensitive' } },
                    { fimPrestacao: { contains: term, mode: 'insensitive' } },
                    { currentHub: { name: { contains: term, mode: 'insensitive' } } },
                    { demand: { client: { companyName: { contains: term, mode: 'insensitive' } } } },
                    { remetentePerson: { legalName: { contains: term, mode: 'insensitive' } } },
                    { destinatarioPerson: { legalName: { contains: term, mode: 'insensitive' } } },
                ],
            });
        }

        // HUB: escopo alinhado à operação do CD (currentHub, expectedHub, manifesto)
        if (req.user!.roles.includes('HUB')) {
            if (!req.user!.hubId) {
                throw new AppError('Hub user has no hub assigned', 403);
            }
            andFilters.push(buildHubOrderVisibilityWhere(req.user!.hubId));
            const statusesParam = typeof statuses === 'string' ? statuses : undefined;
            const singleStatus = typeof status === 'string' ? status : undefined;
            where.status = parseOrderStatusWhereInput(statusesParam, singleStatus, 'AT_HUB');
        }
        // LINK users see orders from their manifests
        else if (req.user!.roles.includes('LINK')) {
            const link = await prisma.link.findFirst({
                where: { userId: req.user!.id },
            });
            if (!link) {
                throw new AppError('Link profile not found', 404);
            }
            where.manifest = { linkId: link.id };
        }
        // Clients can only see orders from their account
        else if (req.user!.roles.includes('CLIENT')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { account: true }
            });
            
            if (!user || !user.accountId) {
                throw new AppError('Account not found', 404);
            }

            // Get all demands from account clients
            const accountClients = await prisma.client.findMany({
                where: { accountId: user.accountId },
                select: { id: true }
            });
            const clientIds = accountClients.map(c => c.id);
            
            where.demand = {
                clientId: { in: clientIds }
            };
        } else if (accountId) {
            // Admin filtering by account
            const accountClients = await prisma.client.findMany({
                where: { accountId: accountId as string },
                select: { id: true }
            });
            const clientIds = accountClients.map(c => c.id);
            
            where.demand = {
                clientId: { in: clientIds }
            };
        }

        if (andFilters.length > 0) {
            where.AND = andFilters;
        }

        const parsedSortDir: Prisma.SortOrder = String(sortDir).toLowerCase() === 'asc' ? 'asc' : 'desc';
        const parsedSortBy = String(sortBy);

        const orderByMap: Record<string, Prisma.OrderOrderByWithRelationInput> = {
            updatedAt: { updatedAt: parsedSortDir },
            createdAt: { createdAt: parsedSortDir },
            status: { status: parsedSortDir },
            nfNumber: { nfNumber: parsedSortDir },
            currentHubName: { currentHub: { name: parsedSortDir } },
            origin: { demand: { origin: parsedSortDir } },
            destination: { demand: { destination: parsedSortDir } },
            senderCity: { remetentePerson: { city: parsedSortDir } },
            senderState: { remetentePerson: { state: parsedSortDir } },
            recipientCity: { destinatarioPerson: { city: parsedSortDir } },
            recipientState: { destinatarioPerson: { state: parsedSortDir } },
            clientName: { demand: { client: { companyName: parsedSortDir } } },
        };
        const orderBy = orderByMap[parsedSortBy] ?? orderByMap.updatedAt;

        const [orders, total] = await prisma.$transaction([
            prisma.order.findMany({
                where,
                include: {
                    demand: {
                        include: {
                            client: {
                                include: {
                                    account: true
                                }
                            }
                        }
                    },
                    opportunity: true,
                    manifest: {
                        include: {
                            link: true,
                            hub: true
                        }
                    },
                    currentHub: { select: { id: true, name: true, code: true } },
                    legs: {
                        include: {
                            manifest: {
                                include: {
                                    link: { select: { name: true } },
                                    hub: { select: { name: true, code: true } },
                                    destHub: { select: { name: true, code: true } }
                                }
                            }
                        },
                        orderBy: { sequence: 'asc' }
                    },
                    remetentePerson: { select: { id: true, legalName: true, city: true, state: true } },
                    destinatarioPerson: { select: { id: true, legalName: true, city: true, state: true } },
                    history: {
                        orderBy: { createdAt: 'desc' },
                        take: 10
                    },
                    _count: {
                        select: { history: true, invoices: true }
                    },
                    attachments: {
                        include: {
                            attachment: true,
                        },
                        orderBy: { createdAt: 'desc' },
                    },
                },
                orderBy,
                take: parsedLimit,
                skip: parsedOffset,
            }),
            prisma.order.count({ where }),
        ]);

        res.json({
            success: true,
            data: orders,
            pagination: {
                total,
                limit: parsedLimit,
                offset: parsedOffset,
            },
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/orders/:id - Get single order with full history
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                demand: {
                    include: {
                        client: {
                            include: {
                                account: true
                            }
                        },
                        events: {
                            orderBy: { createdAt: 'asc' }
                        }
                    }
                },
                opportunity: true,
                manifest: {
                    include: {
                        link: true,
                        hub: true,
                        vehicleType: true
                    }
                },
                currentHub: { select: { id: true, name: true, code: true } },
                legs: {
                    include: {
                        manifest: {
                            include: {
                                link: { select: { name: true } },
                                hub: { select: { name: true, code: true } },
                                destHub: { select: { name: true, code: true } }
                            }
                        }
                    },
                    orderBy: { sequence: 'asc' }
                },
                remetentePerson: { select: { id: true, legalName: true, document: true, documentType: true, address: true, cep: true, city: true, state: true, neighborhood: true, number: true, complement: true } },
                destinatarioPerson: { select: { id: true, legalName: true, document: true, documentType: true } },
                consignatarioPerson: { select: { id: true, legalName: true, document: true, documentType: true } },
                expedidorPerson: { select: { id: true, legalName: true, document: true, documentType: true } },
                redespachantePerson: { select: { id: true, legalName: true, document: true, documentType: true } },
                route: { select: { id: true, name: true } },
                history: {
                    orderBy: { createdAt: 'asc' }
                },
                invoices: {
                    orderBy: { createdAt: 'desc' }
                },
                invoicesRel: { orderBy: { createdAt: 'asc' } },
                freightCalculations: true,
                attachments: {
                    include: {
                        attachment: true,
                    },
                    orderBy: { createdAt: 'desc' },
                },
            }
        });

        if (!order) {
            throw new AppError('Order not found', 404);
        }

        // Check authorization for clients
        if (req.user!.roles.includes('CLIENT')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { account: true }
            });
            
            if (!user || !user.accountId || order.demand.client.accountId !== user.accountId) {
                throw new AppError('Not authorized', 403);
            }
        }

        if (req.user!.roles.includes('HUB')) {
            await ensureHubOrderAccessById(req, id);
        }

        if (shouldApplyLinkOrderScope(req.user!.roles)) {
            const link = await prisma.link.findFirst({
                where: { userId: req.user!.id },
            });
            if (!link || order.manifest?.linkId !== link.id) {
                throw new AppError('Not authorized', 403);
            }
        }

        res.json({
            success: true,
            data: order,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== ENTRADA (JORNADA DO PEDIDO) ====================

// Helper: aceita string vazia como undefined para evitar "Invalid uuid"
const optionalUuid = () =>
    z.preprocess((v) => (v === '' || (typeof v === 'string' && !v.trim()) ? undefined : v), z.string().uuid().optional());
const optionalUuidNullable = () =>
    z.preprocess((v) => (v === '' || (typeof v === 'string' && !v.trim()) ? null : v), z.string().uuid().nullable().optional());

async function assertOrderAccess(req: AuthRequest, orderId: string) {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            demand: {
                include: {
                    client: { select: { accountId: true } },
                },
            },
            manifest: { select: { linkId: true, hubId: true, destHubId: true } },
        },
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (req.user!.roles.includes('HUB')) {
        await ensureHubOrderAccessById(req, orderId);
    }

    if (shouldApplyLinkOrderScope(req.user!.roles)) {
        const link = await prisma.link.findFirst({
            where: { userId: req.user!.id },
            select: { id: true },
        });
        if (!link || order.manifest?.linkId !== link.id) {
            throw new AppError('Not authorized', 403);
        }
    }

    if (req.user!.roles.includes('CLIENT')) {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { accountId: true },
        });
        if (!user?.accountId || order.demand.client.accountId !== user.accountId) {
            throw new AppError('Not authorized', 403);
        }
    }

    return order;
}

const UUID_OPTIONAL_KEYS = ['routeId', 'hubId', 'consignatarioPersonId', 'expedidorPersonId', 'redespachantePersonId'];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sanitiza body antes do parse: remove "" e null de UUIDs opcionais, trim em obrigatórios */
function sanitizeEntradaBody(body: Record<string, unknown>): Record<string, unknown> {
    const out = { ...body };
    for (const k of UUID_OPTIONAL_KEYS) {
        const v = out[k];
        const isEmpty = v === '' || v === null || (typeof v === 'string' && !v.trim());
        const isInvalidUuid = typeof v === 'string' && v.length > 0 && !UUID_REGEX.test(v.trim());
        if (isEmpty || isInvalidUuid) delete out[k];
    }
    if (typeof out.remetentePersonId === 'string') out.remetentePersonId = out.remetentePersonId.trim();
    if (typeof out.destinatarioPersonId === 'string') out.destinatarioPersonId = out.destinatarioPersonId.trim();
    return out;
}

const orderEntradaSchema = z.object({
    freightTerm: z.enum(['CIF', 'FOB', 'REDESPACHO']),
    remetentePersonId: z.string().trim().uuid(),
    destinatarioPersonId: z.string().trim().uuid(),
    consignatarioPersonId: optionalUuid(),
    expedidorPersonId: optionalUuid(),
    redespachantePersonId: optionalUuid(),
    origemPrestacao: z.string().min(1),
    fimPrestacao: z.string().min(1),
    routeId: optionalUuid(),
    hubId: optionalUuid(),
    collectionData: z.record(z.unknown()).optional(),
});

// POST /api/orders/entrada - Create order from entrada (Admin or HUB)
router.post('/entrada', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const body = sanitizeEntradaBody(req.body as Record<string, unknown>);
        const data = orderEntradaSchema.parse(body);

        const isHub = req.user!.roles.includes('HUB');
        const effectiveHubId = isHub ? req.user!.hubId : (data.hubId ?? null);

        if (isHub && !effectiveHubId) {
            throw new AppError('Hub user has no hub assigned', 403);
        }

        // Determine payer from freight term
        const payerPersonId = data.freightTerm === 'CIF'
            ? data.remetentePersonId
            : data.freightTerm === 'FOB'
                ? data.destinatarioPersonId
                : (data.consignatarioPersonId ?? data.destinatarioPersonId);

        if (!payerPersonId) {
            throw new AppError('Pagador não definido. Para REDESPACHO, informe o consignatário.', 400);
        }

        // Payer must have a Client
        const payerPerson = await prisma.person.findUnique({
            where: { id: payerPersonId },
            include: { clients: { take: 1 } }
        });

        if (!payerPerson) {
            throw new AppError('Pessoa pagadora não encontrada', 404);
        }

        const payerClient = payerPerson.clients?.[0];
        if (!payerClient) {
            throw new AppError(
                `O pagador (${data.freightTerm === 'CIF' ? 'Remetente' : data.freightTerm === 'FOB' ? 'Destinatário' : 'Consignatário'}) deve ser um Cliente. Adicione-o como Cliente em Pessoas primeiro.`,
                400
            );
        }

        const result = await prisma.$transaction(async (tx) => {
            const demand = await tx.demand.create({
                data: {
                    clientId: payerClient.id,
                    nfNumber: 'PENDENTE',
                    nfValue: 0,
                    origin: data.origemPrestacao,
                    destination: data.fimPrestacao,
                    commodity: 'A definir',
                    weight: 0,
                    volume: 0,
                    riskClass: 'B',
                    intentType: 'DROP_AT_HUB',
                    status: 'CONVERTED',
                    sourceType: 'FORM',
                    expectedHubId: effectiveHubId ?? null,
                }
            });

            await tx.demandEvent.create({
                data: {
                    demandId: demand.id,
                    status: 'CONVERTED',
                    description: 'Pedido criado pela entrada manual',
                    location: data.origemPrestacao,
                }
            });

            const order = await tx.order.create({
                data: {
                    demandId: demand.id,
                    status: effectiveHubId ? 'AT_HUB' : 'PENDING',
                    currentHubId: effectiveHubId,
                    enteredAtHubAt: effectiveHubId ? new Date() : null,
                    freightTerm: data.freightTerm as 'CIF' | 'FOB' | 'REDESPACHO',
                    remetentePersonId: data.remetentePersonId,
                    destinatarioPersonId: data.destinatarioPersonId,
                    consignatarioPersonId: data.consignatarioPersonId ?? null,
                    expedidorPersonId: data.expedidorPersonId ?? null,
                    redespachantePersonId: data.redespachantePersonId ?? null,
                    origemPrestacao: data.origemPrestacao,
                    fimPrestacao: data.fimPrestacao,
                    routeId: data.routeId || undefined,
                    collectionData: data.collectionData != null ? (data.collectionData as Prisma.InputJsonValue) : undefined,
                }
            });

            await tx.orderHistory.create({
                data: {
                    orderId: order.id,
                    eventType: 'CREATED',
                    description: 'Pedido criado pela entrada manual',
                    location: data.origemPrestacao,
                }
            });

            return { demand, order };
        });

        const fullOrder = await prisma.order.findUnique({
            where: { id: result.order.id },
            include: {
                demand: { include: { client: { select: { id: true, companyName: true } } } },
                currentHub: { select: { id: true, name: true, code: true } },
                remetentePerson: { select: { id: true, legalName: true, document: true, documentType: true } },
                destinatarioPerson: { select: { id: true, legalName: true, document: true, documentType: true } },
                consignatarioPerson: { select: { id: true, legalName: true, document: true, documentType: true } },
                route: { select: { id: true, name: true } },
                invoicesRel: true,
            }
        });

        res.status(201).json({
            success: true,
            data: fullOrder,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            const e = error.errors[0];
            const path = e.path?.length ? (e.path as string[]).join('.') + ': ' : '';
            return next(new AppError(path + e.message, 400));
        }
        next(error);
    }
});

/** Sincroniza dados do Order para a Opportunity vinculada (quando order.opportunityId existe) */
async function syncOrderToOpportunity(orderId: string): Promise<void> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { invoicesRel: true },
    });
    if (!order || !order.opportunityId) return;

    const cd = order.collectionData as Record<string, unknown> | null;
    const weightFromCd = cd && cd.weight != null ? Number(cd.weight) : null;
    const nfValueFromCd = cd && cd.nfValue != null ? Number(cd.nfValue) : null;

    const totalWeight = order.invoicesRel.reduce((s, i) => s + (i.weight || 0), 0);
    const totalVolumes = order.invoicesRel.reduce((s, i) => s + (i.volumes || 0), 0);
    const totalValue = order.invoicesRel.reduce((s, i) => s + (i.value || 0), 0);

    const weight = totalWeight > 0 ? totalWeight : weightFromCd ?? undefined;
    const nfValue = totalValue > 0 ? totalValue : nfValueFromCd ?? undefined;
    const volumes = totalVolumes > 0 ? totalVolumes : (cd?.volumes != null ? Number(cd.volumes) : undefined);

    const updateData: Record<string, unknown> = {};
    if (order.collectionData != null) updateData.collectionData = order.collectionData;
    if (weight != null) updateData.weight = weight;
    if (nfValue != null) updateData.nfValue = nfValue;
    if (volumes != null) updateData.volumes = volumes;
    if (order.origemPrestacao) updateData.origin = order.origemPrestacao;
    if (order.fimPrestacao) updateData.destination = order.fimPrestacao;
    if (cd?.commodity && typeof cd.commodity === 'string') updateData.commodity = cd.commodity;

    if (Object.keys(updateData).length === 0) return;

    await prisma.opportunity.update({
        where: { id: order.opportunityId },
        data: updateData as any,
    });
}

/** Sanitiza body do PATCH people: remove "" de UUIDs opcionais */
function sanitizePeopleBody(body: Record<string, unknown>): Record<string, unknown> {
    const opt = ['routeId', 'consignatarioPersonId', 'expedidorPersonId', 'redespachantePersonId'];
    const out = { ...body };
    for (const k of opt) {
        const v = out[k];
        if (v === '' || (typeof v === 'string' && !v.trim())) out[k] = null;
    }
    if (typeof out.remetentePersonId === 'string' && !out.remetentePersonId.trim()) delete out.remetentePersonId;
    if (typeof out.destinatarioPersonId === 'string' && !out.destinatarioPersonId.trim()) delete out.destinatarioPersonId;
    return out;
}

const orderPeopleSchema = z.object({
    freightTerm: z.enum(['CIF', 'FOB', 'REDESPACHO']).optional(),
    remetentePersonId: z.preprocess((v) => (v === '' || (typeof v === 'string' && !v.trim()) ? undefined : v), z.string().uuid().optional()),
    destinatarioPersonId: z.preprocess((v) => (v === '' || (typeof v === 'string' && !v.trim()) ? undefined : v), z.string().uuid().optional()),
    consignatarioPersonId: optionalUuidNullable(),
    expedidorPersonId: optionalUuidNullable(),
    redespachantePersonId: optionalUuidNullable(),
    origemPrestacao: z.string().optional(),
    fimPrestacao: z.string().optional(),
    routeId: optionalUuidNullable(),
    collectionData: z.record(z.unknown()).optional(),
});

// PATCH /api/orders/:id/people - Update order people/parties
router.patch('/:id/people', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const body = sanitizePeopleBody(req.body as Record<string, unknown>);
        const data = orderPeopleSchema.parse(body);

        const order = await prisma.order.findUnique({ where: { id }, select: hubOrderAccessSelect });
        if (!order) throw new AppError('Order not found', 404);

        checkHubAccessIfHubRole(req, order);

        const updateData: Record<string, unknown> = {};
        if (data.freightTerm != null) updateData.freightTerm = data.freightTerm;
        if (data.remetentePersonId != null) updateData.remetentePersonId = data.remetentePersonId;
        if (data.destinatarioPersonId != null) updateData.destinatarioPersonId = data.destinatarioPersonId;
        if (data.consignatarioPersonId !== undefined) updateData.consignatarioPersonId = data.consignatarioPersonId;
        if (data.expedidorPersonId !== undefined) updateData.expedidorPersonId = data.expedidorPersonId;
        if (data.redespachantePersonId !== undefined) updateData.redespachantePersonId = data.redespachantePersonId;
        if (data.origemPrestacao != null) updateData.origemPrestacao = data.origemPrestacao;
        if (data.fimPrestacao != null) updateData.fimPrestacao = data.fimPrestacao;
        if (data.routeId !== undefined) updateData.routeId = data.routeId;
        if (data.collectionData !== undefined) updateData.collectionData = data.collectionData;

        const updated = await prisma.order.update({
            where: { id },
            data: updateData as any
        });

        const fullOrder = await prisma.order.findUnique({
            where: { id },
            include: {
                demand: { include: { client: true } },
                remetentePerson: true,
                destinatarioPerson: true,
                consignatarioPerson: true,
                expedidorPerson: true,
                redespachantePerson: true,
                route: true,
                invoicesRel: true,
            }
        });

        await syncOrderToOpportunity(id).catch(() => {});

        res.json({ success: true, data: fullOrder });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== CREATE ORDER ====================

// POST /api/orders - Create order from demand
router.post('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            demandId: z.string().uuid(),
            nfNumber: z.string().optional(),
            nfDocumentUrl: z.string().url().optional(),
        });

        const data = schema.parse(req.body);

        // Check if demand exists and is in valid status
        const demand = await prisma.demand.findUnique({
            where: { id: data.demandId },
            include: {
                client: true
            }
        });

        if (!demand) {
            throw new AppError('Demand not found', 404);
        }

        // Check if order already exists
        const existingOrder = await prisma.order.findUnique({
            where: { demandId: data.demandId }
        });

        if (existingOrder) {
            throw new AppError('Order already exists for this demand', 400);
        }

        // Validate demand status (must be APPROVED, AWAITING_ARRIVAL, PENDING or QUOTED)
        if (demand.status !== 'APPROVED' && demand.status !== 'AWAITING_ARRIVAL' && demand.status !== 'PENDING' && demand.status !== 'QUOTED') {
            throw new AppError(`Cannot create order. Demand status must be APPROVED, AWAITING_ARRIVAL, PENDING or QUOTED, current status: ${demand.status}`, 400);
        }

        // Find opportunity that matches this demand (via matchedDemandId)
        const matchingOpportunity = await prisma.opportunity.findFirst({
            where: { matchedDemandId: data.demandId }
        });

        // Create order
        const order = await prisma.$transaction(async (tx) => {
            const newOrder = await tx.order.create({
                data: {
                    demandId: data.demandId,
                    opportunityId: matchingOpportunity?.id || null,
                    nfNumber: data.nfNumber || demand.nfNumber,
                    nfDocumentUrl: data.nfDocumentUrl,
                    status: 'PENDING',
                    enteredAtHubAt: null,
                },
                include: {
                    demand: true,
                    opportunity: true
                }
            });

            // Set demand status to CONVERTED
            await tx.demand.update({
                where: { id: data.demandId },
                data: { status: 'CONVERTED' }
            });

            // Import all DemandEvents as OrderHistory
            const demandEvents = await tx.demandEvent.findMany({
                where: { demandId: data.demandId },
                orderBy: { createdAt: 'asc' }
            });

            // Map DemandStatus to OrderEventType
            const statusMap: Record<string, string> = {
                'PENDING': 'CREATED',
                'QUOTED': 'CREATED',
                'APPROVED': 'CREATED',
                'ASSIGNED': 'CREATED',
                'COLLECTED': 'COLLECTED',
                'IN_TRANSIT': 'IN_TRANSIT',
                'AT_HUB': 'AT_HUB',
                'OUT_FOR_DELIVERY': 'OUT_FOR_DELIVERY',
                'DELIVERED': 'DELIVERED',
                'CANCELLED': 'CANCELLED',
            };

            for (const event of demandEvents) {
                await tx.orderHistory.create({
                    data: {
                        orderId: newOrder.id,
                        eventType: (statusMap[event.status] || 'NOTE') as any,
                        description: event.description,
                        location: event.location,
                        photoUrl: event.photoUrl,
                        demandEventId: event.id,
                    }
                });
            }

            // Create initial history entry
            await tx.orderHistory.create({
                data: {
                    orderId: newOrder.id,
                    eventType: 'CREATED',
                    description: `Pedido criado a partir da demanda ${demand.id.slice(0, 8)}`,
                    location: demand.origin,
                }
            });

            return newOrder;
        });

        const fullOrder = await prisma.order.findUnique({
            where: { id: order.id },
            include: {
                demand: true,
                opportunity: true,
                history: true
            }
        });

        res.status(201).json({
            success: true,
            data: fullOrder,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== UPDATE ORDER ====================

// PATCH /api/orders/:id/status - Update order status
router.patch('/:id/status', authenticate, authorize('ADMIN', 'LINK', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const schema = z.object({
            status: z.enum(['PENDING', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
            currentHubId: z.string().uuid().optional(),
            description: z.string().optional(),
            location: z.string().optional(),
            photoUrl: z.string().url().optional(),
        });

        const data = schema.parse(req.body);

        const order = await prisma.order.findUnique({
            where: { id },
            select: {
                ...hubOrderAccessSelect,
                demandId: true,
                enteredAtHubAt: true,
            },
        });

        if (!order) {
            throw new AppError('Order not found', 404);
        }

        checkHubAccessIfHubRole(req, order);

        // Block manual status updates if there's an active leg in progress
        const activeLeg = await prisma.orderLeg.findFirst({
            where: {
                orderId: id,
                manifest: {
                    status: 'IN_PROGRESS',
                },
            },
        });
        if (activeLeg) {
            throw new AppError('Não é possível alterar o status manualmente de um pedido que está em trânsito (viagem ativa). Conclua o manifesto correspondente.', 400);
        }

        const newCurrentHubId = data.status === 'AT_HUB'
            ? (req.user!.roles.includes('HUB') ? req.user!.hubId! : (data.currentHubId ?? order.currentHubId))
            : (['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(data.status) ? null : order.currentHubId);

        const updated = await prisma.$transaction(async (tx) => {
            // Update order status
            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: data.status,
                    currentHubId: newCurrentHubId,
                    enteredAtHubAt: data.status === 'AT_HUB' && !order.enteredAtHubAt ? new Date() : order.enteredAtHubAt,
                }
            });

            // Create history entry
            const eventTypeMap: Record<string, string> = {
                'PENDING': 'CREATED',
                'IN_TRANSIT': 'IN_TRANSIT',
                'AT_HUB': 'AT_HUB',
                'OUT_FOR_DELIVERY': 'OUT_FOR_DELIVERY',
                'DELIVERED': 'DELIVERED',
                'CANCELLED': 'CANCELLED',
            };

            await tx.orderHistory.create({
                data: {
                    orderId: id,
                    eventType: (eventTypeMap[data.status] || 'NOTE') as any,
                    description: data.description || `Status atualizado para ${data.status}`,
                    location: data.location,
                    photoUrl: data.photoUrl,
                }
            });

            return updatedOrder;
        });

        const fullOrder = await prisma.order.findUnique({
            where: { id },
            include: {
                demand: true,
                opportunity: true,
                manifest: true,
                currentHub: { select: { id: true, name: true, code: true } },
                history: {
                    orderBy: { createdAt: 'desc' },
                    take: 10
                }
            }
        });

        res.json({
            success: true,
            data: fullOrder,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/orders/:id/history - Add history entry
router.post('/:id/history', authenticate, authorize('ADMIN', 'LINK', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const schema = z.object({
            eventType: z.enum(['CREATED', 'COLLECTED', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'NOTE']),
            description: z.string(),
            location: z.string().optional(),
            photoUrl: z.string().url().optional(),
        });

        const data = schema.parse(req.body);

        const order = await prisma.order.findUnique({
            where: { id },
            select: hubOrderAccessSelect,
        });

        if (!order) {
            throw new AppError('Order not found', 404);
        }

        checkHubAccessIfHubRole(req, order);

        const history = await prisma.orderHistory.create({
            data: {
                orderId: id,
                ...data,
            }
        });

        res.status(201).json({
            success: true,
            data: history,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== ORDER INVOICES (NFs do pedido) ====================

// Aceita YYYY-MM-DD, DD/MM/YYYY ou datetime ISO
function parseEmissionDate(v: string | undefined): string | null {
    if (!v || typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
        const [d, m, y] = s.split('/');
        return `${y}-${m}-${d}`;
    }
    return s;
}

const orderInvoiceSchema = z.object({
    type: z.enum(['NFE', 'OUTRAS']),
    nfNumber: z.string().min(1),
    nfKey: z.string().optional(),
    emissionDate: z.string().optional().refine(
        (v) => !v || /^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{2}\/\d{2}\/\d{4}$/.test(v),
        { message: 'Data inválida. Use YYYY-MM-DD ou DD/MM/YYYY' }
    ),
    nature: z.string().optional(),
    species: z.string().optional(),
    volumes: z.number().min(0).default(0),
    weight: z.number().min(0).default(0),
    cubedVolume: z.number().min(0).optional(),
    value: z.number().min(0).default(0),
});

// POST /api/orders/:id/invoices - Add NF to order
router.post('/:id/invoices', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const data = orderInvoiceSchema.parse(req.body);

        const order = await prisma.order.findUnique({ where: { id }, include: { invoicesRel: true } });
        if (!order) throw new AppError('Order not found', 404);

        checkHubAccessIfHubRole(req, order);

        const emissionDateStr = data.emissionDate ? parseEmissionDate(data.emissionDate) || data.emissionDate : null;
        const emissionDate = emissionDateStr
            ? (emissionDateStr.includes('T')
                ? new Date(emissionDateStr)
                : new Date(emissionDateStr + 'T12:00:00'))
            : null;

        const inv = await prisma.orderInvoice.create({
            data: {
                orderId: id,
                type: data.type as 'NFE' | 'OUTRAS',
                nfNumber: data.nfNumber,
                nfKey: data.nfKey ?? null,
                emissionDate,
                nature: data.nature ?? null,
                species: data.species ?? null,
                volumes: data.volumes,
                weight: data.weight,
                cubedVolume: data.cubedVolume ?? null,
                value: data.value,
            }
        });

        await syncOrderToOpportunity(id).catch(() => {});

        res.status(201).json({ success: true, data: inv });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/orders/:id/invoices/:invoiceId - Update NF/Declaração
router.patch('/:id/invoices/:invoiceId', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.id as string;
        const invoiceId = req.params.invoiceId as string;
        const data = orderInvoiceSchema.partial().parse(req.body);

        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { invoicesRel: true } });
        if (!order) throw new AppError('Order not found', 404);

        checkHubAccessIfHubRole(req, order);

        const existingInv = await prisma.orderInvoice.findFirst({
            where: { id: invoiceId, orderId },
        });
        if (!existingInv) throw new AppError('Invoice not found', 404);

        const updatePayload: Record<string, unknown> = {};
        if (data.type != null) updatePayload.type = data.type;
        if (data.nfNumber != null) updatePayload.nfNumber = data.nfNumber;
        if (data.nfKey !== undefined) updatePayload.nfKey = data.nfKey ?? null;
        if (data.nature !== undefined) updatePayload.nature = data.nature ?? null;
        if (data.species !== undefined) updatePayload.species = data.species ?? null;
        if (data.volumes != null) updatePayload.volumes = data.volumes;
        if (data.weight != null) updatePayload.weight = data.weight;
        if (data.cubedVolume !== undefined) updatePayload.cubedVolume = data.cubedVolume ?? null;
        if (data.value != null) updatePayload.value = data.value;

        if (data.emissionDate != null) {
            const emissionDateStr = parseEmissionDate(data.emissionDate) || data.emissionDate;
            updatePayload.emissionDate = emissionDateStr
                ? (emissionDateStr.includes('T') ? new Date(emissionDateStr) : new Date(emissionDateStr + 'T12:00:00'))
                : null;
        }

        const inv = await prisma.orderInvoice.update({
            where: { id: invoiceId },
            data: updatePayload as any,
        });

        await syncOrderToOpportunity(orderId).catch(() => {});

        res.json({ success: true, data: inv });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== ORDER ATTACHMENTS ====================

router.get('/:id/attachments', authenticate, authorize('ADMIN', 'HUB', 'LINK', 'CLIENT'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.id as string;
        await assertOrderAccess(req, orderId);

        const links = await prisma.orderAttachment.findMany({
            where: { orderId },
            include: { attachment: true },
            orderBy: { createdAt: 'desc' },
        });

        const data = await Promise.all(
            links.map(async (link) => ({
                id: link.id,
                orderId: link.orderId,
                category: link.category,
                createdAt: link.createdAt,
                attachment: {
                    ...link.attachment,
                    downloadUrl: await getObjectDownloadUrl(link.attachment.storageKey),
                },
            }))
        );

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/attachments', authenticate, authorize('ADMIN', 'HUB', 'LINK', 'CLIENT'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.id as string;
        const payload = orderAttachmentCreateSchema.parse(req.body);
        const order = await assertOrderAccess(req, orderId);

        const upload = await uploadBase64Object({
            base64: payload.file,
            fileName: payload.filename,
            mimeType: payload.mimeType,
            keyPrefix: `orders/${orderId}`,
        });

        const attachment = await prisma.attachment.create({
            data: {
                type: inferAttachmentType(payload.mimeType),
                fileName: payload.filename,
                mimeType: payload.mimeType,
                size: upload.size,
                storageKey: upload.storageKey,
                bucket: upload.bucket,
                url: upload.publicUrl,
                checksum: upload.checksum,
                metadata: {
                    orderId,
                    demandId: order.demandId,
                    category: payload.category ?? null,
                },
                uploadedByUserId: req.user!.id,
            },
        });

        const link = await prisma.orderAttachment.create({
            data: {
                orderId,
                attachmentId: attachment.id,
                category: payload.category,
            },
        });

        // Maintain demand link to allow future demand-centric audit/search.
        await prisma.demandAttachment.create({
            data: {
                demandId: order.demandId,
                attachmentId: attachment.id,
                category: payload.category,
            },
        });

        res.status(201).json({
            success: true,
            data: {
                ...link,
                attachment: {
                    ...attachment,
                    downloadUrl: upload.signedUrl,
                },
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

router.delete('/:id/attachments/:attachmentId', authenticate, authorize('ADMIN', 'HUB', 'LINK', 'CLIENT'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.id as string;
        const attachmentId = req.params.attachmentId as string;
        const order = await assertOrderAccess(req, orderId);

        const link = await prisma.orderAttachment.findFirst({
            where: { orderId, attachmentId },
            include: { attachment: true },
        });
        if (!link) {
            throw new AppError('Attachment not found for this order', 404);
        }

        await prisma.$transaction(async (tx) => {
            await tx.orderAttachment.deleteMany({ where: { orderId, attachmentId } });
            await tx.demandAttachment.deleteMany({ where: { demandId: order.demandId, attachmentId } });
            await tx.attachment.delete({ where: { id: attachmentId } });
        });

        await deleteObjectByKey(link.attachment.storageKey);
        res.json({ success: true, data: { id: attachmentId } });
    } catch (error) {
        next(error);
    }
});

export { router as ordersRouter };
