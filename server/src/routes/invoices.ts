import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { getOrderFreightValue, getOfficialFreightTotal } from '../services/pricingService.js';
import { resourceGuard, uuidParam } from '../middleware/resourceAccess.js';
import { Prisma } from '@prisma/client';

const router = Router();
const decimalMoney = (value: number) => new Prisma.Decimal(value.toFixed(2));

// Anti-IDOR: fatura por id só ADMIN ou a conta dona (CLIENT).
router.use(uuidParam(), ...resourceGuard('invoice'));

// Helper function to generate invoice number
async function generateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    // Lock is scoped to the transaction. Concurrent operators cannot reserve the same year/number.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${year}, 742301)`;
    const rows = await tx.$queryRaw<Array<{ lastNumber: bigint }>>`
        SELECT COALESCE(MAX(split_part("invoiceNumber", '-', 3)::BIGINT), 0)::BIGINT AS "lastNumber"
        FROM "Invoice"
        WHERE "invoiceNumber" ~ ${`^FAT-${year}-[0-9]+$`}
    `;
    const nextNumber = Number(rows[0]?.lastNumber ?? 0n) + 1;

    return `FAT-${year}-${nextNumber.toString().padStart(3, '0')}`;
}

// ==================== GET INVOICES ====================

router.get('/eligible-orders', authenticate, authorize('ADMIN'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orders = await prisma.order.findMany({
            where: {
                status: { not: 'CANCELLED' },
                invoices: { none: { status: { not: 'CANCELLED' } } },
                invoiceItems: { none: { invoice: { status: { not: 'CANCELLED' } } } },
                freightCalculations: { some: { status: { in: ['CTE_AUTHORIZED', 'DCE_AUTHORIZED', 'MINUTA_EMITTED'] } } },
            },
            select: {
                id: true, nfNumber: true,
                demand: { select: { client: { select: { companyName: true, accountId: true } } } },
                freightCalculations: {
                    where: { status: { in: ['CTE_AUTHORIZED', 'DCE_AUTHORIZED', 'MINUTA_EMITTED'] } },
                    orderBy: { createdAt: 'desc' }, take: 1, select: { freightTotal: true },
                },
            },
            orderBy: { createdAt: 'desc' }, take: 100,
        });
        res.json({ success: true, data: orders.flatMap((order) => {
            const accountId = order.demand.client?.accountId;
            const amount = order.freightCalculations[0]?.freightTotal;
            return accountId && amount && amount > 0 ? [{ id: order.id, nfNumber: order.nfNumber, clientName: order.demand.client?.companyName, accountId, amount }] : [];
        }) });
    } catch (error) { next(error); }
});

