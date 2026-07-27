import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import {
    blocksAutoOrderOnStatusPatch,
    INTAKE_AUTO_ORDER_BLOCKED_MESSAGE,
} from '../services/intake/intakeDemandPolicy.js';
import { getNextOrderNumber } from '../services/orderSequence.js';

const router = Router();

// Validation schemas
const demandSchema = z.object({
    nfNumber: z.string().min(1, 'NF number is required'),
    nfValue: z.number().positive('NF value must be positive'),
    origin: z.string().min(1, 'Origin is required'),
    destination: z.string().min(1, 'Destination is required'),
    commodity: z.string().min(1, 'Commodity is required'),
    weight: z.number().positive('Weight must be positive'),
    volume: z.number().positive('Volume must be positive'),
    units: z.number().int().positive().default(1),
    riskClass: z.enum(['A', 'B', 'C']),
    intentType: z.enum(['QUOTE_ONLY', 'COLLECT', 'DROP_AT_HUB']),
    sourceType: z.enum(['CHAT', 'FORM', 'BATCH', 'API']).default('FORM'),
});

const batchDemandSchema = z.object({
    demands: z.array(demandSchema).min(1, 'At least one demand is required'),
});

// GET /api/demands - List demands
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { status, clientId, destination, intentType, limit = '50', offset = '0' } = req.query;

        const intentFilter =
            intentType && ['QUOTE_ONLY', 'COLLECT', 'DROP_AT_HUB'].includes(String(intentType))
                ? { intentType: intentType as 'QUOTE_ONLY' | 'COLLECT' | 'DROP_AT_HUB' }
                : {};

        // Clients can see all demands from their Account (all CNPJs)
        let clientFilter: any = clientId ? { clientId: clientId as string } : {};
        let hubFilter: any = {};
        if (req.user!.roles.includes('HUB') && req.user!.hubId) {
            hubFilter = {
                order: {
                    OR: [
                        { currentHubId: req.user!.hubId },
                        {
                            legs: {
                                some: {
                                    manifest: { hubId: req.user!.hubId }
                                }
                            }
                        }
                    ]
                }
            };
        }
        if (req.user!.roles.includes('CLIENT')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { account: true }
            });
            
            if (!user || !user.accountId) {
                // Fallback to old behavior if no account
                const client = await prisma.client.findFirst({
                    where: { userId: req.user!.id }
                });
                if (!client) throw new AppError('Client profile not found', 404);
                clientFilter = { clientId: client.id };
            } else {
                // Get all clients in this account
                const accountClients = await prisma.client.findMany({
                    where: { accountId: user.accountId },
                    select: { id: true }
                });
                const clientIds = accountClients.map(c => c.id);
                clientFilter = { clientId: { in: clientIds } };
            }
        }

        const demands = await prisma.demand.findMany({
            where: {
                ...clientFilter,
                ...hubFilter,
                ...intentFilter,
                ...(status ? { status: status as any } : {}),
                ...(destination ? { destination: { contains: destination as string, mode: 'insensitive' } } : {}),
            },
            include: {
                client: {
                    select: { companyName: true }
                },
                order: {
                    include: {
                        legs: {
                            where: {
                                manifest: {
                                    status: { in: ['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'] }
                                }
                            },
                            include: {
                                manifest: {
                                    select: {
                                        id: true,
                                        status: true,
                                        link: { select: { name: true } }
                                    }
                                }
                            },
                            take: 1
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit as string),
            skip: parseInt(offset as string),
        });

        const total = await prisma.demand.count({
            where: {
                ...clientFilter,
                ...hubFilter,
                ...intentFilter,
                ...(status ? { status: status as any } : {}),
                ...(destination ? { destination: { contains: destination as string, mode: 'insensitive' } } : {}),
            },
        });

        const mappedDemands = demands.map((d) => {
            const activeLeg = (d as any).order?.legs?.[0];
            const manifest = activeLeg?.manifest || null;
            return {
                ...d,
                manifest,
            };
        });

        res.json({
            success: true,
            data: mappedDemands,
            pagination: {
                total,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
            }
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/demands/pending - Get pending demands for consolidation (Admin)
router.get('/pending', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { destination } = req.query;

        const demands = await prisma.demand.findMany({
            where: {
                status: { in: ['PENDING', 'QUOTED', 'APPROVED'] }, // AWAITING_ARRIVAL excluded (intake pré-malha)
                ...(destination ? { destination: { contains: destination as string, mode: 'insensitive' } } : {}),
            },
            include: {
                client: {
                    select: { companyName: true }
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        // Group by destination for easier consolidation
        const byDestination = demands.reduce((acc, demand) => {
            const key = demand.destination;
            if (!acc[key]) acc[key] = [];
            acc[key].push(demand);
            return acc;
        }, {} as Record<string, typeof demands>);

        res.json({
            success: true,
            data: demands,
            grouped: byDestination,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/demands/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const demand = await prisma.demand.findUnique({
            where: { id: id },
            include: {
                client: true,
                order: {
                    include: {
                        legs: {
                            where: {
                                manifest: {
                                    status: { in: ['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'] }
                                }
                            },
                            include: {
                                manifest: {
                                    include: {
                                        link: true,
                                        vehicleType: true,
                                    }
                                }
                            },
                            take: 1
                        }
                    }
                },
                events: {
                    orderBy: { createdAt: 'desc' }
                },
            }
        });

        if (!demand) {
            throw new AppError('Demand not found', 404);
        }

        // Check access for clients (can see demands from all CNPJs in their account)
        if (req.user!.roles.includes('CLIENT')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { account: true }
            });
            
            if (!user || !user.accountId) {
                // Fallback to old behavior
                const client = await prisma.client.findFirst({
                    where: { userId: req.user!.id }
                });
                if (!client || client.id !== demand.clientId) {
                    throw new AppError('Not authorized', 403);
                }
            } else {
                // Check if demand belongs to any client in this account
                const accountClients = await prisma.client.findMany({
                    where: { accountId: user.accountId },
                    select: { id: true }
                });
                const clientIds = accountClients.map(c => c.id);
                if (!clientIds.includes(demand.clientId)) {
                    throw new AppError('Not authorized', 403);
                }
            }
        }

        const activeLeg = (demand as any).order?.legs?.[0];
        const manifest = activeLeg?.manifest || null;
        const mappedDemand = {
            ...demand,
            manifest,
        };

        res.json({
            success: true,
            data: mappedDemand,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/demands - Create single demand
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = demandSchema.parse(req.body);

        // Get client ID
        let clientId: string;
        if (req.user!.roles.includes('CLIENT')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { client: true, account: true }
            });
            
            if (!user || !user.client) {
                throw new AppError('Client profile not found', 404);
            }
            
            // If user has account, use the client associated with primary company or first client
            if (user.accountId) {
                // Try to find client for primary company
                const primaryCompany = await prisma.accountCompany.findFirst({
                    where: { accountId: user.accountId, isPrimary: true }
                });
                
                if (primaryCompany) {
                    const accountClient = await prisma.client.findFirst({
                        where: { accountCompanyId: primaryCompany.id }
                    });
                    if (accountClient) {
                        clientId = accountClient.id;
                    } else {
                        // Use user's client as fallback
                        clientId = user.client.id;
                    }
                } else {
                    clientId = user.client.id;
                }
            } else {
                clientId = user.client.id;
            }
        } else if (req.body.clientId) {
            clientId = req.body.clientId;
        } else {
            throw new AppError('Client ID is required', 400);
        }

        // Calculate cubed weight (default 300 kg/m³)
        const cubeFactor = 300;
        const cubedWeight = data.volume * cubeFactor;

        const orderNumber = await getNextOrderNumber();

        const demand = await prisma.demand.create({
            data: {
                ...data,
                clientId,
                cubedWeight,
                orderNumber,
            },
        });

        // Create initial event
        await prisma.demandEvent.create({
            data: {
                demandId: demand.id,
                status: 'PENDING',
                description: 'Demanda criada no sistema',
                location: data.origin,
            }
        });

        // TODO: Apply automatic pricing if client has pricing tables

        res.status(201).json({
            success: true,
            data: demand,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/demands/batch - Create multiple demands
router.post('/batch', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { demands: demandsList } = batchDemandSchema.parse(req.body);

        // Get client ID
        let clientId: string;
        if (req.user!.roles.includes('CLIENT')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { client: true, account: true }
            });
            
            if (!user || !user.client) {
                throw new AppError('Client profile not found', 404);
            }
            
            // If user has account, use the client associated with primary company
            if (user.accountId) {
                const primaryCompany = await prisma.accountCompany.findFirst({
                    where: { accountId: user.accountId, isPrimary: true }
                });
                
                if (primaryCompany) {
                    const accountClient = await prisma.client.findFirst({
                        where: { accountCompanyId: primaryCompany.id }
                    });
                    if (accountClient) {
                        clientId = accountClient.id;
                    } else {
                        clientId = user.client.id;
                    }
                } else {
                    clientId = user.client.id;
                }
            } else {
                clientId = user.client.id;
            }
        } else if (req.body.clientId) {
            clientId = req.body.clientId;
        } else {
            throw new AppError('Client ID is required', 400);
        }

        const cubeFactor = 300;

        const createdDemands = await prisma.$transaction(async (tx) => {
            const results = [];

            for (const data of demandsList) {
                const cubedWeight = data.volume * cubeFactor;
                const orderNumber = await getNextOrderNumber(tx);

                const demand = await tx.demand.create({
                    data: {
                        ...data,
                        clientId,
                        cubedWeight,
                        sourceType: 'BATCH',
                        orderNumber,
                    },
                });

                await tx.demandEvent.create({
                    data: {
                        demandId: demand.id,
                        status: 'PENDING',
                        description: 'Demanda criada via upload em lote',
                        location: data.origin,
                    }
                });

                results.push(demand);
            }

            return results;
        });

        res.status(201).json({
            success: true,
            data: createdDemands,
            count: createdDemands.length,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/demands/:id/status - Update demand status (restrito por role: Admin livre; Link só demands do seu manifesto)
router.patch('/:id/status', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { status, description, location, photoUrl, currentHubId } = req.body;

        if (!status) {
            throw new AppError('Status is required', 400);
        }

        const existingDemand = await prisma.demand.findUnique({
            where: { id },
            include: {
                order: {
                    include: {
                        legs: {
                            include: {
                                manifest: true
                            }
                        }
                    }
                }
            },
        });

        if (!existingDemand) {
            throw new AppError('Demand not found', 404);
        }

        // Autorização por role
        if (req.user!.roles.includes('CLIENT')) {
            throw new AppError('Not authorized to update demand status', 403);
        }
        if (req.user!.roles.includes('HUB')) {
            throw new AppError('Use order status to update; demand status is synced from order', 403);
        }
        if (req.user!.roles.includes('LINK')) {
            const link = await prisma.link.findFirst({
                where: { userId: req.user!.id },
            });
            const activeLeg = existingDemand.order?.legs?.find(l => l.startedAt && !l.completedAt)
                || existingDemand.order?.legs?.[existingDemand.order.legs.length - 1];
            const manifestId = activeLeg?.manifestId || null;
            const manifest = activeLeg?.manifest || null;
            if (!link || !manifestId || manifest?.linkId !== link.id) {
                throw new AppError('Not authorized: demand is not in your manifest', 403);
            }
            const linkAllowedStatuses = ['COLLECTED', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'];
            if (!linkAllowedStatuses.includes(status)) {
                throw new AppError('Not authorized to set this status', 403);
            }
        }

        if (
            blocksAutoOrderOnStatusPatch(
                existingDemand.sourceType,
                status,
                Boolean(existingDemand.order),
            )
        ) {
            throw new AppError(INTAKE_AUTO_ORDER_BLOCKED_MESSAGE, 403);
        }

        const physicalStatuses = ['COLLECTED', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'];
        let targetDemandStatus: any = status;
        if (physicalStatuses.includes(status)) {
            targetDemandStatus = 'CONVERTED';
        }

        const demand = await prisma.$transaction(async (tx) => {
            // 1. If order exists and incoming status is physical, update the order status
            if (existingDemand.order && physicalStatuses.includes(status)) {
                // Check if order has an active transit leg
                const activeLeg = await tx.orderLeg.findFirst({
                    where: {
                        orderId: existingDemand.order.id,
                        startedAt: { not: null },
                        completedAt: null,
                    }
                });
                if (activeLeg) {
                    throw new AppError('Não é possível atualizar o status do pedido manualmente enquanto há uma perna de transporte ativa no manifesto.', 400);
                }

                const orderStatusMap: Record<string, string> = {
                    'COLLECTED': 'PENDING',
                    'IN_TRANSIT': 'IN_TRANSIT',
                    'AT_HUB': 'AT_HUB',
                    'OUT_FOR_DELIVERY': 'OUT_FOR_DELIVERY',
                    'DELIVERED': 'DELIVERED',
                };
                const nextOrderStatus = orderStatusMap[status] as any;

                await tx.order.update({
                    where: { id: existingDemand.order.id },
                    data: {
                        status: nextOrderStatus,
                        currentHubId: status === 'AT_HUB' ? (currentHubId || null) : undefined,
                        enteredAtHubAt: status === 'AT_HUB' ? new Date() : undefined,
                    }
                });

                const statusMap: Record<string, string> = {
                    'COLLECTED': 'COLLECTED',
                    'IN_TRANSIT': 'IN_TRANSIT',
                    'AT_HUB': 'AT_HUB',
                    'OUT_FOR_DELIVERY': 'OUT_FOR_DELIVERY',
                    'DELIVERED': 'DELIVERED',
                };

                await tx.orderHistory.create({
                    data: {
                        orderId: existingDemand.order.id,
                        eventType: (statusMap[status] || 'NOTE') as any,
                        description: description || `Status do pedido atualizado para ${status}`,
                        location,
                        photoUrl,
                    }
                });

                // Set demand status to CONVERTED
                return tx.demand.update({
                    where: { id },
                    data: { status: 'CONVERTED' },
                    include: { order: true }
                });
            }

            // 2. If order doesn't exist and status indicates possession (COLLECTED, AT_HUB, CONVERTED)
            if (!existingDemand.order && (status === 'COLLECTED' || status === 'AT_HUB' || status === 'CONVERTED')) {
                const updatedDemand = await tx.demand.update({
                    where: { id },
                    data: { status: 'CONVERTED' },
                    include: { order: true }
                });

                const matchingOpportunity = await tx.opportunity.findFirst({
                    where: { matchedDemandId: id }
                });

                const orderCurrentHubId = status === 'AT_HUB' ? (currentHubId || null) : null;

                const newOrder = await tx.order.create({
                    data: {
                        demandId: id,
                        opportunityId: matchingOpportunity?.id || null,
                        nfNumber: updatedDemand.nfNumber,
                        status: status === 'AT_HUB' ? 'AT_HUB' : 'PENDING',
                        enteredAtHubAt: status === 'AT_HUB' ? new Date() : null,
                        currentHubId: orderCurrentHubId,
                    }
                });

                // Import demand events as OrderHistory
                const demandEvents = await tx.demandEvent.findMany({
                    where: { demandId: id },
                    orderBy: { createdAt: 'asc' }
                });

                const eventStatusMap: Record<string, string> = {
                    'PENDING': 'CREATED',
                    'QUOTED': 'CREATED',
                    'APPROVED': 'CREATED',
                    'CONVERTED': 'CREATED',
                    'LOST': 'CANCELLED',
                    'CANCELLED': 'CANCELLED',
                };

                for (const event of demandEvents) {
                    await tx.orderHistory.create({
                        data: {
                            orderId: newOrder.id,
                            eventType: (eventStatusMap[event.status] || 'NOTE') as any,
                            description: event.description,
                            location: event.location,
                            photoUrl: event.photoUrl,
                        }
                    });
                }

                await tx.orderHistory.create({
                    data: {
                        orderId: newOrder.id,
                        eventType: 'CREATED',
                        description: `Pedido criado automaticamente quando demanda foi convertida/possuída (${status})`,
                        location: location || updatedDemand.origin,
                    }
                });

                return updatedDemand;
            }

            // 3. Otherwise, just update demand status normally (PENDING, QUOTED, APPROVED, etc.)
            const updatedDemand = await tx.demand.update({
                where: { id },
                data: { status: targetDemandStatus },
                include: { order: true }
            });

            await tx.demandEvent.create({
                data: {
                    demandId: id,
                    status: targetDemandStatus,
                    description: description || `Status da demanda atualizado para ${targetDemandStatus}`,
                    location,
                    photoUrl,
                }
            });

            return updatedDemand;
        });

        const fullDemand = await prisma.demand.findUnique({
            where: { id },
            include: {
                order: true,
                events: {
                    orderBy: { createdAt: 'desc' },
                    take: 5
                }
            }
        });

        res.json({
            success: true,
            data: fullDemand,
        });
    } catch (error) {
        next(error);
    }
});


// PATCH /api/demands/:id/quote - Quote a demand (Admin)
router.patch('/:id/quote', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { price, tableId } = req.body;

        if (!price || price <= 0) {
            throw new AppError('Valid price is required', 400);
        }

        const demand = await prisma.demand.update({
            where: { id: id },
            data: {
                quotedPrice: price,
                quotedAt: new Date(),
                quotedTableId: tableId,
                status: 'QUOTED',
            },
        });

        await prisma.demandEvent.create({
            data: {
                demandId: id,
                status: 'QUOTED',
                description: `Cotação enviada: R$ ${price.toFixed(2)}`,
                location: demand.origin,
            }
        });

        res.json({
            success: true,
            data: demand,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/demands/:id/events - Get demand timeline
router.get('/:id/events', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const events = await prisma.demandEvent.findMany({
            where: { demandId: id },
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            success: true,
            data: events,
        });
    } catch (error) {
        next(error);
    }
});

export { router as demandsRouter };
