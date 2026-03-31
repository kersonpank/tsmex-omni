import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

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
        const { status, clientId, destination, limit = '50', offset = '0' } = req.query;

        // Clients can see all demands from their Account (all CNPJs)
        let clientFilter: any = clientId ? { clientId: clientId as string } : {};
        let hubFilter: any = {};
        if (req.user!.roles.includes('HUB') && req.user!.hubId) {
            hubFilter = {
                OR: [
                    { manifest: { hubId: req.user!.hubId } },
                    { order: { currentHubId: req.user!.hubId } },
                ],
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
                ...(status ? { status: status as any } : {}),
                ...(destination ? { destination: { contains: destination as string, mode: 'insensitive' } } : {}),
            },
            include: {
                client: {
                    select: { companyName: true }
                },
                manifest: {
                    select: { id: true, status: true, link: { select: { name: true } } }
                },
            },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit as string),
            skip: parseInt(offset as string),
        });

        const total = await prisma.demand.count({
            where: {
                ...clientFilter,
                ...hubFilter,
                ...(status ? { status: status as any } : {}),
            },
        });

        res.json({
            success: true,
            data: demands,
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
                status: { in: ['PENDING', 'QUOTED', 'APPROVED'] },
                manifestId: null,
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
                manifest: {
                    include: {
                        link: true,
                        vehicleType: true,
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

        res.json({
            success: true,
            data: demand,
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

        const demand = await prisma.demand.create({
            data: {
                ...data,
                clientId,
                cubedWeight,
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

                const demand = await tx.demand.create({
                    data: {
                        ...data,
                        clientId,
                        cubedWeight,
                        sourceType: 'BATCH',
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
            include: { manifest: true, order: true },
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
            if (!link || !existingDemand.manifestId || existingDemand.manifest?.linkId !== link.id) {
                throw new AppError('Not authorized: demand is not in your manifest', 403);
            }
            const linkAllowedStatuses = ['COLLECTED', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'];
            if (!linkAllowedStatuses.includes(status)) {
                throw new AppError('Not authorized to set this status', 403);
            }
        }

        const demand = await prisma.$transaction(async (tx) => {
            // Update demand
            const updatedDemand = await tx.demand.update({
                where: { id: id },
                data: { status },
                include: {
                    order: true
                }
            });

            // Create event
            await tx.demandEvent.create({
                data: {
                    demandId: id,
                    status,
                    description: description || `Status atualizado para ${status}`,
                    location,
                    photoUrl,
                }
            });

            // Create Order automatically when demand is COLLECTED or AT_HUB
            if ((status === 'COLLECTED' || status === 'AT_HUB') && !updatedDemand.order) {
                // Check if order already exists
                const existingOrder = await tx.order.findUnique({
                    where: { demandId: id }
                });

                if (!existingOrder) {
                    // Find opportunity that matches this demand (via matchedDemandId)
                    const matchingOpportunity = await tx.opportunity.findFirst({
                        where: { matchedDemandId: id }
                    });

                    const orderCurrentHubId = status === 'AT_HUB' ? (currentHubId || null) : null;

                    // Create order
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

                    // Import all DemandEvents as OrderHistory
                    const demandEvents = await tx.demandEvent.findMany({
                        where: { demandId: id },
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
                            description: `Pedido criado automaticamente quando demanda foi ${status === 'AT_HUB' ? 'entregue no HUB' : 'coletada'}`,
                            location: location || updatedDemand.origin,
                        }
                    });
                }
            }

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