// GET /api/invoices - List invoices
router.get('/', authenticate, authorize('ADMIN', 'CLIENT'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { status, accountId, limit = '50', offset = '0' } = req.query;

        const where: any = {};
        
        if (status) {
            where.status = status as string;
        }

        // Clients can only see invoices from their account
        if (req.user!.roles.includes('CLIENT') && !req.user!.roles.includes('ADMIN')) {
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
                items: { include: { order: { select: { nfNumber: true } } } },
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
router.get('/:id', authenticate, authorize('ADMIN', 'CLIENT'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: {
                account: true,
                items: { include: { order: { select: { nfNumber: true } } } },
                order: {
                    select: {
                        id: true, nfNumber: true,
                        demand: { select: { id: true, origin: true, destination: true } },
                    }
                },
                demand: {
                    select: { id: true, origin: true, destination: true }
                },
                manifest: { select: { id: true, origin: true, destination: true } }
            }
        });

        if (!invoice) {
            throw new AppError('Invoice not found', 404);
        }

        // Check authorization for clients
        if (req.user!.roles.includes('CLIENT') && !req.user!.roles.includes('ADMIN')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { account: true }
            });
            
            if (!user || !user.accountId || invoice.accountId !== user.accountId) {
                throw new AppError('Not authorized', 403);
            }
        }

        res.json({
            success: true,
            data: invoice,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== CREATE INVOICE ====================

router.post('/group', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const input = z.object({
            accountId: z.string().uuid(),
            orderIds: z.array(z.string().uuid()).min(2),
            dueDate: z.string().datetime().optional(),
            notes: z.string().max(1000).optional(),
        }).parse(req.body);
        if (new Set(input.orderIds).size !== input.orderIds.length) throw new AppError('Pedido repetido no agrupamento.', 400);
        const created = await prisma.$transaction(async (tx) => {
            const invoiceNumber = await generateInvoiceNumber(tx);
            const account = await tx.account.findUnique({ where: { id: input.accountId }, select: { id: true } });
            if (!account) throw new AppError('Conta não encontrada.', 404);
            const orders = await tx.order.findMany({ where: { id: { in: input.orderIds } }, select: { id: true, nfNumber: true, demand: { select: { client: { select: { accountId: true } } } } } });
            if (orders.length !== input.orderIds.length) throw new AppError('Um ou mais pedidos não foram encontrados.', 404);
            if (orders.some((order) => order.demand.client?.accountId !== input.accountId)) throw new AppError('Todos os pedidos devem ter o mesmo pagador da fatura.', 400);
            const [legacy, billed] = await Promise.all([
                tx.invoice.findFirst({ where: { orderId: { in: input.orderIds }, status: { not: 'CANCELLED' } }, select: { id: true } }),
                tx.invoiceItem.findFirst({ where: { orderId: { in: input.orderIds }, invoice: { status: { not: 'CANCELLED' } } }, select: { id: true } }),
            ]);
            if (legacy || billed) throw new AppError('Um dos pedidos já está em fatura ativa.', 409);
            const items = [];
            for (const order of orders) {
                const freight = await getOfficialFreightTotal(order.id, tx);
                if (freight === null) throw new AppError(`Pedido ${order.nfNumber ?? order.id} sem frete confirmado.`, 400);
                items.push({ orderId: order.id, description: `Frete do pedido ${order.nfNumber ?? order.id.slice(0, 8)}`, amount: new Prisma.Decimal(freight.toFixed(2)) });
            }
            const subtotal = items.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
            return tx.invoice.create({ data: {
                invoiceNumber, accountId: input.accountId,
                subtotal, taxes: new Prisma.Decimal(0), discounts: new Prisma.Decimal(0), total: subtotal,
                dueDate: input.dueDate ? new Date(input.dueDate) : null, notes: input.notes,
                items: { create: items },
            }, include: { items: true } });
        });
        res.status(201).json({ success: true, data: created });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

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
            const order = await prisma.order.findUnique({ where: { id: data.orderId }, select: { demand: { select: { client: { select: { accountId: true } } } } } });
            if (!order) throw new AppError('Pedido não encontrado.', 404);
            if (!order.demand.client?.accountId || order.demand.client.accountId !== data.accountId) {
                throw new AppError('A conta da fatura não corresponde ao pagador do pedido.', 400);
            }
            const officialFreight = await getOfficialFreightTotal(data.orderId);
            if (officialFreight === null) {
                throw new AppError("Pedido sem cálculo de frete oficial; emita o CT-e/minuta antes de faturar", 400);
            }
            subtotal = officialFreight;
        }

        // Calculate total
        const subtotalAmount = decimalMoney(subtotal!);
        const taxesAmount = decimalMoney(data.taxes);
        const discountsAmount = decimalMoney(data.discounts);
        const total = subtotalAmount.plus(taxesAmount).minus(discountsAmount);
        if (total.lessThanOrEqualTo(0)) throw new AppError('Total da fatura deve ser positivo.', 400);

        // Generate invoice number
        // Number reservation and creation must commit together.
        const invoice = await prisma.$transaction(async (tx) => {
            const invoiceNumber = await generateInvoiceNumber(tx);
            if (data.orderId && await tx.invoice.findFirst({ where: { orderId: data.orderId, status: { not: 'CANCELLED' } }, select: { id: true } })) {
                throw new AppError('Este pedido já está vinculado a uma fatura ativa.', 409);
            }
            if (data.orderId && await tx.invoiceItem.findFirst({ where: { orderId: data.orderId, invoice: { status: { not: 'CANCELLED' } } }, select: { id: true } })) throw new AppError('Este pedido já está vinculado a uma fatura ativa.', 409);
            return tx.invoice.create({
            data: {
                invoiceNumber,
                orderId: data.orderId,
                demandId: data.demandId,
                manifestId: data.manifestId,
                accountId: data.accountId,
                subtotal: subtotalAmount,
                taxes: taxesAmount,
                discounts: discountsAmount,
                total,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                notes: data.notes,
                ...(data.orderId ? { items: { create: { orderId: data.orderId, description: `Frete do pedido ${data.orderId.slice(0, 8)}`, amount: new Prisma.Decimal(subtotal!.toFixed(2)) } } } : {}),
            },
            include: {
                account: true,
                order: true,
                demand: true,
                manifest: true
            }
            });
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
                    const order = await tx.order.findUnique({ where: { id: invData.orderId }, select: { demand: { select: { client: { select: { accountId: true } } } } } });
                    if (!order) throw new AppError('Pedido não encontrado.', 404);
                    if (!order.demand.client?.accountId || order.demand.client.accountId !== invData.accountId) throw new AppError('A conta da fatura não corresponde ao pagador do pedido.', 400);
                    const officialFreight = await getOfficialFreightTotal(invData.orderId, tx);
                    if (officialFreight === null) {
                        throw new AppError(`Pedido sem cálculo de frete oficial; emita o CT-e/minuta antes de faturar para o pedido ${invData.orderId}`, 400);
                    }
                    subtotal = officialFreight;
                }

                const subtotalAmount = decimalMoney(subtotal!);
                const taxesAmount = decimalMoney(invData.taxes);
                const discountsAmount = decimalMoney(invData.discounts);
                const total = subtotalAmount.plus(taxesAmount).minus(discountsAmount);
                if (total.lessThanOrEqualTo(0)) throw new AppError('Total da fatura deve ser positivo.', 400);
                const invoiceNumber = await generateInvoiceNumber(tx);
                if (invData.orderId && await tx.invoice.findFirst({ where: { orderId: invData.orderId, status: { not: 'CANCELLED' } }, select: { id: true } })) {
                    throw new AppError('Este pedido já está vinculado a uma fatura ativa.', 409);
                }
                if (invData.orderId && await tx.invoiceItem.findFirst({ where: { orderId: invData.orderId, invoice: { status: { not: 'CANCELLED' } } }, select: { id: true } })) throw new AppError('Este pedido já está vinculado a uma fatura ativa.', 409);

                const invoice = await tx.invoice.create({
                    data: {
                        invoiceNumber,
                        orderId: invData.orderId,
                        demandId: invData.demandId,
                        manifestId: invData.manifestId,
                        accountId: invData.accountId,
                        subtotal: subtotalAmount,
                        taxes: taxesAmount,
                        discounts: discountsAmount,
                        total,
                        dueDate: invData.dueDate ? new Date(invData.dueDate) : null,
                        notes: invData.notes,
                        ...(invData.orderId ? { items: { create: { orderId: invData.orderId, description: `Frete do pedido ${invData.orderId.slice(0, 8)}`, amount: new Prisma.Decimal(subtotal!.toFixed(2)) } } } : {}),
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

const receiptSchema = z.object({
    amount: z.number().positive().refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, 'Use valor em centavos.'),
    receivedAt: z.string().datetime().optional(),
    reference: z.string().trim().max(160).optional(),
    evidenceStorageKey: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().uuid(),
});

router.get('/:id/receipts', authenticate, authorize('ADMIN', 'CLIENT'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id as string }, select: { total: true, receipts: { orderBy: { receivedAt: 'desc' } } } });
        if (!invoice) throw new AppError('Fatura não encontrada.', 404);
        const received = invoice.receipts.filter((item) => !item.reversedAt).reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
        res.json({ success: true, data: { receipts: invoice.receipts, received: received.toNumber(), balance: new Prisma.Decimal(invoice.total.toFixed(2)).minus(received).toNumber() } });
    } catch (error) { next(error); }
});

router.post('/:id/receipts', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const input = receiptSchema.parse(req.body);
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
            const invoice = await tx.invoice.findUnique({ where: { id }, select: { id: true, total: true, status: true, dueDate: true } });
            if (!invoice) throw new AppError('Fatura não encontrada.', 404);
            const previous = await tx.invoiceReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
            if (previous) {
                if (previous.invoiceId !== id) throw new AppError('Identificador de pagamento já utilizado.', 409);
                return previous;
            }
            if (invoice.status === 'CANCELLED') throw new AppError('Fatura cancelada não pode receber baixa.', 409);
            const active = await tx.invoiceReceipt.findMany({ where: { invoiceId: id, reversedAt: null }, select: { amount: true } });
            const received = active.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
            const total = invoice.total;
            const amount = new Prisma.Decimal(input.amount.toFixed(2));
            if (amount.greaterThan(total.minus(received))) throw new AppError('Valor excede o saldo da fatura.', 400);
            const receipt = await tx.invoiceReceipt.create({ data: { invoiceId: id, amount, receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(), reference: input.reference, evidenceStorageKey: input.evidenceStorageKey, idempotencyKey: input.idempotencyKey, createdByUserId: req.user!.id } });
            const fullyPaid = received.plus(amount).equals(total);
            await tx.invoice.update({ where: { id }, data: { status: fullyPaid ? 'PAID' : invoice.dueDate && invoice.dueDate < new Date() ? 'OVERDUE' : 'PENDING', paidAt: fullyPaid ? receipt.receivedAt : null } });
            return receipt;
        });
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.post('/:id/receipts/:receiptId/reverse', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const receiptId = req.params.receiptId as string;
        const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
            const invoice = await tx.invoice.findUnique({ where: { id }, select: { total: true, dueDate: true } });
            if (!invoice) throw new AppError('Fatura não encontrada.', 404);
            const updated = await tx.invoiceReceipt.updateMany({ where: { id: receiptId, invoiceId: id, reversedAt: null }, data: { reversedAt: new Date(), reversedByUserId: req.user!.id, reversalReason: reason } });
            if (!updated.count) throw new AppError('Recebimento ativo não encontrado.', 404);
            const active = await tx.invoiceReceipt.findMany({ where: { invoiceId: id, reversedAt: null }, select: { amount: true } });
            const received = active.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
            const fullyPaid = received.equals(invoice.total);
            await tx.invoice.update({ where: { id }, data: { status: fullyPaid ? 'PAID' : invoice.dueDate && invoice.dueDate < new Date() ? 'OVERDUE' : 'PENDING', paidAt: fullyPaid ? new Date() : null } });
        });
        res.json({ success: true });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// PATCH /api/invoices/:id/status - Update invoice status
