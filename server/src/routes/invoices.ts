import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { getOrderFreightValue, getOfficialFreightTotal } from '../services/pricingService.js';

const router = Router();

// Helper function to generate invoice number
async function generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const lastInvoice = await prisma.invoice.findFirst({
        where: {
            invoiceNumber: {
                startsWith: `FAT-${year}-`
            }
        },
        orderBy: {
            invoiceNumber: 'desc'
        }
    });

    let nextNumber = 1;
    if (lastInvoice) {
        const match = lastInvoice.invoiceNumber.match(/FAT-\d{4}-(\d+)/);
        if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
        }
    }

    return `FAT-${year}-${nextNumber.toString().padStart(3, '0')}`;
}

// ==================== GET INVOICES ====================

// GET /api/invoices - List invoices
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { status, accountId, limit = '50', offset = '0' } = req.query;

        const where: any = {};
        
        if (status) {
            where.status = status as string;
        }

        // Clients can only see invoices from their account
        if (req.user!.roles.includes('CLIENT')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { account: true }
            });
            
            if (!user || !user.accountId) {
                throw new AppError('Account not found', 404);
            }

            where.accountId = user.accountId;
        } else if (accountId) {
            // Admin filtering by account
            where.accountId = accountId as string;
        }

        const invoices = await prisma.invoice.findMany({
            where,
            include: {
                account: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                order: {
                    include: {
                        demand: {
                            select: {
                                id: true,
                                origin: true,
                                destination: true
                            }
                        }
                    }
                },
                demand: {
                    select: {
                        id: true,
                        origin: true,
                        destination: true
                    }
                },
                manifest: {
                    select: {
                        id: true,
                        origin: true,
                        destination: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit as string),
            skip: parseInt(offset as string),
        });

        res.json({
            success: true,
            data: invoices,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/invoices/:id - Get single invoice
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: {
                account: true,
                order: {
                    include: {
                        demand: true,
                        opportunity: true
                    }
                },
                demand: {
                    include: {
                        client: true
                    }
                },
                manifest: {
                    include: {
                        link: true,
                        legs: {
                            include: {
                                order: {
                                    include: {
                                        demand: {
                                            include: {
                                                client: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!invoice) {
            throw new AppError('Invoice not found', 404);
        }

        // Check authorization for clients
        if (req.user!.roles.includes('CLIENT')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { account: true }
            });
            
            if (!user || !user.accountId || invoice.accountId !== user.accountId) {
                throw new AppError('Not authorized', 403);
            }
        }

        const mappedInvoice = {
            ...invoice,
            manifest: invoice.manifest ? {
                ...invoice.manifest,
                demands: (invoice.manifest as any).legs?.map((leg: any) => leg.order?.demand).filter(Boolean) || [],
                legs: undefined,
            } : null
        };

        res.json({
            success: true,
            data: mappedInvoice,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== CREATE INVOICE ====================

// POST /api/invoices - Create single invoice
router.post('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            orderId: z.string().uuid().optional(),
            demandId: z.string().uuid().optional(),
            manifestId: z.string().uuid().optional(),
            accountId: z.string().uuid(),
            subtotal: z.number().positive().optional(),
            taxes: z.number().min(0).default(0),
            discounts: z.number().min(0).default(0),
            dueDate: z.string().datetime().optional(),
            notes: z.string().optional(),
        }).superRefine((val, ctx) => {
            if (!val.orderId && val.subtotal === undefined) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Subtotal is required when not linked to an order',
                    path: ['subtotal'],
                });
            }
        });

        const data = schema.parse(req.body);

        // Validate that at least one relationship is provided
        if (!data.orderId && !data.demandId && !data.manifestId) {
            throw new AppError('At least one of orderId, demandId, or manifestId must be provided', 400);
        }

        // Validate account exists
        const account = await prisma.account.findUnique({
            where: { id: data.accountId }
        });

        if (!account) {
            throw new AppError('Account not found', 404);
        }

        // Derive subtotal for order-linked invoices from official calculation
        let subtotal = data.subtotal;
        if (data.orderId) {
            const officialFreight = await getOfficialFreightTotal(data.orderId);
            if (officialFreight === null) {
                throw new AppError("Pedido sem cálculo de frete oficial; emita o CT-e/minuta antes de faturar", 400);
            }
            subtotal = officialFreight;
        }

        // Calculate total
        const total = subtotal! + data.taxes - data.discounts;

        // Generate invoice number
        const invoiceNumber = await generateInvoiceNumber();

        // Create invoice
        const invoice = await prisma.invoice.create({
            data: {
                invoiceNumber,
                orderId: data.orderId,
                demandId: data.demandId,
                manifestId: data.manifestId,
                accountId: data.accountId,
                subtotal: subtotal!,
                taxes: data.taxes,
                discounts: data.discounts,
                total,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                notes: data.notes,
            },
            include: {
                account: true,
                order: true,
                demand: true,
                manifest: true
            }
        });

        res.status(201).json({
            success: true,
            data: invoice,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/invoices/batch - Create multiple invoices
router.post('/batch', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            invoices: z.array(z.object({
                orderId: z.string().uuid().optional(),
                demandId: z.string().uuid().optional(),
                manifestId: z.string().uuid().optional(),
                accountId: z.string().uuid(),
                subtotal: z.number().positive().optional(),
                taxes: z.number().min(0).default(0),
                discounts: z.number().min(0).default(0),
                dueDate: z.string().datetime().optional(),
                notes: z.string().optional(),
            })).min(1, 'At least one invoice is required'),
        }).superRefine((val, ctx) => {
            val.invoices.forEach((inv, index) => {
                if (!inv.orderId && inv.subtotal === undefined) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: 'Subtotal is required when not linked to an order',
                        path: ['invoices', index, 'subtotal'],
                    });
                }
            });
        });

        const { invoices } = schema.parse(req.body);

        // Validate all accounts exist
        const accountIds = [...new Set(invoices.map(inv => inv.accountId))];
        const accounts = await prisma.account.findMany({
            where: { id: { in: accountIds } }
        });

        if (accounts.length !== accountIds.length) {
            throw new AppError('One or more accounts not found', 404);
        }

        // Create invoices in transaction
        const createdInvoices = await prisma.$transaction(async (tx) => {
            const results = [];

            for (const invData of invoices) {
                // Validate that at least one relationship is provided
                if (!invData.orderId && !invData.demandId && !invData.manifestId) {
                    throw new AppError('At least one of orderId, demandId, or manifestId must be provided for each invoice', 400);
                }

                // Derive subtotal for order-linked invoices from official calculation
                let subtotal = invData.subtotal;
                if (invData.orderId) {
                    const officialFreight = await getOfficialFreightTotal(invData.orderId, tx);
                    if (officialFreight === null) {
                        throw new AppError(`Pedido sem cálculo de frete oficial; emita o CT-e/minuta antes de faturar para o pedido ${invData.orderId}`, 400);
                    }
                    subtotal = officialFreight;
                }

                const total = subtotal! + invData.taxes - invData.discounts;
                const invoiceNumber = await generateInvoiceNumber();

                const invoice = await tx.invoice.create({
                    data: {
                        invoiceNumber,
                        orderId: invData.orderId,
                        demandId: invData.demandId,
                        manifestId: invData.manifestId,
                        accountId: invData.accountId,
                        subtotal: subtotal!,
                        taxes: invData.taxes,
                        discounts: invData.discounts,
                        total,
                        dueDate: invData.dueDate ? new Date(invData.dueDate) : null,
                        notes: invData.notes,
                    }
                });

                results.push(invoice);
            }

            return results;
        });

        res.status(201).json({
            success: true,
            data: createdInvoices,
            count: createdInvoices.length,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== UPDATE INVOICE ====================

// PATCH /api/invoices/:id/status - Update invoice status
router.patch('/:id/status', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const schema = z.object({
            status: z.enum(['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']),
            paidAt: z.string().datetime().optional(),
        });

        const data = schema.parse(req.body);

        const invoice = await prisma.invoice.findUnique({
            where: { id }
        });

        if (!invoice) {
            throw new AppError('Invoice not found', 404);
        }

        const updateData: any = {
            status: data.status
        };

        if (data.status === 'PAID' && data.paidAt) {
            updateData.paidAt = new Date(data.paidAt);
        } else if (data.status === 'PAID' && !invoice.paidAt) {
            updateData.paidAt = new Date();
        }

        const updated = await prisma.invoice.update({
            where: { id },
            data: updateData,
            include: {
                account: true,
                order: true,
                demand: true,
                manifest: true
            }
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

// PATCH /api/invoices/:id - Update invoice
router.patch('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const schema = z.object({
            subtotal: z.number().positive().optional(),
            taxes: z.number().min(0).optional(),
            discounts: z.number().min(0).optional(),
            dueDate: z.string().datetime().optional(),
            notes: z.string().optional(),
            pdfUrl: z.string().url().optional(),
        });

        const data = schema.parse(req.body);

        const invoice = await prisma.invoice.findUnique({
            where: { id }
        });

        if (!invoice) {
            throw new AppError('Invoice not found', 404);
        }

        // Block arbitrary manual subtotals for order-linked invoices on update
        if (data.subtotal !== undefined) {
            const orderId = invoice.orderId;
            if (orderId) {
                const officialFreight = await getOfficialFreightTotal(orderId);
                if (officialFreight === null) {
                    throw new AppError("Pedido sem cálculo de frete oficial; emita o CT-e/minuta antes de faturar", 400);
                }
                if (Math.abs(data.subtotal - officialFreight) > 0.01) {
                    throw new AppError(`Subtotal must match official calculated freight value of ${officialFreight}`, 400);
                }
            }
        }

        const updateData: any = {};

        if (data.subtotal !== undefined) updateData.subtotal = data.subtotal;
        if (data.taxes !== undefined) updateData.taxes = data.taxes;
        if (data.discounts !== undefined) updateData.discounts = data.discounts;
        if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
        if (data.notes !== undefined) updateData.notes = data.notes;
        if (data.pdfUrl !== undefined) updateData.pdfUrl = data.pdfUrl;

        // Recalculate total if any value changed
        if (data.subtotal !== undefined || data.taxes !== undefined || data.discounts !== undefined) {
            updateData.total = (updateData.subtotal || invoice.subtotal) + 
                             (updateData.taxes || invoice.taxes) - 
                             (updateData.discounts || invoice.discounts);
        }

        const updated = await prisma.invoice.update({
            where: { id },
            data: updateData,
            include: {
                account: true,
                order: true,
                demand: true,
                manifest: true
            }
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

export { router as invoicesRouter };
