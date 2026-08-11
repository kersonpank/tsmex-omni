import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { listReadyForTriage, markDiscarded } from '../services/fiscal/nfeDistribuicaoRepo.js';
import { getCargoDataFromDistribuicaoDocument } from '../services/fiscal/nfeDistribuicaoCargoData.js';
import { convertNfeDistribuicaoDocument } from '../services/fiscal/convertNfeDistribuicaoDocument.js';

const router = Router();

router.use(authenticate, authorize('ADMIN', 'HUB'));

function resolveHubScope(req: AuthRequest): string | undefined {
    const isAdmin = req.user!.roles.includes('ADMIN');
    if (isAdmin) {
        const hubIdParam = typeof req.query.hubId === 'string' ? req.query.hubId.trim() : '';
        return hubIdParam || undefined;
    }
    // HUB-only: sempre escopado ao próprio hub, nunca pode ver a fila de outro.
    if (!req.user!.hubId) throw new AppError('Usuário HUB sem hub associado.', 403);
    return req.user!.hubId;
}

// GET /api/fiscal/distribuicao-nfe/triagem
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const hubId = resolveHubScope(req);
        const docs = await listReadyForTriage({ hubId });
        const enriched = await Promise.all(
            docs.map(async (doc) => ({
                ...doc,
                cargoData: await getCargoDataFromDistribuicaoDocument(doc).catch(() => null),
            })),
        );
        res.json({ success: true, data: enriched });
    } catch (e) {
        next(e);
    }
});

const converterSchema = z.object({
    clientId: z.string().uuid().optional(),
});

const CONVERT_ERROR_MESSAGES: Record<'not_ready' | 'already_has_demand' | 'concurrent_conversion', string> = {
    not_ready: 'Documento não está pronto para triagem.',
    already_has_demand:
        'Já existe uma Demanda para esta chave NF-e (provavelmente criada via bipagem manual). Use a tela de recebimento em vez de converter aqui de novo.',
    concurrent_conversion: 'Documento já havia sido convertido ou descartado por outra ação concorrente.',
};

// POST /api/fiscal/distribuicao-nfe/triagem/:id/converter
router.post('/:id/converter', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const parsed = converterSchema.parse(req.body);
        const result = await convertNfeDistribuicaoDocument(req.params.id as string, {
            clientId: parsed.clientId,
            actingRoles: req.user!.roles,
            actingHubId: req.user!.hubId ?? null,
        });
        if (!result.converted) {
            throw new AppError(CONVERT_ERROR_MESSAGES[result.reason], 409);
        }
        res.json({ success: true, data: { demand: result.demand } });
    } catch (e) {
        if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
        next(e);
    }
});

// POST /api/fiscal/distribuicao-nfe/triagem/:id/descartar
router.post('/:id/descartar', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const doc = await prisma.nfeDistribuicaoDocumento.findUnique({ where: { id: req.params.id as string } });
        if (!doc) throw new AppError('Documento não encontrado', 404);
        if (doc.status !== 'READY_FOR_TRIAGE') {
            throw new AppError(`Documento não está pronto para triagem (status atual: ${doc.status}).`, 409);
        }
        const discarded = await markDiscarded(doc.id, req.user!.id);
        if (!discarded) {
            throw new AppError('Documento já havia sido convertido ou descartado por outra ação concorrente.', 409);
        }
        res.json({ success: true });
    } catch (e) {
        next(e);
    }
});

export { router as nfeDistribuicaoTriagemRouter };
