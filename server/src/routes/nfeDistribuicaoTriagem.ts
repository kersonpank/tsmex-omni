import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { listReadyForTriage, markConverted, markDiscarded } from '../services/fiscal/nfeDistribuicaoRepo.js';
import { resolveIntakeByNfeKey } from '../services/intake/resolveIntakeByNfeKey.js';
import { resolveIntakeClientByDocument } from '../services/intake/resolveIntakeClientByDocument.js';
import { createIntakeDemandFromNfeKey } from '../services/intake/createIntakeDemand.js';

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
        res.json({ success: true, data: docs });
    } catch (e) {
        next(e);
    }
});

const converterSchema = z.object({
    clientId: z.string().uuid().optional(),
});

// POST /api/fiscal/distribuicao-nfe/triagem/:id/converter
router.post('/:id/converter', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const parsed = converterSchema.parse(req.body);
        const doc = await prisma.nfeDistribuicaoDocumento.findUnique({
            where: { id: req.params.id as string },
            include: { fiscalEmitter: { select: { hubId: true } } },
        });
        if (!doc) throw new AppError('Documento não encontrado', 404);
        if (doc.status !== 'READY_FOR_TRIAGE') {
            throw new AppError(`Documento não está pronto para triagem (status atual: ${doc.status}).`, 409);
        }

        // Evita duplicar: alguém pode já ter bipado esta chave manualmente antes do worker rodar.
        const existing = await resolveIntakeByNfeKey({
            chave: doc.accessKey,
            actingRoles: req.user!.roles,
            actingHubId: req.user!.hubId ?? null,
        });
        if (existing.resolution !== 'not_found' && existing.resolution !== 'invalid_key') {
            throw new AppError(
                'Já existe uma Demanda para esta chave NF-e (provavelmente criada via bipagem manual). Use a tela de recebimento em vez de converter aqui de novo.',
                409,
            );
        }

        let clientId = parsed.clientId;
        if (!clientId) {
            const clientLookup = await resolveIntakeClientByDocument(doc.cnpjEmitente);
            if (clientLookup.status === 'not_found') {
                throw new AppError(
                    'Fornecedor (emitente da NF-e) ainda não está cadastrado como cliente. Cadastre-o antes de converter, ou informe clientId.',
                    422,
                );
            }
            clientId = clientLookup.client!.id;
        }

        const { demand } = await createIntakeDemandFromNfeKey({
            chave: doc.accessKey,
            clientId,
            expectedHubId: doc.fiscalEmitter.hubId,
            sourceType: 'DFE_ACBR',
        });

        const converted = await markConverted(doc.id, demand.id);
        if (!converted) {
            throw new AppError('Documento já havia sido convertido ou descartado por outra ação concorrente.', 409);
        }

        res.json({ success: true, data: { demand } });
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
