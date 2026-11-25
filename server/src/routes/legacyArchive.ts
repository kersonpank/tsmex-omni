import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { archiveLegacyRows, legacyArchiveSummary, parseLegacyExport, searchLegacyArchive } from '../services/legacyImport/legacyArchive.js';

/** Arquivo do sistema legado (histórico completo exportado de lá). Só ADMIN. Montado em /api/legacy-archive. */
const router = Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/summary', async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await legacyArchiveSummary() });
    } catch (error) {
        next(error);
    }
});

const searchSchema = z.object({
    entity: z.string().max(60).optional(),
    q: z.string().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(30),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const q = searchSchema.parse(req.query);
        res.json({ success: true, data: await searchLegacyArchive({ entity: q.entity || undefined, q: q.q, page: q.page, pageSize: q.pageSize }) });
    } catch (error) {
        next(error);
    }
});

const importSchema = z.object({
    entity: z.string().trim().min(1).max(60),
    content: z.string().min(1),
    fileName: z.string().max(300).optional(),
    format: z.enum(['csv', 'json']).optional(),
    collection: z.string().max(200).optional(),
    keyColumn: z.string().max(100).optional(),
});

// POST /api/legacy-archive/import — um arquivo exportado do legado (CSV ou JSON). Carga grande: script.
router.post('/import', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const body = importSchema.parse(req.body);
        let rows;
        try {
            rows = parseLegacyExport(body.content, { format: body.format, collection: body.collection });
        } catch (err) {
            throw new AppError(err instanceof Error ? err.message : 'Arquivo ilegível.', 400);
        }
        if (rows.length === 0) throw new AppError('O arquivo não tem linhas.', 400);
        try {
            res.json({ success: true, data: await archiveLegacyRows(body.entity, rows, { keyColumn: body.keyColumn || null, sourceFile: body.fileName ?? null }) });
        } catch (err) {
            if (err instanceof Error && /coluna-chave|tipo da listagem|não é única/.test(err.message)) throw new AppError(err.message, 400);
            throw err;
        }
    } catch (error) {
        next(error);
    }
});

export { router as legacyArchiveRouter };
