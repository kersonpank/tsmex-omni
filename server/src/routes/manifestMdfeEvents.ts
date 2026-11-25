import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { cancelMdfeDocument, includeMdfeDriver } from '../services/acbr/mdfeEvents.js';
import { emitMdfesForManifest } from '../services/acbr/acbrMdfeEmit.js';
import { isAcbrCredentialsConfigured } from '../services/acbr/acbrConfig.js';
import { findOpenMdfeForManifest } from '../services/fiscal/mdfeOpenByPlate.js';

/**
 * Eventos do MDF-e da viagem (cancelar, cancelar e emitir de novo, incluir condutor) e a conferência de
 * MDF-e aberto na mesma placa. Montado em `/api/manifests` antes do roteador de viagens.
 */
export const manifestMdfeEventsRouter = Router();

const docParams = z.object({ id: z.string().uuid(), documentId: z.string().uuid() });

/** Viagem visível para quem pede: ADMIN sempre; HUB só a do próprio hub de origem. */
async function loadManifestFor(req: AuthRequest, id: string) {
    const manifest = await prisma.manifest.findUnique({ where: { id }, select: { id: true, hubId: true, status: true } });
    if (!manifest) throw new AppError('Viagem não encontrada.', 404);
    const roles = req.user!.roles;
    if (!roles.includes('ADMIN') && (!req.user!.hubId || manifest.hubId !== req.user!.hubId)) {
        throw new AppError('Apenas o hub de origem da viagem pode mexer no MDF-e.', 403);
    }
    return manifest;
}

function requireAcbr() {
    if (!isAcbrCredentialsConfigured()) throw new AppError('Eventos de MDF-e via ACBr requerem ACBR_CLIENT_ID e ACBR_CLIENT_SECRET.', 503);
}

// GET /api/manifests/:id/mdfe-open-check — a placa de tração tem MDF-e aberto em outra viagem ou no legado?
manifestMdfeEventsRouter.get('/:id/mdfe-open-check', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        await loadManifestFor(req, id);
        res.json({ success: true, data: await findOpenMdfeForManifest(id) });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError('Identificador inválido.', 400));
        next(error);
    }
});

const cancelBody = z.object({
    justificativa: z.string().trim().min(15, 'A justificativa precisa ter pelo menos 15 caracteres.').max(255),
    reemitir: z.boolean().optional().default(false),
});

// POST /api/manifests/:id/fiscal-documents/:documentId/cancel-mdfe — cancela na SEFAZ (até 24 h) e, se pedido, emite de novo com os CT-e atuais
manifestMdfeEventsRouter.post('/:id/fiscal-documents/:documentId/cancel-mdfe', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id, documentId } = docParams.parse(req.params);
        const { justificativa, reemitir } = cancelBody.parse(req.body ?? {});
        requireAcbr();
        const manifest = await loadManifestFor(req, id);
        if (reemitir && manifest.status !== 'ACCEPTED' && manifest.status !== 'IN_PROGRESS') {
            throw new AppError('Para emitir de novo, a viagem precisa estar aceita ou em andamento.', 409);
        }
        const cancel = await cancelMdfeDocument(id, documentId, justificativa);
        if (!cancel.ok) {
            return res.status(cancel.pending ? 202 : 422).json({ success: false, pending: !!cancel.pending, error: cancel.error, cancel: cancel.outcome ?? null });
        }
        if (!reemitir) return res.json({ success: true, cancel: cancel.outcome, mdfes: [] });
        const mdfes = await emitMdfesForManifest(id);
        const allAuthorized = mdfes.every((m) => m.status === 'AUTHORIZED');
        res.json({
            success: true,
            cancel: cancel.outcome,
            mdfes,
            message: allAuthorized ? 'MDF-e cancelado e emitido de novo.' : 'MDF-e cancelado. A nova emissão ainda não foi autorizada: confira o motivo abaixo.',
        });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0]?.message ?? 'Dados inválidos.', 400));
        next(error);
    }
});

const driverBody = z.object({ driverId: z.string().uuid() });

// POST /api/manifests/:id/fiscal-documents/:documentId/include-driver — evento de inclusão de condutor
manifestMdfeEventsRouter.post('/:id/fiscal-documents/:documentId/include-driver', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id, documentId } = docParams.parse(req.params);
        const { driverId } = driverBody.parse(req.body ?? {});
        requireAcbr();
        await loadManifestFor(req, id);
        const result = await includeMdfeDriver(id, documentId, driverId);
        if (!result.ok) return res.status(result.pending ? 202 : 422).json({ success: false, pending: !!result.pending, error: result.error });
        res.json({ success: true, event: result.outcome, message: 'Condutor incluído no MDF-e.' });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0]?.message ?? 'Dados inválidos.', 400));
        next(error);
    }
});
