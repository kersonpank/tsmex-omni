import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { getNextOrderNumber } from '../services/orderSequence.js';

const router = Router();

// ==================== GET OPPORTUNITIES ====================

// GET /api/opportunities - List opportunities (with filters)
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { accountId, stage, sessionId, limit = '50' } = req.query;

        const opportunities = await prisma.opportunity.findMany({
            where: {
                ...(accountId ? { accountId: accountId as string } : {}),
                ...(stage ? { stage: stage as any } : {}),
                ...(sessionId ? { sessionId: sessionId as string } : {}),
            },
            include: {
                account: {
                    include: {
                        companies: { where: { isPrimary: true }, take: 1 },
                        contacts: { where: { isPrimary: true }, take: 1 },
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit as string),
        });

        res.json({
            success: true,
            data: opportunities,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/opportunities/:id - Get single opportunity
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        const opportunity = await prisma.opportunity.findUnique({
            where: { id },
            include: {
                account: {
                    include: {
                        companies: true,
                        contacts: true,
                    }
                },
                orders: {
                    select: { id: true, status: true, createdAt: true, demand: { select: { orderNumber: true } } },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                },
            }
        });

        if (!opportunity) {
            throw new AppError('Opportunity not found', 404);
        }

        res.json({
            success: true,
            data: opportunity,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== CREATE OPPORTUNITY ====================

// POST /api/opportunities - Create opportunity
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            accountId: z.string().uuid(),
            sessionId: z.string(),
            type: z.enum(['QUOTE_ONLY', 'TRANSPORT', 'COLLECTION', 'BOTH']).default('QUOTE_ONLY'),
            source: z.enum(['CHAT', 'WHATSAPP', 'PHONE', 'EMAIL', 'MANUAL', 'FORM']).default('CHAT'),

            // Optional data
            origin: z.string().optional(),
            destination: z.string().optional(),
            commodity: z.string().optional(),
            weight: z.number().optional(),
            nfValue: z.number().optional(),
            volumes: z.number().int().optional(),
            dimensions: z.string().optional(),

            cpfCnpjSender: z.string().optional(),
            cpfCnpjReceiver: z.string().optional(),
            cpfCnpjTransportadora: z.string().optional(),
            accountRole: z.enum(['REMETENTE', 'DESTINATARIO', 'CONSIGNATARIO']).optional(),
            freightTerm: z.enum(['CIF', 'FOB', 'REDESPACHO']).optional(),

            needsCollection: z.boolean().default(false),
            collectionData: z.any().optional(),

            quotedPrice: z.number().optional(),
            quoteBreakdown: z.any().optional(),

            conversationSnapshot: z.array(z.any()).default([]),
        });

        const data = schema.parse(req.body);

        // Determine completeness
        let completeness: 'MINIMAL' | 'INCOMPLETE' | 'COMPLETE' = 'MINIMAL';
        if (data.origin && data.destination && data.weight && data.nfValue && data.volumes) {
            completeness = 'COMPLETE';
        } else if (data.origin && data.destination && (data.weight || data.nfValue)) {
            completeness = 'INCOMPLETE';
        }

        // Schedule follow-up (24 hours from now)
        const nextFollowUp = new Date();
        nextFollowUp.setHours(nextFollowUp.getHours() + 24);

        const opportunity = await prisma.opportunity.create({
            data: {
                ...data,
                completeness,
                stage: data.quotedPrice ? 'QUOTE' : 'QUOTE',
                nextFollowUp,
            },
            include: {
                account: true,
            }
        });

        res.status(201).json({
            success: true,
            data: opportunity,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== UPDATE OPPORTUNITY ====================

// PATCH /api/opportunities/:id - Update opportunity
router.patch('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        const schema = z.object({
            stage: z.enum(['QUOTE', 'FOLLOW_UP', 'COLLECTION_REQUESTED', 'CONVERTED', 'LOST']).optional(),
            type: z.enum(['QUOTE_ONLY', 'TRANSPORT', 'COLLECTION', 'BOTH']).optional(),

            origin: z.string().optional(),
            destination: z.string().optional(),
            commodity: z.string().optional(),
            weight: z.number().optional(),
            nfValue: z.number().optional(),
            volumes: z.number().int().optional(),
            dimensions: z.string().optional(),

            cpfCnpjSender: z.string().optional(),
            cpfCnpjReceiver: z.string().optional(),
            cpfCnpjTransportadora: z.string().optional(),
            accountRole: z.enum(['REMETENTE', 'DESTINATARIO', 'CONSIGNATARIO']).optional(),
            freightTerm: z.enum(['CIF', 'FOB', 'REDESPACHO']).optional(),

            needsCollection: z.boolean().optional(),
            collectionData: z.any().optional(),

            quotedPrice: z.number().optional(),
            quoteBreakdown: z.any().optional(),

            matchedDemandId: z.string().uuid().optional(),
        });

        const data = schema.parse(req.body);

        const opportunity = await prisma.opportunity.update({
            where: { id },
            data,
            include: { account: true },
        });

        res.json({
            success: true,
            data: opportunity,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== CONVERT OPPORTUNITY TO DEMAND ====================

// POST /api/opportunities/:id/convert-to-demand - Convert opportunity to demand
router.post('/:id/convert-to-demand', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        // Get opportunity
        const opportunity = await prisma.opportunity.findUnique({
            where: { id },
            include: {
                account: {
                    include: {
                        companies: true,
                        clients: {
                            include: {
                                accountCompany: true
                            }
                        },
                        users: {
                            take: 1
                        },
                        contacts: {
                            take: 1
                        }
                    }
                }
            }
        });

        if (!opportunity) {
            throw new AppError('Opportunity not found', 404);
        }

        // Validate opportunity has complete data
        if (opportunity.completeness !== 'COMPLETE') {
            throw new AppError('Opportunity must have complete data (completeness = COMPLETE) to be converted', 400);
        }

        if (!opportunity.origin || !opportunity.destination || !opportunity.weight || !opportunity.nfValue || !opportunity.volumes) {
            throw new AppError('Opportunity missing required fields: origin, destination, weight, nfValue, volumes', 400);
        }

        // Find or create client
        let clientId: string;
        
        // Try to find client by CNPJ (sender or receiver)
        const cnpjToFind = opportunity.cpfCnpjSender || opportunity.cpfCnpjReceiver;
        
        if (cnpjToFind) {
            const accountCompany = await prisma.accountCompany.findUnique({
                where: { cnpj: cnpjToFind },
                include: {
                    clients: {
                        where: {
                            accountId: opportunity.accountId
                        },
                        take: 1
                    }
                }
            });

            if (accountCompany && accountCompany.clients.length > 0) {
                clientId = accountCompany.clients[0].id;
            } else {
                // Create client if not found
                const primaryCompany = opportunity.account.companies.find(c => c.isPrimary) || opportunity.account.companies[0];
                if (!primaryCompany) {
                    throw new AppError('No company found in account', 400);
                }

                const newClient = await prisma.client.create({
                    data: {
                        userId: opportunity.account.users[0]?.id || '',
                        accountId: opportunity.accountId,
                        accountCompanyId: primaryCompany.id,
                        companyName: accountCompany?.legalName || cnpjToFind,
                        document: cnpjToFind,
                        contactName: opportunity.account.contacts[0]?.name || 'Cliente',
                        phone: opportunity.account.contacts[0]?.phone || '',
                        defaultOrigin: opportunity.origin,
                    }
                });
                clientId = newClient.id;
            }
        } else {
            // Use first client from account
            if (opportunity.account.clients.length === 0) {
                throw new AppError('No client found in account. Please create a client first.', 400);
            }
            clientId = opportunity.account.clients[0].id;
        }

        // Calculate volume from dimensions if not provided
        let volume = 0;
        if (opportunity.dimensions) {
            try {
                const dims = JSON.parse(opportunity.dimensions);
                if (Array.isArray(dims)) {
                    volume = dims.reduce((sum: number, d: any) => {
                        const vol = (d.altura || 0) * (d.largura || 0) * (d.comprimento || 0) / 1000000; // cm³ to m³
                        return sum + (vol * (d.qty || 1));
                    }, 0);
                }
            } catch {
                // If parsing fails, use default calculation
                volume = (opportunity.weight || 0) / 300; // Default 300 kg/m³
            }
        } else {
            volume = (opportunity.weight || 0) / 300; // Default 300 kg/m³
        }

        // Create demand
        const demand = await prisma.$transaction(async (tx) => {
            const orderNumber = await getNextOrderNumber(tx);
            const newDemand = await tx.demand.create({
                data: {
                    clientId,
                    orderNumber,
                    nfNumber: `NF-${Date.now()}`, // Temporary, should be provided
                    nfValue: opportunity.nfValue!,
                    origin: opportunity.origin!,
                    destination: opportunity.destination!,
                    commodity: opportunity.commodity || 'Mercadoria',
                    weight: opportunity.weight!,
                    volume,
                    units: opportunity.volumes!,
                    riskClass: 'B', // Default, can be improved
                    intentType: opportunity.needsCollection ? 'COLLECT' : 'QUOTE_ONLY',
                    status: 'APPROVED', // Already approved since converting
                    quotedPrice: opportunity.quotedPrice,
                    quotedAt: opportunity.quotedPrice ? new Date() : null,
                    sourceType: opportunity.source === 'FORM' ? 'FORM' : 'CHAT',
                }
            });

            // Create initial event
            await tx.demandEvent.create({
                data: {
                    demandId: newDemand.id,
                    status: 'APPROVED',
                    description: `Demanda criada a partir da oportunidade ${opportunity.id.slice(0, 8)}`,
                    location: opportunity.origin!,
                }
            });

            // Update opportunity
            await tx.opportunity.update({
                where: { id },
                data: {
                    stage: 'CONVERTED',
                    matchedDemandId: newDemand.id,
                }
            });

            return newDemand;
        });

        const fullDemand = await prisma.demand.findUnique({
            where: { id: demand.id },
            include: {
                client: true,
                events: true
            }
        });

        res.status(201).json({
            success: true,
            data: fullDemand,
            message: 'Opportunity converted to demand successfully',
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== SIMILAR OPPORTUNITIES ====================

// GET /api/opportunities/search/similar - Find similar opportunities
router.get('/search/similar', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { accountId, origin, destination, weight } = req.query;

        if (!accountId || !origin || !destination) {
            throw new AppError('accountId, origin, and destination are required', 400);
        }

        const weightNum = weight ? parseFloat(weight as string) : undefined;
        const weightMin = weightNum ? weightNum * 0.9 : undefined;
        const weightMax = weightNum ? weightNum * 1.1 : undefined;

        const opportunities = await prisma.opportunity.findMany({
            where: {
                accountId: accountId as string,
                origin: origin as string,
                destination: destination as string,
                ...(weightMin && weightMax ? {
                    weight: { gte: weightMin, lte: weightMax }
                } : {}),
                quotedPrice: { not: null },
                createdAt: {
                    gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
        });

        res.json({
            success: true,
            data: opportunities,
        });
    } catch (error) {
        next(error);
    }
});

export { router as opportunitiesRouter };
