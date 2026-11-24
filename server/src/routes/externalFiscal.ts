import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { externalNumberingSummary, importExternalFiscalXml, type ImportOutcome } from '../services/fiscal/external/importExternalFiscal.js';
import { buildNumberingStatus } from '../services/fiscal/external/numberingStatus.js';
import { CONTINGENCY_COLUMNS, loadContingencyRows, toContingencyCsv } from '../services/contingency/contingencyPackage.js';

/**
 * Arquivo fiscal externo (CT-e/MDF-e emitidos no sistema legado ou em contingência) e conferência
 * de numeração. Só ADMIN (torre). Montado em /api/fiscal.
 */
const router = Router();
// Autorização por rota (não `router.use`): o router é montado em /api/fiscal junto de outros que
// atendem HUB — um `use` aqui barraria essas rotas.
const adminOnly = [authenticate, authorize('ADMIN')];

const importSchema = z.object({
    files: z.array(z.object({ name: z.string().max(300).optional(), xml: z.string().min(1) })).min(1).max(50),
    sourceSystem: z.string().trim().max(40).optional(),
    sourceNote: z.string().trim().max(500).optional(),
});

// POST /api/fiscal/external-documents/import — até 50 XMLs por chamada (carga em massa: script).
// Documentos primeiro, eventos depois (evento de documento ainda não importado volta como órfão).
router.post('/external-documents/import', ...adminOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const body = importSchema.parse(req.body);
        const isEvent = (xml: string) => /<procEvento(CTe|MDFe)\b/.test(xml);
        const ordered = [...body.files.filter((f) => !isEvent(f.xml)), ...body.files.filter((f) => isEvent(f.xml))];
        const results: Array<ImportOutcome & { name?: string }> = [];
        for (const file of ordered) {
            const outcome = await importExternalFiscalXml(file.xml, {
                sourceSystem: body.sourceSystem ?? 'LEGADO',
                sourceNote: body.sourceNote ?? null,
                importedByUserId: req.user!.id,
            });
            results.push({ ...outcome, name: file.name });
        }
        const counts = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.result]: (acc[r.result] ?? 0) + 1 }), {});
        res.json({ success: true, data: { counts, results } });
    } catch (error) {
        next(error);
    }
});

const listSchema = z.object({
    q: z.string().trim().max(60).optional(),
    model: z.enum(['CTE', 'MDFE']).optional(),
    status: z.enum(['AUTHORIZED', 'CANCELLED', 'CLOSED']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// GET /api/fiscal/external-documents — busca por chave, número ou documento de parte (sem o XML).
router.get('/external-documents', ...adminOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const q = listSchema.parse(req.query);
        const digits = q.q?.replace(/\D/g, '') ?? '';
        const issuedAt: Prisma.DateTimeFilter = {};
        if (q.from) issuedAt.gte = q.from;
        if (q.to) issuedAt.lte = q.to;
        const where: Prisma.ExternalFiscalDocumentWhereInput = {
            ...(q.model ? { model: q.model } : {}),
            ...(q.status ? { status: q.status } : {}),
            ...(Object.keys(issuedAt).length ? { issuedAt } : {}),
            ...(digits
                ? {
                    OR: [
                        { accessKey: digits },
                        ...(digits.length <= 9 ? [{ number: Number(digits) }] : []),
                        { senderDocument: digits },
                        { recipientDocument: digits },
                        { takerDocument: digits },
                    ],
                }
                : {}),
        };
        const [total, rows] = await Promise.all([
            prisma.externalFiscalDocument.count({ where }),
            prisma.externalFiscalDocument.findMany({
                where,
                orderBy: { issuedAt: 'desc' },
                skip: (q.page - 1) * q.pageSize,
                take: q.pageSize,
                omit: { xml: true },
            }),
        ]);
        res.json({ success: true, data: rows, total, page: q.page, pageSize: q.pageSize });
    } catch (error) {
        next(error);
    }
});

// GET /api/fiscal/external-documents/:accessKey/xml — devolve o XML autorizado original.
router.get('/external-documents/:accessKey/xml', ...adminOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accessKey = String(req.params.accessKey).replace(/\D/g, '');
        const doc = await prisma.externalFiscalDocument.findUnique({ where: { accessKey }, select: { xml: true, model: true } });
        if (!doc) throw new AppError('Documento não encontrado no arquivo externo.', 404);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${accessKey}-${doc.model === 'CTE' ? 'cte' : 'mdfe'}.xml"`);
        res.send(doc.xml);
    } catch (error) {
        next(error);
    }
});

// GET /api/fiscal/numbering — conferência de série/número por emitente × arquivo do legado.
router.get('/numbering', ...adminOnly, async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const [emitters, external] = await Promise.all([
            prisma.fiscalEmitter.findMany({
                where: { active: true },
                select: {
                    id: true, displayName: true, environment: true, cteSeries: true, lastCteNumber: true, mdfeSeries: true, lastMdfeNumber: true,
                    person: { select: { document: true, legalName: true } },
                },
            }),
            externalNumberingSummary(),
        ]);
        res.json({ success: true, data: buildNumberingStatus(emitters, external) });
    } catch (error) {
        next(error);
    }
});

// GET /api/fiscal/contingency.csv — pacote de contingência (pedidos e viagens em aberto, com os
// documentos fiscais) para reabrir a operação no sistema legado. `?hub=CODIGO` filtra um hub.
router.get('/contingency.csv', ...adminOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const hub = typeof req.query.hub === 'string' && req.query.hub.trim() ? req.query.hub.trim().toUpperCase() : undefined;
        const rows = await loadContingencyRows(hub);
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="contingencia-${hub ?? 'todos'}-${stamp}.csv"`);
        res.send(toContingencyCsv(rows, CONTINGENCY_COLUMNS));
    } catch (error) {
        next(error);
    }
});

export { router as externalFiscalRouter };
