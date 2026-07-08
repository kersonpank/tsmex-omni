import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import prisma from '../lib/prisma.js';
import {
    getUltimoNsuStored,
    listarDocumentosDistribuicao,
    setUltimoNsuStored,
    solicitarDistribuicaoNfe,
    type DistribuicaoNfeRequestBody,
} from '../services/acbr/acbrDistribuicaoNfe.js';
import { isAcbrCredentialsConfigured } from '../services/acbr/acbrConfig.js';

const router = Router();

router.use(authenticate, authorize('ADMIN', 'HUB'));

const solicitarSchema = z.object({
    cpf_cnpj: z.string().min(11),
    ambiente: z.enum(['homologacao', 'producao']),
    uf_autor: z.string().length(2).optional(),
    tipo_consulta: z.enum(['dist-nsu', 'cons-nsu', 'cons-chave']),
    dist_nsu: z.number().int().optional(),
    cons_nsu: z.number().int().optional(),
    cons_chave: z.string().optional(),
    ignorar_tempo_espera: z.boolean().optional(),
});

// POST /api/fiscal/distribuicao-nfe/solicitar
router.post('/distribuicao-nfe/solicitar', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        if (!isAcbrCredentialsConfigured()) {
            throw new AppError('ACBr não configurado (ACBR_CLIENT_ID / ACBR_CLIENT_SECRET).', 503);
        }
        const parsed = solicitarSchema.parse(req.body);
        const body: DistribuicaoNfeRequestBody = { ...parsed, cpf_cnpj: parsed.cpf_cnpj.replace(/\D/g, '') };
        if (body.tipo_consulta === 'dist-nsu' && body.dist_nsu == null) {
            const last = await getUltimoNsuStored(body.cpf_cnpj, body.ambiente);
            body.dist_nsu = parseInt(last, 10) || 0;
        }
        const data = await solicitarDistribuicaoNfe(body);
        const ultimo = (data as { ultimo_nsu?: number }).ultimo_nsu;
        if (typeof ultimo === 'number') {
            await setUltimoNsuStored(body.cpf_cnpj, body.ambiente, String(ultimo));
        }
        res.json({ success: true, data });
    } catch (e) {
        if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
        next(e);
    }
});

// GET /api/fiscal/distribuicao-nfe/documentos?$top=&$skip=
router.get('/distribuicao-nfe/documentos', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        if (!isAcbrCredentialsConfigured()) {
            throw new AppError('ACBr não configurado (ACBR_CLIENT_ID / ACBR_CLIENT_SECRET).', 503);
        }
        const top = req.query.$top ? parseInt(String(req.query.$top), 10) : 20;
        const skip = req.query.$skip ? parseInt(String(req.query.$skip), 10) : 0;
        const data = await listarDocumentosDistribuicao({ top, skip });
        res.json({ success: true, data });
    } catch (e) {
        next(e);
    }
});

const bootstrapNsuSchema = z.object({
    nsu: z.string().regex(/^\d+$/, 'NSU deve conter apenas dígitos'),
});

/**
 * Semeia o NSU inicial de um emitente SEM chamar a ACBr. Existe porque `dist-nsu` com
 * ultNSU=0 faz a SEFAZ devolver o histórico retroativo (~90 dias) inteiro, e cada documento
 * retornado consome 1 crédito — um CNPJ com milhares de notas emitidas nesse período pode
 * estourar milhares de créditos em segundos só de habilitar a varredura automática. O valor
 * de `nsu` é decidido por um humano (consulta manual de ultNSU, ou aceitar conscientemente o
 * custo de uma consulta inicial). ADMIN-only: é uma ação com efeito financeiro direto.
 */
router.post('/distribuicao-nfe/emitters/:fiscalEmitterId/bootstrap-nsu', authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const parsed = bootstrapNsuSchema.parse(req.body);
        const emitter = await prisma.fiscalEmitter.findUnique({
            where: { id: req.params.fiscalEmitterId as string },
            include: { person: true },
        });
        if (!emitter) throw new AppError('Emitente credenciado não encontrado', 404);

        const ambiente = emitter.environment === 'PRODUCAO' ? 'producao' : 'homologacao';
        await setUltimoNsuStored(emitter.person.document, ambiente, parsed.nsu);

        res.json({
            success: true,
            data: { fiscalEmitterId: emitter.id, cpfCnpj: emitter.person.document, ambiente, ultimoNsu: parsed.nsu },
        });
    } catch (e) {
        if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
        next(e);
    }
});

export { router as fiscalDistribuicaoRouter };