router.patch('/:id/status', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const schema = z.object({
            status: z.enum(['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']),
            paidAt: z.string().datetime().optional(),
        });

        const data = schema.parse(req.body);
        if (data.status !== 'CANCELLED') throw new AppError('Use recebimentos e estornos para atualizar o saldo da fatura.', 400);

        const invoice = await prisma.invoice.findUnique({
            where: { id }
        });

        if (!invoice) {
            throw new AppError('Invoice not found', 404);
        }

        const activeReceipts = await prisma.invoiceReceipt.count({ where: { invoiceId: id, reversedAt: null } });
        if (activeReceipts) throw new AppError('Estorne os recebimentos antes de cancelar a fatura.', 409);

        const updateData: any = {
            status: data.status
        };

        updateData.paidAt = null;

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

        const receiptCount = await prisma.invoiceReceipt.count({ where: { invoiceId: id, reversedAt: null } });
        if (receiptCount && (data.subtotal !== undefined || data.taxes !== undefined || data.discounts !== undefined)) throw new AppError('Estorne os recebimentos antes de alterar valores.', 409);
        const itemCount = await prisma.invoiceItem.count({ where: { invoiceId: id } });
        if (itemCount && data.subtotal !== undefined) throw new AppError('Subtotal da fatura vinculada a pedidos não pode ser alterado manualmente.', 409);

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

        if (data.subtotal !== undefined) updateData.subtotal = decimalMoney(data.subtotal);
        if (data.taxes !== undefined) updateData.taxes = decimalMoney(data.taxes);
        if (data.discounts !== undefined) updateData.discounts = decimalMoney(data.discounts);
        if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
        if (data.notes !== undefined) updateData.notes = data.notes;
        if (data.pdfUrl !== undefined) updateData.pdfUrl = data.pdfUrl;

        // Recalculate total if any value changed
        if (data.subtotal !== undefined || data.taxes !== undefined || data.discounts !== undefined) {
            updateData.total = (updateData.subtotal ?? invoice.subtotal)
                .plus(updateData.taxes ?? invoice.taxes)
                .minus(updateData.discounts ?? invoice.discounts);
            if (updateData.total.lessThanOrEqualTo(0)) throw new AppError('Total da fatura deve ser positivo.', 400);
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
