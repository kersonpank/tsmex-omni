import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { externalNumberingSummary, importExternalFiscalXml, type ImportOutcome } from '../services/fiscal/external/importExternalFiscal.js';
import { buildNumberingStatus } from '../services/fiscal/external/numberingStatus.js';
import { legacyArchiveNumberingSummary, mergeSeriesSummaries } from '../services/fiscal/external/legacyArchiveNumbering.js';
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
            numberingSources(),
        ]);
        res.json({ success: true, data: buildNumberingStatus(emitters, external) });
    } catch (error) {
        next(error);
    }
});

/** XML importado + histórico do legado (o que estiver mais à frente). */
async function numberingSources() {
    const [xml, archive] = await Promise.all([externalNumberingSummary(), legacyArchiveNumberingSummary()]);
    return mergeSeriesSummaries(xml, archive);
}

const continueSchema = z.object({
    model: z.enum(['CTE', 'MDFE']),
    /** Último número já usado na série (o TSM emite o seguinte). Confira na tela de Empresas do legado. */
    lastNumber: z.number().int().min(0).max(999_999_999),
});

// POST /api/fiscal/numbering/:emitterId/continue — o TSM continua a série do legado: grava o último
// número usado. Nunca volta (nem abaixo do TSM, nem abaixo do que o legado já usou na série).
router.post('/numbering/:emitterId/continue', ...adminOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const emitterId = z.string().uuid().parse(req.params.emitterId);
        const { model, lastNumber } = continueSchema.parse(req.body ?? {});
        const emitter = await prisma.fiscalEmitter.findUnique({
            where: { id: emitterId },
            select: { id: true, environment: true, cteSeries: true, lastCteNumber: true, mdfeSeries: true, lastMdfeNumber: true, person: { select: { document: true } } },
        });
        if (!emitter) throw new AppError('Emitente não encontrado.', 404);
        const cnpj = (emitter.person?.document ?? '').replace(/\D/g, '');
        const series = model === 'CTE' ? emitter.cteSeries : emitter.mdfeSeries;
        const tsmLast = model === 'CTE' ? emitter.lastCteNumber : emitter.lastMdfeNumber;
        const legacy = (await numberingSources()).find((x) => x.emitterCnpj === cnpj && x.model === model && x.series === series && x.environment === emitter.environment);
        const floor = Math.max(tsmLast, legacy?.lastNumber ?? 0);
        if (lastNumber < floor) {
            throw new AppError(`O último número não pode ficar abaixo de ${floor} (maior entre o TSM e o que o legado já usou na série ${series}).`, 400);
        }
        // Condição no where: se outra emissão reservou número no meio, não sobrescreve para trás.
        const field = model === 'CTE' ? 'lastCteNumber' : 'lastMdfeNumber';
        const updated = await prisma.fiscalEmitter.updateMany({
            where: { id: emitter.id, [field]: { lte: lastNumber } },
            data: { [field]: lastNumber },
        });
        if (updated.count === 0) throw new AppError('O emitente reservou um número maior enquanto você salvava. Atualize a tela e confira.', 409);
        res.json({ success: true, data: { model, series, lastNumber, nextNumber: lastNumber + 1 } });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0]?.message ?? 'Dados inválidos.', 400));
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
