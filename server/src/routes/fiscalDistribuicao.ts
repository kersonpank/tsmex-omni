import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import prisma from '../lib/prisma.js';
import {
    getUltimoNsuStored,
    listarDocumentosDistribuicao,
    putAcbrEmpresaDistNfeConfig,
    setUltimoNsuStored,
    solicitarEPersistirNsu,
    type DistribuicaoNfeRequestBody,
} from '../services/acbr/acbrDistribuicaoNfe.js';
import { isAcbrCredentialsConfigured } from '../services/acbr/acbrConfig.js';
import { enqueueSyncEmitterJob } from '../services/queues/distribuicaoNfeQueue.js';
import { resolveOpenSystemAlerts } from '../services/systemAlertService.js';
import { listAllDocuments, countDocumentsByStatus } from '../services/fiscal/nfeDistribuicaoRepo.js';
import { getCargoDataFromDistribuicaoDocument } from '../services/fiscal/nfeDistribuicaoCargoData.js';
import type { NfeDistribuicaoDocumentoStatus } from '@prisma/client';

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
        const parsed = solicitarSchema.parse(req.body);
        const environment = parsed.ambiente === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO';
        if (!isAcbrCredentialsConfigured(environment)) {
            const vars = environment === 'PRODUCAO'
                ? 'ACBR_CLIENT_ID_PRODUCAO / ACBR_CLIENT_SECRET_PRODUCAO'
                : 'ACBR_CLIENT_ID / ACBR_CLIENT_SECRET';
            throw new AppError(`ACBr não configurado para ambiente ${parsed.ambiente} (${vars}).`, 503);
        }
        const body: DistribuicaoNfeRequestBody = { ...parsed, cpf_cnpj: parsed.cpf_cnpj.replace(/\D/g, '') };
        if (body.tipo_consulta === 'dist-nsu' && body.dist_nsu == null) {
            const last = await getUltimoNsuStored(body.cpf_cnpj, body.ambiente);
            body.dist_nsu = parseInt(last, 10) || 0;
        }
        // Idempotente/sem custo — garante a config de Distribuição NF-e na ACBr antes da primeira
        // chamada real deste CNPJ+ambiente (senão qualquer chamada quebra com ConfigDistNfeNotFound).
        await putAcbrEmpresaDistNfeConfig(body.cpf_cnpj, body.ambiente);
        const data = await solicitarEPersistirNsu(body);
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

        // NSU semeado agora — fecha na hora qualquer alerta "NSU não configurado" aberto pra
        // este emitente, sem esperar o próximo ciclo do coordenador (até 12h depois).
        await resolveOpenSystemAlerts({
            category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
            match: (ctx) => ctx.fiscalEmitterId === emitter.id,
        });

        res.json({
            success: true,
            data: { fiscalEmitterId: emitter.id, cpfCnpj: emitter.person.document, ambiente, ultimoNsu: parsed.nsu },
        });
    } catch (e) {
        if (e instanceof z.ZodError) return next(new AppError(e.errors[0]?.message ?? 'Payload inválido', 400));
        next(e);
    }
});

/**
 * Força uma sincronização agora (fora do agendamento 2x/dia), enfileirando o mesmo job que o
 * coordenador dispararia. Não chama a ACBr diretamente aqui — o processor da fila decide
 * (inclusive a guarda de NSU=0), então isto é seguro mesmo se `distribuicaoNfeEnabled` for
 * desligado ou o NSU não estiver semeado (o job apenas será pulado com alerta).
 *
 * ADMIN-only por decisão de negócio: cada chamada pode consumir crédito ACBr real — deixar
 * qualquer colaborador de Hub disparar à vontade é risco de custo desnecessário. Sincronização
 * sob demanda é decisão administrativa, não operacional.
 */
router.post('/distribuicao-nfe/emitters/:fiscalEmitterId/sync-now', authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const emitter = await prisma.fiscalEmitter.findUnique({ where: { id: req.params.fiscalEmitterId as string } });
        if (!emitter) throw new AppError('Emitente credenciado não encontrado', 404);
        if (!emitter.distribuicaoNfeEnabled) {
            throw new AppError('Este emitente não tem a varredura de Distribuição NF-e habilitada.', 400);
        }
        const jobId = await enqueueSyncEmitterJob(emitter.id);
        res.status(202).json({ success: true, data: { jobId } });
    } catch (e) {
        next(e);
    }
});

/**
 * Visão ADMIN do pipeline inteiro de Distribuição NF-e (todos os status, não só
 * READY_FOR_TRIAGE como `/triagem`) — cross-hub por natureza, ADMIN-only.
 */
router.get('/distribuicao-nfe/monitor', authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const status = typeof req.query.status === 'string' ? (req.query.status as NfeDistribuicaoDocumentoStatus) : undefined;
        const fiscalEmitterId = typeof req.query.fiscalEmitterId === 'string' ? req.query.fiscalEmitterId : undefined;
        const cnpjEmitente = typeof req.query.cnpjEmitente === 'string' ? req.query.cnpjEmitente : undefined;
        const [documentos, counts] = await Promise.all([
            listAllDocuments({ status, fiscalEmitterId, cnpjEmitente }),
            countDocumentsByStatus({ fiscalEmitterId, cnpjEmitente }),
        ]);
        res.json({ success: true, data: { documentos, counts } });
    } catch (e) {
        next(e);
    }
});

/**
 * Detalhe de um único documento — inclui `cargoData` (dados extraídos do XML: emitente,
 * destinatário, transportador, produtos, peso, valor). Baixar/parsear o XML é custoso (I/O de
 * storage), por isso não entra na listagem (`/monitor`) e só acontece aqui, sob demanda, quando
 * o admin abre o detalhe de uma linha específica.
 */
router.get('/distribuicao-nfe/monitor/:id/detalhe', authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const doc = await prisma.nfeDistribuicaoDocumento.findUnique({
            where: { id: req.params.id as string },
            include: {
                fiscalEmitter: { select: { displayName: true, hub: { select: { code: true, name: true } } } },
                convertedDemand: { select: { id: true, status: true, orderNumber: true } },
            },
        });
        if (!doc) throw new AppError('Documento não encontrado', 404);
        const cargoData = await getCargoDataFromDistribuicaoDocument(doc).catch(() => null);
        res.json({ success: true, data: { ...doc, cargoData } });
    } catch (e) {
        next(e);
    }
});

/**
 * Lista as OrderInvoice (NFs/Declarações adicionadas manualmente a um pedido) com
 * contexto do pedido — usado pela tela de menu "NF-e" pra unificar com as
 * NfeDistribuicaoDocumento (varredura automática) numa visão única "todas as NFs",
 * sem juntar os dois modelos no banco (não têm FK entre si — são estágios
 * diferentes de um mesmo funil, não a mesma informação).
 */
router.get('/distribuicao-nfe/manual-invoices', authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
        const invoices = await prisma.orderInvoice.findMany({
            where: q
                ? {
                      OR: [
                          { nfNumber: { contains: q, mode: 'insensitive' } },
                          { nfKey: { contains: q, mode: 'insensitive' } },
                          { order: { demand: { client: { companyName: { contains: q, mode: 'insensitive' } } } } },
                      ],
                  }
                : undefined,
            include: {
                order: {
                    select: {
                        id: true,
                        status: true,
                        currentHub: { select: { id: true, name: true, code: true } },
                        demand: { select: { client: { select: { companyName: true } } } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
        res.json({ success: true, data: { invoices } });
    } catch (e) {
        next(e);
    }
});

export { router as fiscalDistribuicaoRouter };
