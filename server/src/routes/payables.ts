import { Router, type Response, type NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
router.use(authenticate, authorize('ADMIN'));

const money = z.number().positive().refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, 'Use valor em centavos.');
const paidAmount = (payments: Array<{ amount: Prisma.Decimal }>) => payments.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));

router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const rows = await prisma.payable.findMany({ include: { payments: { where: { reversedAt: null }, select: { amount: true } } }, orderBy: { dueDate: 'asc' }, take: 200 });
        res.json({ success: true, data: rows.map(({ payments, ...row }) => ({ ...row, paid: paidAmount(payments).toNumber(), balance: row.amount.minus(paidAmount(payments)).toNumber() })) });
    } catch (error) { next(error); }
});

router.get('/settlement-candidates', async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const manifests = await prisma.manifest.findMany({
            where: { status: 'COMPLETED', linkId: { not: null }, freightAgreement: { isNot: null }, payables: { none: { sourceType: 'MANIFEST' } } },
            select: { id: true, origin: true, destination: true, link: { select: { name: true } }, freightAgreement: { select: { saldoLiquido: true } } },
            orderBy: { completedAt: 'desc' }, take: 100,
        });
        res.json({ success: true, data: manifests.filter((manifest) => (manifest.freightAgreement?.saldoLiquido ?? 0) > 0) });
    } catch (error) { next(error); }
});

router.get('/settlement/:manifestId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const manifestId = req.params.manifestId as string;
        const agreement = await prisma.manifestFreightAgreement.findUnique({ where: { manifestId } });
        if (!agreement) throw new AppError('Carta Frete da viagem não encontrada.', 404);
        const payable = await prisma.payable.findUnique({ where: { sourceType_sourceId: { sourceType: 'MANIFEST', sourceId: manifestId } }, include: { payments: { where: { reversedAt: null }, select: { amount: true } } } });
        const paid = payable ? paidAmount(payable.payments) : new Prisma.Decimal(0);
        res.json({ success: true, data: {
            manifestId, freteBruto: agreement.freteBruto, pedagio: agreement.pedagio,
            adiantamento: agreement.adiantamento,
            retentions: { irrf: agreement.irrf, inss: agreement.inss, issqn: agreement.issqn, sestSenat: agreement.sestSenat, outrosDescontos: agreement.outrosDescontos },
            saldoLiquido: agreement.saldoLiquido, payableId: payable?.id ?? null,
            paid: paid.toNumber(), balance: new Prisma.Decimal(agreement.saldoLiquido.toFixed(2)).minus(paid).toNumber(),
        } });
    } catch (error) { next(error); }
});

