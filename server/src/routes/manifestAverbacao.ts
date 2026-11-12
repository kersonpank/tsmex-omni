import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { averbarMdfeDocumento } from '../services/averbacao/mdfeDeclaration.js';

/**
 * Averbação do MDF-e (RC-V) na AT&M. Montado em `/api/manifests` antes do roteador de viagens,
 * para não editar `routes/manifests.ts`.
 */
export const manifestAverbacaoRouter = Router();

const paramsSchema = z.object({ id: z.string().uuid(), documentId: z.string().uuid() });

// POST /api/manifests/:id/fiscal-documents/:documentId/averbar — tenta de novo agora (ADMIN ou HUB de origem)
manifestAverbacaoRouter.post('/:id/fiscal-documents/:documentId/averbar', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const parsed = paramsSchema.safeParse(req.params);
        if (!parsed.success) throw new AppError('Identificador inválido.', 400);
        const { id, documentId } = parsed.data;
        const manifest = await prisma.manifest.findUnique({ where: { id }, select: { id: true, hubId: true } });
        if (!manifest) throw new AppError('Viagem não encontrada.', 404);
        const roles = req.user!.roles;
        if (!roles.includes('ADMIN') && (!req.user!.hubId || manifest.hubId !== req.user!.hubId)) {
            throw new AppError('Apenas o hub de origem da viagem pode averbar o MDF-e.', 403);
        }
        const doc = await prisma.manifestFiscalDocument.findFirst({ where: { id: documentId, manifestId: id, documentType: 'MDFE' }, select: { id: true } });
        if (!doc) throw new AppError('MDF-e não encontrado nesta viagem.', 404);
        const outcome = await averbarMdfeDocumento(doc.id, { force: true });
        const averbacao = await prisma.manifestAverbacao.findUnique({
            where: { manifestFiscalDocumentId: doc.id },
            select: { status: true, protocolo: true, chancelaAt: true, rcvCodigo: true, rcvMensagem: true, attemptCount: true, lastError: true },
        });
        res.json({ success: outcome.status === 'RCV_AVERBADO' || outcome.status === 'DECLARADO', data: { outcome, averbacao } });
    } catch (error) {
        next(error);
    }
});