router.post('/from-manifest/:manifestId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const manifestId = req.params.manifestId as string;
        const { dueDate } = z.object({ dueDate: z.string().datetime() }).parse(req.body);
        const manifest = await prisma.manifest.findUnique({ where: { id: manifestId }, select: { status: true, link: { select: { name: true, document: true } }, freightAgreement: true } });
        if (!manifest) throw new AppError('Viagem não encontrada.', 404);
        if (manifest.status !== 'COMPLETED') throw new AppError('Conclua a viagem antes de gerar o acerto.', 409);
        if (!manifest.link || !manifest.freightAgreement) throw new AppError('Defina Link e Carta Frete antes de gerar o acerto.', 400);
        const amount = manifest.freightAgreement.saldoLiquido;
        if (!(amount > 0)) throw new AppError('Saldo líquido da Carta Frete deve ser positivo para gerar título.', 400);
        const existing = await prisma.payable.findUnique({ where: { sourceType_sourceId: { sourceType: 'MANIFEST', sourceId: manifestId } } });
        if (existing) {
            if (!existing.amount.equals(new Prisma.Decimal(amount.toFixed(2)))) throw new AppError('Carta Frete alterada após gerar o título. Concilie antes de atualizar.', 409);
            return res.json({ success: true, data: existing });
        }
        let payable;
        try {
            payable = await prisma.payable.create({ data: {
                beneficiaryType: 'LINK', beneficiaryName: manifest.link.name, beneficiaryDocument: manifest.link.document,
                sourceType: 'MANIFEST', sourceId: manifestId, manifestId,
                description: `Acerto da viagem ${manifestId.slice(0, 8)}`,
                amount: new Prisma.Decimal(amount.toFixed(2)), dueDate: new Date(dueDate),
            } });
        } catch (error) {
            if ((error as { code?: string }).code !== 'P2002') throw error;
            const concurrent = await prisma.payable.findUnique({ where: { sourceType_sourceId: { sourceType: 'MANIFEST', sourceId: manifestId } } });
            if (!concurrent) throw error;
            if (!concurrent.amount.equals(new Prisma.Decimal(amount.toFixed(2)))) throw new AppError('Acerto simultâneo divergiu da Carta Frete. Concilie o título.', 409);
            return res.json({ success: true, data: concurrent });
        }
        res.status(201).json({ success: true, data: payable });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const input = z.object({
            beneficiaryType: z.enum(['LINK', 'PARTNER', 'HUB', 'OTHER']),
            beneficiaryName: z.string().trim().min(2).max(160),
            beneficiaryDocument: z.string().trim().max(30).optional(),
            description: z.string().trim().min(3).max(500),
            amount: money, dueDate: z.string().datetime(),
        }).parse(req.body);
        const payable = await prisma.payable.create({ data: {
            beneficiaryType: input.beneficiaryType, beneficiaryName: input.beneficiaryName,
            beneficiaryDocument: input.beneficiaryDocument, description: input.description,
            amount: new Prisma.Decimal(input.amount.toFixed(2)), dueDate: new Date(input.dueDate),
            sourceType: 'MANUAL',
        } });
        res.status(201).json({ success: true, data: payable });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.get('/:id/payments', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const payable = await prisma.payable.findUnique({ where: { id: req.params.id as string }, include: { payments: { orderBy: { paidAt: 'desc' } } } });
        if (!payable) throw new AppError('Título não encontrado.', 404);
        const paid = paidAmount(payable.payments.filter((item) => !item.reversedAt));
        res.json({ success: true, data: { payable, paid: paid.toNumber(), balance: payable.amount.minus(paid).toNumber() } });
    } catch (error) { next(error); }
});

router.post('/:id/payments', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const input = z.object({ amount: money, paidAt: z.string().datetime().optional(), reference: z.string().trim().max(160).optional(), evidenceStorageKey: z.string().trim().max(500).optional(), idempotencyKey: z.string().uuid() }).parse(req.body);
        const payment = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Payable" WHERE id = ${id} FOR UPDATE`;
            const payable = await tx.payable.findUnique({ where: { id } });
            if (!payable) throw new AppError('Título não encontrado.', 404);
            const previous = await tx.payablePayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
            if (previous) {
                if (previous.payableId !== id) throw new AppError('Identificador de pagamento já utilizado.', 409);
                return previous;
            }
            if (payable.status === 'CANCELLED') throw new AppError('Título cancelado não pode ser pago.', 409);
            const active = await tx.payablePayment.findMany({ where: { payableId: id, reversedAt: null }, select: { amount: true } });
            const paid = paidAmount(active);
            const amount = new Prisma.Decimal(input.amount.toFixed(2));
            if (amount.greaterThan(payable.amount.minus(paid))) throw new AppError('Pagamento excede o saldo do título.', 400);
            const created = await tx.payablePayment.create({ data: { payableId: id, amount, paidAt: input.paidAt ? new Date(input.paidAt) : new Date(), reference: input.reference, evidenceStorageKey: input.evidenceStorageKey, idempotencyKey: input.idempotencyKey, createdByUserId: req.user!.id } });
            if (paid.plus(amount).equals(payable.amount)) await tx.payable.update({ where: { id }, data: { status: 'PAID' } });
            return created;
        });
        res.status(201).json({ success: true, data: payment });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.post('/:id/payments/:paymentId/reverse', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const paymentId = req.params.paymentId as string;
        const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Payable" WHERE id = ${id} FOR UPDATE`;
            const payable = await tx.payable.findUnique({ where: { id } });
            if (!payable) throw new AppError('Título não encontrado.', 404);
            const reversed = await tx.payablePayment.updateMany({ where: { id: paymentId, payableId: id, reversedAt: null }, data: { reversedAt: new Date(), reversedByUserId: req.user!.id, reversalReason: reason } });
            if (!reversed.count) throw new AppError('Pagamento ativo não encontrado.', 404);
            await tx.payable.update({ where: { id }, data: { status: 'PENDING' } });
        });
        res.json({ success: true });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

export { router as payablesRouter };
