import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { FreightCalcStatus } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import {
    getNextMinutaNumber,
    getNextCteNumber,
    getNextDceNumber,
    getNextFiscalEmitterMinutaNumber,
    getNextFiscalEmitterCteNumber,
    getNextFiscalEmitterDceNumber,
    buildMinutaPayload,
    buildCtePayload,
} from '../services/freightEmission.js';
import { authorizeCteWithProvider, type CteEmissionInput, type CteEnvironment, type CteProviderMode } from '../services/cteService.js';
import { authorizeDceWithProvider, validateDceReadiness } from '../services/dceService.js';
import { getBrandingForFiscalEmitter } from '../services/visualIdentityService.js';
import { getFiscalDocModeForFreight } from '../services/fiscal/fiscalDocPolicy.js';
import { resolveCteCfopCstForEmission } from '../services/fiscal/cteEmitterDefaults.js';
import { buildCteEmissionInputFromRecords } from '../services/fiscal/cteEmissionInputBuilder.js';
import { getAcbrProviderDecision } from '../services/acbr/acbrConfig.js';
import { enqueueCteEmissionJob } from '../services/queues/cteEmissionQueue.js';
import { getObjectDownloadUrl } from '../lib/objectStorage.js';
import { BREAKDOWN_KEYS, computeFreightFromTable, informedFreight, orderFreightParams } from '../services/freight/freightPricing.js';
import { ACTIVE_DOC_STATUSES, REUSABLE_STATUSES, isPendingReconciliationWithoutSubmission } from '../services/freight/freightDocRules.js';
import { getFreightSuggestion } from '../services/freight/freightQueries.js';
import type { CtePreflightResult } from '../services/fiscal/ctePreflight.js';

const router = Router({ mergeParams: true });

/** Evita "Invalid uuid" quando o cliente envia "" em campos UUID opcionais. */
function emptyToNull(v: unknown): unknown {
    if (v === '' || v === undefined) return null;
    return v;
}

const nullableUuid = z.preprocess(emptyToNull, z.string().uuid().nullable().optional());

/** Rotas/tabelas podem ter id slug legado (ex.: route-sp-ma), não só UUID. */
const nullableDbId = z.preprocess(
    emptyToNull,
    z.union([z.string().min(1).max(128), z.null()]).optional(),
);

type OrderInvoicesShape = {
    invoicesRel: {
        type?: string | null;
        nfKey?: string | null;
        nature?: string | null;
        nfNumber?: string | null;
    }[];
};

function assertFreightDocTypeAllowedForOrder(documentType: 'CTE' | 'DCE' | 'MINUTA', order: OrderInvoicesShape): void {
    if (documentType === 'MINUTA') return;
    const mode = getFiscalDocModeForFreight(order);
    if (documentType === 'CTE') {
        if (mode.allowed !== 'CTE') {
            throw new AppError(
                mode.allowed === null ? mode.reason : 'Este pedido está configurado para DC-e (declaração “Outras”). Ajuste as notas ou escolha DC-e.',
                400,
            );
        }
        return;
    }
    if (documentType === 'DCE') {
        if (mode.allowed !== 'DCE') {
            throw new AppError(
                mode.allowed === null ? mode.reason : 'Este pedido está configurado para CT-e (NF-e). Ajuste as notas ou escolha CT-e.',
                400,
            );
        }
    }
}

/**
 * Modo feliz-path no `authorizeCteWithProvider` (vide `server/src/services/cteService.ts`):
 * com `simulate-authorized`, chama ACBr HTTP quando credenciais + provedor/global batem (`shouldUseAcbrHttp`);
 * senão autoriza apenas em simulação local (sem SEFAZ), com protocolo típico `SIM…`.
 */
const CTE_PROVIDER_HAPPY_PATH_MODE: CteProviderMode = 'simulate-authorized';

const FISCAL_LOCKED_STATUSES = [
    'CTE_READY',
    'CTE_SENT',
    'CTE_PROCESSING',
    'CTE_AUTHORIZED',
    'CTE_CANCELLED',
    'CTE_PENDING_RECONCILIATION',
    'DCE_READY',
    'DCE_SENT',
    'DCE_AUTHORIZED',
    'DCE_CANCELLED',
] as const;

function extractQrCodeUrlFromXml(xml: string | null): string | null {
    if (!xml) return null;
    const match = xml.match(/<qrCod(?:CTe|MDFe|Dce)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/qrCod(?:CTe|MDFe|Dce)?>/i);
    return match ? match[1].trim() : null;
}

const getOrderParams = orderFreightParams;

/** Calcula e persiste frete (Especial / Tarifa Geral). Usado em POST /calculate e após salvar create/update. */
export async function persistAutoFreightCalculation(orderId: string, calcId: string): Promise<void> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            invoicesRel: true,
            demand: { include: { client: true } },
        },
    });

    if (!order) throw new AppError('Order not found', 404);

    const calc = await prisma.orderFreightCalculation.findFirst({
        where: { id: calcId, orderId },
        include: {
            pricingTable: { include: { minFreightRanges: { orderBy: { minWeight: 'asc' } } } },
        },
    });

    if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

    if (calc.status === 'MINUTA_EMITTED' || FISCAL_LOCKED_STATUSES.includes(calc.status as (typeof FISCAL_LOCKED_STATUSES)[number])) {
        throw new AppError('Cálculo com documento emitido/enviado não pode ser recalculado.', 400);
    }

    if (calc.calculationMethod === 'INFORMADO') {
        throw new AppError('Método Informado não usa cálculo automático. Preencha os valores manualmente e salve.', 400);
    }

    const { volumes, weight, cubage, nfValue } = getOrderParams(order);

    let table = calc.pricingTable;

    if (calc.calculationMethod === 'ESPECIAL') {
        if (!calc.pricingTableId || !table) {
            throw new AppError('Método Especial exige seleção de uma tabela de preço', 400);
        }
    } else {
        // Tarifa geral sem rota (padrão da casa), escolhida explicitamente — último degrau antes do informado.
        const routeless = !calc.routeId && calc.pricingTableId
            ? await prisma.pricingTable.findFirst({
                  where: { id: calc.pricingTableId, type: 'GENERAL', routeId: null, active: true },
                  include: { minFreightRanges: { orderBy: { minWeight: 'asc' } } },
              })
            : null;
        if (routeless) {
            table = routeless;
        } else {
            const routeId = calc.routeId || order.routeId;
            if (!routeId) {
                throw new AppError('Método Tarifa Geral exige uma rota. Informe a rota ou vincule ao pedido.', 400);
            }

            const route = await prisma.pricingRoute.findUnique({
                where: { id: routeId },
            });

            if (!route) throw new AppError('Rota não encontrada', 404);

            table = null;
            if (calc.pricingTableId) {
                table = await prisma.pricingTable.findFirst({
                    where: {
                        id: calc.pricingTableId,
                        routeId: route.id,
                        type: 'GENERAL',
                        active: true,
                    },
                    include: { minFreightRanges: { orderBy: { minWeight: 'asc' } } },
                });
            }
            if (!table) {
                table = await prisma.pricingTable.findFirst({
                    where: {
                        routeId: route.id,
                        type: 'GENERAL',
                        active: true,
                    },
                    include: { minFreightRanges: { orderBy: { minWeight: 'asc' } } },
                    orderBy: { priority: 'desc' },
                });
            }

            if (!table) throw new AppError('Nenhuma tabela Tarifa Geral encontrada para esta rota', 404);
        }
    }

    const { total, breakdown, cubedWeight, effectiveWeight } = computeFreightFromTable(table!, { volumes, weight, cubage, nfValue });
    const icms = breakdown.icms;

    await prisma.orderFreightCalculation.update({
        where: { id: calcId },
        data: {
            volumes,
            weight,
            cubage: cubage ?? null,
            cubedWeight,
            effectiveWeight,
            nfValue: nfValue || 0,
            freightTotal: total,
            breakdown: breakdown as object,
            icmsValue: icms || null,
            status: 'CALCULATED',
            pricingTableId: calc.calculationMethod === 'TARIFA_GERAL' ? table!.id : calc.pricingTableId,
            routeId: calc.calculationMethod === 'TARIFA_GERAL' ? table!.routeId : calc.routeId,
        },
    });
}

// Validation schemas
const freightCalcShape = z.object({
    documentType: z.enum(['CTE', 'DCE', 'MINUTA']),
    emissorId: z.string().uuid(),
    calculationMethod: z.enum(['ESPECIAL', 'TARIFA_GERAL', 'INFORMADO']),
    pricingTableId: nullableDbId,
    routeId: nullableDbId,
    fiscalEmitterId: nullableUuid,
    originCity: z.string().optional().nullable(),
    destCity: z.string().optional().nullable(),
    cfop: z.string().optional().nullable(),
    tipoFrete: z.string().optional().nullable(),
    cst: z.string().optional().nullable(),
    observacoes: z.string().optional().nullable(),
});

const createFreightCalcSchema = freightCalcShape.superRefine((data, ctx) => {
    if ((data.documentType === 'CTE' || data.documentType === 'DCE') && !data.fiscalEmitterId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Emitente credenciado é obrigatório para CT-e e DC-e.',
            path: ['fiscalEmitterId'],
        });
    }
});

const updateFreightCalcSchema = freightCalcShape.partial().extend({
    freightTotal: z.number().optional(),
    breakdown: z.record(z.string(), z.number()).optional().nullable(),
    icmsValue: z.number().optional().nullable(),
});

async function validateFiscalEmitterSelection(params: {
    emissorId: string;
    fiscalEmitterId?: string | null;
    user: AuthRequest['user'];
}) {
    const hub = await prisma.hub.findUnique({ where: { id: params.emissorId } });
    if (!hub) throw new AppError('Hub emissor não encontrado', 404);

    if (params.user?.roles.includes('HUB') && params.user.hubId !== params.emissorId) {
        throw new AppError('Você só pode usar seu próprio Hub como emissor', 403);
    }

    if (!params.fiscalEmitterId) return;

    const fiscalEmitter = await prisma.fiscalEmitter.findUnique({
        where: { id: params.fiscalEmitterId },
        include: { person: true },
    });
    if (!fiscalEmitter || !fiscalEmitter.active) {
        throw new AppError('Emitente credenciado não encontrado ou inativo', 404);
    }
    if (fiscalEmitter.person.documentType !== 'CNPJ') {
        throw new AppError('Emitente credenciado precisa ser Pessoa Jurídica (CNPJ)', 400);
    }
    if (fiscalEmitter.hubId && fiscalEmitter.hubId !== params.emissorId) {
        throw new AppError('Emitente credenciado não pertence ao Hub emissor selecionado', 400);
    }
    if (params.user?.roles.includes('HUB') && fiscalEmitter.hubId && fiscalEmitter.hubId !== params.user.hubId) {
        throw new AppError('Você não pode usar emitente credenciado de outro Hub', 403);
    }
}

// ==================== ROUTES ====================

// GET /api/orders/:orderId/freight-calculations - List freight calculations
router.get('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, currentHubId: true },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to access this order', 403);
        }

        const calcs = await prisma.orderFreightCalculation.findMany({
            where: { orderId },
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                fiscalEmitter: { include: { person: true, hub: true } },
                pricingTable: { select: { id: true, description: true } },
                // Só o job mais recente, só os campos que a UI usa pra mostrar progresso do
                // polling assíncrono (attemptCount/maxAttempts) enquanto CTE_SENT/CTE_PROCESSING
                // — sem isso a tela não tinha como distinguir "ainda processando" de "travado".
                cteEmissionJobs: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { phase: true, attemptCount: true, maxAttempts: true, lastPolledAt: true, nextPollAt: true },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        res.json({ success: true, data: calcs });
    } catch (error) {
        next(error);
    }
});

// POST /api/orders/:orderId/freight-calculations - Create (DRAFT)
router.post('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const body = req.body as Record<string, unknown>;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { invoicesRel: true },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to add freight calculation to this order', 403);
        }

        const data = createFreightCalcSchema.parse(body);

        // Validar emissor: Hub deve existir e ter personId (CNPJ) para emitir
        const hub = await prisma.hub.findUnique({
            where: { id: data.emissorId },
            include: { person: true },
        });
        if (!hub) throw new AppError('Emissor (Hub) não encontrado', 404);
        if (!hub.personId) throw new AppError('O Hub emissor deve ter Pessoa (CNPJ) vinculada para emitir documento', 400);

        await validateFiscalEmitterSelection({
            emissorId: data.emissorId,
            fiscalEmitterId: data.fiscalEmitterId,
            user: req.user,
        });

        assertFreightDocTypeAllowedForOrder(data.documentType, order);

        const { volumes, weight, cubage, nfValue } = getOrderParams(order);
        const cd = (order.collectionData || {}) as Record<string, unknown>;
        const commodity = (cd.commodity as string) || null;

        const created = await prisma.orderFreightCalculation.create({
            data: {
                orderId,
                documentType: data.documentType as 'CTE' | 'DCE' | 'MINUTA',
                emissorId: data.emissorId,
                calculationMethod: data.calculationMethod as 'ESPECIAL' | 'TARIFA_GERAL' | 'INFORMADO',
                pricingTableId: data.pricingTableId || null,
                routeId: data.routeId || null,
                fiscalEmitterId: data.fiscalEmitterId || null,
                originCity: data.originCity ?? order.origemPrestacao ?? null,
                destCity: data.destCity ?? order.fimPrestacao ?? null,
                cfop: data.cfop ?? null,
                tipoFrete: data.tipoFrete ?? null,
                cst: data.cst ?? null,
                observacoes: data.observacoes ?? null,
                volumes,
                weight,
                cubage: cubage ?? null,
                nfValue: nfValue || 0,
                commodity,
                freightTotal: 0,
                status: 'DRAFT',
            },
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                fiscalEmitter: { include: { person: true, hub: true } },
                pricingTable: { select: { id: true, description: true } },
            },
        });

        if (data.calculationMethod !== 'INFORMADO') {
            try {
                await persistAutoFreightCalculation(orderId, created.id);
            } catch (e) {
                await prisma.orderFreightCalculation.delete({ where: { id: created.id } });
                throw e;
            }
        }

        const calc = await prisma.orderFreightCalculation.findFirstOrThrow({
            where: { id: created.id },
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                fiscalEmitter: { include: { person: true, hub: true } },
                pricingTable: { select: { id: true, description: true } },
            },
        });

        res.status(201).json({ success: true, data: calc });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/orders/:orderId/freight-calculations/:calcId - Update
router.patch('/:calcId', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { invoicesRel: true },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to update this order', 403);
        }

        const existing = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
        });

        if (!existing) throw new AppError('Cálculo de frete não encontrado', 404);

        if (existing.status === 'MINUTA_EMITTED' || FISCAL_LOCKED_STATUSES.includes(existing.status as typeof FISCAL_LOCKED_STATUSES[number])) {
            throw new AppError('Cálculo com documento emitido/enviado não pode ser editado. Use evento fiscal de cancelamento/correção.', 400);
        }

        const data = updateFreightCalcSchema.partial().parse(req.body);
        const nextEmissorId = data.emissorId ?? existing.emissorId;
        const nextFiscalEmitterId = data.fiscalEmitterId !== undefined ? data.fiscalEmitterId : existing.fiscalEmitterId;
        await validateFiscalEmitterSelection({
            emissorId: nextEmissorId,
            fiscalEmitterId: nextFiscalEmitterId,
            user: req.user,
        });

        const nextDocType = (data.documentType ?? existing.documentType) as 'CTE' | 'DCE' | 'MINUTA';
        if ((nextDocType === 'CTE' || nextDocType === 'DCE') && !nextFiscalEmitterId) {
            throw new AppError('Emitente credenciado é obrigatório para CT-e e DC-e.', 400);
        }

        assertFreightDocTypeAllowedForOrder(nextDocType, order);

        const updatePayload: Record<string, unknown> = {};
        if (data.documentType != null) updatePayload.documentType = data.documentType;
        if (data.emissorId != null) updatePayload.emissorId = data.emissorId;
        if (data.calculationMethod != null) updatePayload.calculationMethod = data.calculationMethod;
        if (data.pricingTableId !== undefined) updatePayload.pricingTableId = data.pricingTableId ?? null;
        if (data.routeId !== undefined) updatePayload.routeId = data.routeId ?? null;
        if (data.fiscalEmitterId !== undefined) updatePayload.fiscalEmitterId = data.fiscalEmitterId ?? null;
        if (data.originCity !== undefined) updatePayload.originCity = data.originCity ?? null;
        if (data.destCity !== undefined) updatePayload.destCity = data.destCity ?? null;
        if (data.cfop !== undefined) updatePayload.cfop = data.cfop ?? null;
        if (data.tipoFrete !== undefined) updatePayload.tipoFrete = data.tipoFrete ?? null;
        if (data.cst !== undefined) updatePayload.cst = data.cst ?? null;
        if (data.observacoes !== undefined) updatePayload.observacoes = data.observacoes ?? null;
        if (data.freightTotal != null) updatePayload.freightTotal = data.freightTotal;
        if (data.breakdown !== undefined) updatePayload.breakdown = data.breakdown;
        if (data.icmsValue !== undefined) updatePayload.icmsValue = data.icmsValue;

        let updated = await prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: updatePayload as object,
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                fiscalEmitter: { include: { person: true, hub: true } },
                pricingTable: { select: { id: true, description: true } },
            },
        });

        if (
            updated.calculationMethod !== 'INFORMADO'
            && updated.status !== 'MINUTA_EMITTED'
            && !FISCAL_LOCKED_STATUSES.includes(updated.status as (typeof FISCAL_LOCKED_STATUSES)[number])
        ) {
            await persistAutoFreightCalculation(orderId, calcId);
        }

        updated = await prisma.orderFreightCalculation.findFirstOrThrow({
            where: { id: calcId },
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                fiscalEmitter: { include: { person: true, hub: true } },
                pricingTable: { select: { id: true, description: true } },
            },
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/orders/:orderId/freight-calculations/:calcId - Remove
router.delete('/:calcId', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, currentHubId: true },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to remove freight calculation from this order', 403);
        }

        const existing = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
        });

        if (!existing) throw new AppError('Cálculo de frete não encontrado', 404);

        if (existing.status === 'MINUTA_EMITTED' || FISCAL_LOCKED_STATUSES.includes(existing.status as typeof FISCAL_LOCKED_STATUSES[number])) {
            throw new AppError('Documento já emitido/enviado não pode ser removido. Mantenha o rastro fiscal/operacional.', 400);
        }

        await prisma.orderFreightCalculation.delete({
            where: { id: calcId },
        });

        res.json({ success: true, message: 'Cálculo removido' });
    } catch (error) {
        next(error);
    }
});

// POST /api/orders/:orderId/freight-calculations/:calcId/calculate - Execute calculation
router.post('/:calcId/calculate', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, currentHubId: true },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to calculate freight for this order', 403);
        }

        await persistAutoFreightCalculation(orderId, calcId);

        const updated = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                pricingTable: { select: { id: true, description: true } },
            },
        });

        if (!updated) throw new AppError('Cálculo de frete não encontrado', 404);

        res.json({
            success: true,
            data: updated,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// GET /api/orders/:orderId/freight-calculations/:calcId/cte-preflight - valida CT-e sem alterar estado
router.get('/:calcId/cte-preflight', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                remetentePerson: true,
                destinatarioPerson: true,
                consignatarioPerson: true,
                expedidorPerson: true,
                invoicesRel: true,
            },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to validate CT-e for this order', 403);
        }

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            include: { fiscalEmitter: { include: { person: true, hub: true } } },
        });

        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        const hub = await prisma.hub.findUnique({
            where: { id: calc.emissorId },
            include: { person: true },
        });

        if (!hub) throw new AppError('Emissor (Hub) não encontrado', 404);

        const { preflight } = buildCteEmissionInputFromRecords({ order, calc, hub });
        res.json({ success: true, data: preflight });
    } catch (error) {
        next(error);
    }
});

// GET .../cte-document?type=xml|pdf — única forma do frontend obter o documento. NUNCA expõe URL da ACBr.
router.get('/:calcId/cte-document', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;
        const type = req.query.type === 'xml' ? 'xml' : 'pdf';

        const order = await prisma.order.findUnique({ where: { id: orderId }, select: { currentHubId: true } });
        if (!order) throw new AppError('Order not found', 404);
        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to access this document', 403);
        }

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            select: { cteXmlStorageKey: true, ctePdfStorageKey: true, status: true },
        });
        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        const key = type === 'xml' ? calc.cteXmlStorageKey : calc.ctePdfStorageKey;
        if (key) {
            const downloadUrl = await getObjectDownloadUrl(key, 300);
            res.json({ success: true, data: { downloadUrl, expiresInSeconds: 300 } });
            return;
        }

        if (calc.status !== 'CTE_AUTHORIZED') {
            throw new AppError('Documento ainda não disponível — CT-e não autorizado.', 404);
        }

        // CT-e autorizado antes desta mudança, sem storage key ainda: nunca expor a URL crua da ACBr.
        // Sinaliza "em migração" — o script de backfill (Task 14) deve rodar antes de habilitar isto em produção,
        // então este caminho só deve ser alcançado em cenários residuais.
        res.status(202).json({
            success: false,
            error: 'Documento ainda está sendo migrado para o repositório interno. Tente novamente em alguns instantes.',
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/orders/:orderId/freight-calculations/:calcId/print-preview - Monta payload para impressão (sem alterar status)
router.get('/:calcId/print-preview', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                remetentePerson: true,
                destinatarioPerson: true,
                consignatarioPerson: true,
                expedidorPerson: true,
                invoicesRel: true,
            },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to print document for this order', 403);
        }

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            include: { emissor: true, fiscalEmitter: { include: { person: true, hub: true } } },
        });

        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        if (calc.freightTotal <= 0) {
            throw new AppError('Calcule o frete ou preencha o valor antes de imprimir.', 400);
        }

        const hub = await prisma.hub.findUnique({
            where: { id: calc.emissorId },
            include: { person: true },
        });

        if (!hub) throw new AppError('Emissor (Hub) não encontrado', 404);
        if (!hub.person && !calc.fiscalEmitter?.person) {
            throw new AppError('O emissor deve ter Pessoa (CNPJ) vinculada para imprimir', 400);
        }

        const emitterPerson = calc.fiscalEmitter?.person ?? hub.person;
        if (!emitterPerson) throw new AppError('O emissor deve ter Pessoa (CNPJ) vinculada para imprimir', 400);

        const emitterPrint = {
            name: calc.fiscalEmitter?.displayName ?? calc.fiscalEmitter?.person.legalName ?? hub.name,
            code: hub.code,
            phone: calc.fiscalEmitter?.hub?.phone ?? hub.phone,
            rntrc: calc.fiscalEmitter?.rntrc ?? hub.rntrc,
        };

        const branding = await getBrandingForFiscalEmitter(calc.fiscalEmitterId);

        const effTaxForPrint =
            calc.documentType === 'CTE' || calc.documentType === 'DCE'
                ? resolveCteCfopCstForEmission(calc, calc.fiscalEmitter)
                : null;

        const calcFields = {
            originCity: calc.originCity,
            destCity: calc.destCity,
            cfop: effTaxForPrint ? effTaxForPrint.cfop : calc.cfop,
            cst: effTaxForPrint ? effTaxForPrint.cst : calc.cst,
            tipoFrete: calc.tipoFrete,
            observacoes: calc.observacoes,
            volumes: calc.volumes,
            weight: calc.weight,
            effectiveWeight: calc.effectiveWeight,
            cubage: calc.cubage,
            nfValue: calc.nfValue,
            commodity: calc.commodity,
            freightTotal: calc.freightTotal,
            breakdown: calc.breakdown,
            icmsValue: calc.icmsValue,
        };

        const orderFields = {
            freightTerm: order.freightTerm,
            remetentePerson: order.remetentePerson,
            destinatarioPerson: order.destinatarioPerson,
            consignatarioPerson: order.consignatarioPerson,
            expedidorPerson: order.expedidorPerson,
            invoicesRel: order.invoicesRel,
            collectionData: order.collectionData,
        };

        if (calc.documentType === 'MINUTA') {
            const emitted = calc.status === 'MINUTA_EMITTED' && calc.minutaNumber?.trim();
            const numero = emitted ? (parseInt(calc.minutaNumber!, 10) || 0) : 0;
            const previewDraft = !emitted;

            const payload = buildMinutaPayload({
                calc: calcFields,
                order: orderFields,
                hub: emitterPrint,
                person: emitterPerson,
                numero,
                previewDraft,
            });

            return res.json({ success: true, payload, branding });
        }

        if (calc.documentType === 'CTE') {
            const ambiente = (calc.cteEnvironment ?? calc.fiscalEmitter?.environment ?? 'HOMOLOGACAO') as CteEnvironment;
            const serie = calc.cteSeries ?? calc.fiscalEmitter?.cteSeries ?? 1;
            const emittedAuth = calc.status === 'CTE_AUTHORIZED' && Boolean(calc.cteAccessKey?.trim());
            const hasNumero = Boolean(calc.cteNumber?.trim());
            const numero = hasNumero ? (parseInt(calc.cteNumber!, 10) || 0) : 0;
            const previewDraft = !emittedAuth;

            const observacoesCte = [calc.observacoes, calc.status === 'CTE_REJECTED' && calc.cteStatusReason ? `Pendência: ${calc.cteStatusReason}` : null]
                .filter((s): s is string => Boolean(s && String(s).trim()))
                .join('\n') || null;

            const payload = buildCtePayload({
                calc: {
                    ...calcFields,
                    observacoes: observacoesCte,
                },
                order: orderFields,
                hub: emitterPrint,
                person: emitterPerson,
                numero,
                serie,
                ambiente,
                chaveAcesso: calc.cteAccessKey ?? null,
                protocolo: calc.cteProtocol ?? null,
                autorizacaoEm: calc.cteAuthorizedAt?.toISOString() ?? null,
                qrCodeUrl: extractQrCodeUrlFromXml(calc.cteXml),
                previewDraft,
            });

            return res.json({ success: true, payload, branding });
        }

        if (calc.documentType === 'DCE') {
            const ambiente = (calc.dceEnvironment ?? calc.fiscalEmitter?.environment ?? 'HOMOLOGACAO') as CteEnvironment;
            const serie = calc.dceSeries ?? calc.cteSeries ?? calc.fiscalEmitter?.cteSeries ?? 1;
            const emittedAuth = calc.status === 'DCE_AUTHORIZED' && Boolean(calc.dceAccessKey?.trim());
            const hasNumero = Boolean(calc.dceNumber?.trim());
            const numero = hasNumero ? (parseInt(calc.dceNumber!, 10) || 0) : 0;
            const previewDraft = !emittedAuth;

            const observacoesDce = [calc.observacoes, calc.status === 'DCE_REJECTED' && calc.dceStatusReason ? `Pendência: ${calc.dceStatusReason}` : null]
                .filter((s): s is string => Boolean(s && String(s).trim()))
                .join('\n') || null;

            const payload = buildCtePayload({
                calc: {
                    ...calcFields,
                    observacoes: observacoesDce,
                },
                order: orderFields,
                hub: emitterPrint,
                person: emitterPerson,
                numero,
                serie,
                ambiente,
                chaveAcesso: calc.dceAccessKey ?? null,
                protocolo: calc.dceProtocol ?? null,
                autorizacaoEm: calc.dceAuthorizedAt?.toISOString() ?? null,
                qrCodeUrl: extractQrCodeUrlFromXml(calc.dceXml),
                previewDraft,
            });

            return res.json({ success: true, payload: { ...payload, documentLabel: 'DC-e' }, branding });
        }

        throw new AppError('Tipo de documento não suportado para impressão.', 400);
    } catch (error) {
        next(error);
    }
});

// POST /api/orders/:orderId/freight-calculations/:calcId/emit-minuta - Emitir Minuta (documento interno)
router.post('/:calcId/emit-minuta', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                remetentePerson: true,
                destinatarioPerson: true,
                consignatarioPerson: true,
                expedidorPerson: true,
                invoicesRel: true,
            },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to emit document for this order', 403);
        }

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            include: { emissor: true, fiscalEmitter: { include: { person: true, hub: true } } },
        });

        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        if (calc.documentType !== 'MINUTA') {
            throw new AppError('Este cálculo não é do tipo Minuta. Use emit-cte para CT-e.', 400);
        }

        if (calc.status === 'MINUTA_EMITTED') {
            throw new AppError('Minuta já emitida para este cálculo.', 400);
        }

        if (calc.freightTotal <= 0) {
            throw new AppError('Calcule o frete ou preencha o valor antes de emitir a minuta.', 400);
        }

        const hub = await prisma.hub.findUnique({
            where: { id: calc.emissorId },
            include: { person: true },
        });

        if (!hub) throw new AppError('Emissor (Hub) não encontrado', 404);
        if (!hub.person && !calc.fiscalEmitter?.person) throw new AppError('O emissor deve ter Pessoa (CNPJ) vinculada para emitir', 400);

        const emitterPerson = calc.fiscalEmitter?.person ?? hub.person;
        if (!emitterPerson) throw new AppError('O emissor deve ter Pessoa (CNPJ) vinculada para emitir', 400);

        // Compare-and-swap: só um pedido de emissão por cálculo passa (duplo toque, lote concorrente).
        const claimed = await prisma.orderFreightCalculation.updateMany({
            where: { id: calcId, orderId, documentType: 'MINUTA', status: calc.status },
            data: { status: 'MINUTA_EMITTED' },
        });
        if (claimed.count !== 1) throw new AppError('Minuta já emitida ou em emissão para este cálculo.', 409);

        let numero: number;
        try {
            numero = calc.fiscalEmitterId
                ? await getNextFiscalEmitterMinutaNumber(calc.fiscalEmitterId)
                : await getNextMinutaNumber(hub.id);
        } catch (error) {
            await prisma.orderFreightCalculation.updateMany({
                where: { id: calcId, status: 'MINUTA_EMITTED', minutaNumber: null },
                data: { status: calc.status },
            });
            throw error;
        }
        const emitterPrint = {
            name: calc.fiscalEmitter?.displayName ?? calc.fiscalEmitter?.person.legalName ?? hub.name,
            code: hub.code,
            phone: calc.fiscalEmitter?.hub?.phone ?? hub.phone,
            rntrc: calc.fiscalEmitter?.rntrc ?? hub.rntrc,
        };

        const payload = buildMinutaPayload({
            calc: {
                originCity: calc.originCity,
                destCity: calc.destCity,
                cfop: calc.cfop,
                cst: calc.cst,
                tipoFrete: calc.tipoFrete,
                observacoes: calc.observacoes,
                volumes: calc.volumes,
                weight: calc.weight,
                effectiveWeight: calc.effectiveWeight,
                cubage: calc.cubage,
                nfValue: calc.nfValue,
                commodity: calc.commodity,
                freightTotal: calc.freightTotal,
                breakdown: calc.breakdown,
                icmsValue: calc.icmsValue,
            },
            order: {
                freightTerm: order.freightTerm,
                remetentePerson: order.remetentePerson,
                destinatarioPerson: order.destinatarioPerson,
                consignatarioPerson: order.consignatarioPerson,
                expedidorPerson: order.expedidorPerson,
                invoicesRel: order.invoicesRel,
                collectionData: order.collectionData,
            },
            hub: emitterPrint,
            person: emitterPerson,
            numero,
        });

        const updated = await prisma.orderFreightCalculation
            .update({
                where: { id: calcId },
                data: {
                    minutaNumber: String(numero),
                    status: 'MINUTA_EMITTED',
                },
                include: {
                    emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                    pricingTable: { select: { id: true, description: true } },
                },
            })
            .catch(async (error: unknown) => {
                await prisma.orderFreightCalculation.updateMany({
                    where: { id: calcId, status: 'MINUTA_EMITTED', minutaNumber: null },
                    data: { status: calc.status },
                });
                throw error;
            });

        const branding = await getBrandingForFiscalEmitter(calc.fiscalEmitterId);

        res.json({
            success: true,
            data: updated,
            payload, // JSON para o frontend gerar impressão/PDF
            branding, // identidade visual (logo, razão social, etc.) para o mesmo fim
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/orders/:orderId/freight-calculations/:calcId/emit-cte - Emitir CT-e (SEFAZ) - estrutura pronta; API externa a integrar
router.post('/:calcId/emit-cte', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                remetentePerson: true,
                destinatarioPerson: true,
                consignatarioPerson: true,
                expedidorPerson: true,
                invoicesRel: true,
            },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to emit document for this order', 403);
        }

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            include: {
                emissor: true,
                fiscalEmitter: { include: { person: true, hub: true } },
                cteEmissionJobs: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
        });

        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        if (calc.documentType !== 'CTE') {
            throw new AppError('Este cálculo não é do tipo CT-e. Use emit-minuta para Minuta.', 400);
        }

        const pendingReconciliationWithoutSubmission = isPendingReconciliationWithoutSubmission(calc);
        if (
            FISCAL_LOCKED_STATUSES.includes(calc.status as typeof FISCAL_LOCKED_STATUSES[number])
            && !pendingReconciliationWithoutSubmission
        ) {
            const message = calc.status === 'CTE_PENDING_RECONCILIATION'
                ? 'CT-e já tem um documento submetido à ACBr, aguardando reconciliação — use POST .../emit-cte/reconcile (consulta de status); reemissão está bloqueada aqui para evitar duplicidade.'
                : 'CT-e já está preparado, enviado, autorizado ou cancelado para este cálculo.';
            throw new AppError(message, 400);
        }

        if (calc.freightTotal <= 0) {
            throw new AppError('Calcule o frete ou preencha o valor antes de emitir o CT-e.', 400);
        }

        const hub = await prisma.hub.findUnique({
            where: { id: calc.emissorId },
            include: { person: true },
        });

        if (!hub) throw new AppError('Emissor (Hub) não encontrado', 404);
        const providerMode = CTE_PROVIDER_HAPPY_PATH_MODE;
        const { input: cteBaseInput, preflight } = buildCteEmissionInputFromRecords({ order, calc, hub });
        if (!preflight.ok || !cteBaseInput) {
            return res.status(400).json({
                success: false,
                error: `CT-e com pendências fiscais: ${[...preflight.issues, ...preflight.missingFields.map((field) => `Campo obrigatório: ${field}.`)].join(' ')}`,
                data: calc,
                preflight,
            });
        }
        const ambiente = cteBaseInput.ambiente;
        const serie = cteBaseInput.serie;

        const allowedStatusesForEmit: FreightCalcStatus[] = ['DRAFT', 'CALCULATED', 'CTE_REJECTED'];
        if (pendingReconciliationWithoutSubmission) {
            // Já verificamos acima que o último job deste calc está em fase terminal
            // PENDING_RECONCILIATION e nunca teve providerDocId — esse job nunca mais roda no
            // BullMQ (attempts exauridos), então o valor não muda entre esta leitura e o
            // updateMany abaixo. O filtro de status sozinho já serializa contra uma segunda
            // chamada concorrente a este endpoint, sem precisar de filtro relacional no CAS.
            allowedStatusesForEmit.push('CTE_PENDING_RECONCILIATION');
        }

        const ready = await prisma.orderFreightCalculation.updateMany({
            where: {
                id: calcId,
                orderId,
                documentType: 'CTE',
                status: { in: allowedStatusesForEmit },
            },
            data: {
                status: 'CTE_READY',
                cteStatusReason: null,
            },
        });
        if (ready.count !== 1) {
            throw new AppError('CT-e não está em estado elegível para envio. Recarregue o pedido e tente novamente.', 409);
        }

        const numero = calc.fiscalEmitterId
            ? await getNextFiscalEmitterCteNumber(calc.fiscalEmitterId)
            : await getNextCteNumber(hub.id);
        const cteInput = { ...cteBaseInput, numero } satisfies CteEmissionInput;

        await prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: {
                status: 'CTE_SENT',
                cteNumber: String(numero),
                cteSeries: serie,
                cteEnvironment: ambiente,
                cteStatusReason: null,
            },
        });

        const acbrDecision = getAcbrProviderDecision(calc.fiscalEmitter?.provider ?? null);

        if (acbrDecision.willUseAcbrHttp) {
            // Caminho real ACBr: assíncrono. Cria o job de emissão e enfileira — nunca chama a ACBr aqui.
            // Este bloco fica isolado num try/catch próprio: o calc já foi marcado CTE_SENT acima e
            // CTE_SENT está em FISCAL_LOCKED_STATUSES (bloqueia recálculo/reemissão). Se criar o job,
            // enfileirar ou persistir o queueJobId falhar (ex.: blip do Redis), o calc NÃO pode ficar
            // preso em CTE_SENT — isso seria um estado órfão sem nenhuma saída via API (nem reconcile,
            // que só aceita CTE_PENDING_RECONCILIATION, nem reemissão, bloqueada por FISCAL_LOCKED_STATUSES).
            // Por isso, qualquer falha aqui reclassifica o calc para CTE_PENDING_RECONCILIATION — o
            // mesmo estado "precisa de atenção humana" já usado pelo processor (markPendingReconciliation
            // em cteEmissionProcessor.ts) — e relança o erro original para o caller ver a falha (500).
            let emissionJob: Awaited<ReturnType<typeof prisma.cteEmissionJob.create>> | null = null;
            try {
                emissionJob = await prisma.cteEmissionJob.create({
                    data: { calcId, phase: 'QUEUED' },
                });
                const queueJobId = await enqueueCteEmissionJob({ calcId, cteEmissionJobId: emissionJob.id, phaseHint: 'submit' });
                await prisma.cteEmissionJob.update({ where: { id: emissionJob.id }, data: { queueJobId } });
            } catch (enqueueError) {
                const errMessage = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
                // Nenhum documento chega a ser submetido à ACBr neste bloco (isso só acontece depois,
                // no worker), então o `providerDocId` do job nunca existe aqui — ou seja, mesmo a
                // reconciliação (/emit-cte/reconcile) não consegue agir sozinha neste estado exato
                // (ela exige um job com `providerDocId` já preenchido). E reemitir via este mesmo
                // endpoint também não é possível a partir de CTE_PENDING_RECONCILIATION, que está em
                // FISCAL_LOCKED_STATUSES. Por isso a mensagem não promete "refaça a emissão" — só
                // deixa claro que precisa de intervenção do suporte/administrador.
                //
                // As duas escritas abaixo usam `updateMany` com um filtro de estado (compare-and-swap)
                // em vez de `update`: é possível que `enqueueCteEmissionJob` tenha de fato colocado o
                // job na fila (BullMQ) antes de o `queueJobId` falhar ao persistir — nesse caso um
                // worker pode já estar processando o job concorrentemente com este catch. Sem o
                // filtro, escreveríamos CTE_PENDING_RECONCILIATION por cima de um resultado real
                // (ex.: CTE_PROCESSING/CTE_AUTHORIZED/CTE_REJECTED) que o worker já persistiu.
                await prisma.orderFreightCalculation.updateMany({
                    where: { id: calcId, status: 'CTE_SENT' },
                    data: {
                        status: 'CTE_PENDING_RECONCILIATION',
                        cteStatusReason: 'Falha ao enfileirar a emissão assíncrona do CT-e. Nenhum documento foi enviado à ACBr — contate o suporte técnico para reprocessar este cálculo.',
                    },
                });
                if (emissionJob) {
                    try {
                        await prisma.cteEmissionJob.updateMany({
                            where: { id: emissionJob.id, phase: 'QUEUED' },
                            data: { phase: 'PENDING_RECONCILIATION', lastError: errMessage },
                        });
                    } catch {
                        // Best-effort: não deixa uma falha secundária ao marcar o job mascarar o erro original.
                    }
                }
                throw enqueueError;
            }

            const updated = await prisma.orderFreightCalculation.findUniqueOrThrow({
                where: { id: calcId },
                include: {
                    emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                    pricingTable: { select: { id: true, description: true } },
                },
            });

            res.status(202).json({
                success: true,
                data: updated,
                // Não-nulo aqui: o catch acima sempre relança (nunca cai para fora do try/catch
                // deixando `emissionJob` como null quando o bloco todo teve sucesso).
                job: { id: emissionJob!.id, phase: emissionJob!.phase },
                message: pendingReconciliationWithoutSubmission
                    ? 'CT-e reenviado para processamento assíncrono — a tentativa anterior não chegou a submeter nenhum documento à ACBr, então este é um envio novo, sem risco de duplicidade.'
                    : 'CT-e enviado para processamento assíncrono. Acompanhe o status do cálculo.',
            });
            return;
        }

        // Modo simulado local (sem ACBr real): continua síncrono, rápido, sem custo — comportamento preservado.
        const providerResult = await authorizeCteWithProvider(cteInput, {
            mode: providerMode,
            fiscalEmitterProvider: calc.fiscalEmitter?.provider ?? null,
            fiscalEmitterContext: calc.fiscalEmitter
                ? {
                      crt: calc.fiscalEmitter.crt,
                      environment: calc.fiscalEmitter.environment as 'HOMOLOGACAO' | 'PRODUCAO',
                      certificateStorageKey: calc.fiscalEmitter.certificateStorageKey,
                      certificatePasswordEncrypted: calc.fiscalEmitter.certificatePasswordEncrypted,
                  }
                : null,
        });
        const now = new Date();
        const payload = buildCtePayload({
            ...cteInput,
            calc: {
                ...cteInput.calc,
                originCity: cteInput.calc.originCity ?? null,
                destCity: cteInput.calc.destCity ?? null,
                cfop: cteInput.calc.cfop ?? null,
                cst: cteInput.calc.cst ?? null,
                tipoFrete: cteInput.calc.tipoFrete ?? null,
                observacoes: cteInput.calc.observacoes ?? null,
                commodity: cteInput.calc.commodity ?? null,
            },
            order: {
                ...cteInput.order,
                freightTerm: cteInput.order.freightTerm ?? null,
            },
            chaveAcesso: providerResult.accessKey ?? null,
            protocolo: providerResult.protocol ?? null,
            autorizacaoEm: providerResult.status === 'AUTHORIZED' ? now.toISOString() : null,
            qrCodeUrl: providerResult.xml ? extractQrCodeUrlFromXml(providerResult.xml) : null,
        });
        const fiscalData = providerResult.status === 'AUTHORIZED'
            ? {
                status: 'CTE_AUTHORIZED' as const,
                cteAccessKey: providerResult.accessKey ?? null,
                cteProtocol: providerResult.protocol ?? null,
                cteXml: providerResult.xml ?? null,
                ctePdfUrl: providerResult.pdfUrl ?? null,
                cteStatusReason: null,
                cteAuthorizedAt: now,
                cteRejectedAt: null,
            }
            : {
                status: 'CTE_REJECTED' as const,
                cteAccessKey: null,
                cteProtocol: null,
                cteXml: null,
                ctePdfUrl: null,
                cteStatusReason: providerResult.rejectionReason ?? 'CT-e rejeitado pelo provedor fiscal.',
                cteAuthorizedAt: null,
                cteRejectedAt: now,
            };

        const updated = await prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: fiscalData,
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                pricingTable: { select: { id: true, description: true } },
            },
        });

        const branding = await getBrandingForFiscalEmitter(calc.fiscalEmitterId);

        res.json({
            success: true,
            data: updated,
            payload, // payload montado para envio à API fiscal
            branding, // identidade visual para DANFE / impressão
            fiscal: providerResult,
            message: providerResult.status === 'AUTHORIZED'
                ? 'CT-e autorizado pelo provider fiscal configurado.'
                : 'CT-e rejeitado pelo provider fiscal configurado.',
        });
    } catch (error) {
        next(error);
    }
});

// POST .../emit-cte/reconcile — só permite a partir de CTE_PENDING_RECONCILIATION.
// Reenfileira em modo 'poll-only': NUNCA refaz POST /cte, só consulta o status já existente.
router.post('/:calcId/emit-cte/reconcile', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            include: { cteEmissionJobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);
        if (calc.status !== 'CTE_PENDING_RECONCILIATION') {
            throw new AppError('Reconciliação só é permitida quando o CT-e está em estado de alerta/conciliação.', 400);
        }
        const lastJob = calc.cteEmissionJobs[0];
        if (!lastJob?.providerDocId) {
            throw new AppError(
                'Nenhum documento foi submetido à ACBr ainda para este cálculo — reconciliação (consulta de status) não se aplica aqui. Use POST .../emit-cte para reemitir do zero: é seguro, pois nada chegou a ser enviado à ACBr.',
                400,
            );
        }

        await prisma.cteEmissionJob.update({ where: { id: lastJob.id }, data: { phase: 'POLLING', attemptCount: 0, pausedForQuota: false } });
        const queueJobId = await enqueueCteEmissionJob({ calcId, cteEmissionJobId: lastJob.id, phaseHint: 'poll-only' });
        await prisma.cteEmissionJob.update({ where: { id: lastJob.id }, data: { queueJobId } });
        await prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { status: 'CTE_PROCESSING', cteStatusReason: null } });

        res.status(202).json({ success: true, message: 'Reconciliação reenfileirada — apenas consulta de status, sem novo envio à ACBr.' });
    } catch (error) {
        next(error);
    }
});

// POST .../emit-dce — DC-e (declaração sem NF-e completa) via ACBr ou simulação
router.post('/:calcId/emit-dce', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                remetentePerson: true,
                destinatarioPerson: true,
                consignatarioPerson: true,
                expedidorPerson: true,
                invoicesRel: true,
            },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to emit document for this order', 403);
        }

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            include: { emissor: true, fiscalEmitter: { include: { person: true, hub: true } } },
        });

        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        if (calc.documentType !== 'DCE') {
            throw new AppError('Este cálculo não é do tipo DC-e. Escolha documento DC-e ou use emit-cte.', 400);
        }

        const dceLocked = ['DCE_READY', 'DCE_SENT', 'DCE_AUTHORIZED', 'DCE_CANCELLED'] as const;
        if (dceLocked.includes(calc.status as (typeof dceLocked)[number])) {
            throw new AppError('DC-e já enviado, autorizado ou cancelado para este cálculo.', 400);
        }

        if (calc.freightTotal <= 0) {
            throw new AppError('Calcule o frete ou preencha o valor antes de emitir o DC-e.', 400);
        }

        const hub = await prisma.hub.findUnique({
            where: { id: calc.emissorId },
            include: { person: true },
        });

        if (!hub) throw new AppError('Emissor (Hub) não encontrado', 404);

        if (!calc.fiscalEmitterId || !calc.fiscalEmitter || !calc.fiscalEmitter.active) {
            throw new AppError('É obrigatório vincular um emitente credenciado ativo a este cálculo para emitir DC-e.', 400);
        }
        if (!calc.fiscalEmitter.person) throw new AppError('Emitente credenciado sem pessoa jurídica vinculada.', 400);

        const ambiente = (calc.fiscalEmitter.environment ?? 'HOMOLOGACAO') as CteEnvironment;
        const providerMode = CTE_PROVIDER_HAPPY_PATH_MODE;
        const serie = calc.fiscalEmitter.cteSeries ?? 1;
        const emitterPerson = calc.fiscalEmitter.person;
        const emitterPrint = {
            id: hub.id,
            name: calc.fiscalEmitter.displayName ?? calc.fiscalEmitter.person.legalName ?? hub.name,
            code: hub.code,
            phone: calc.fiscalEmitter.hub?.phone ?? hub.phone,
            rntrc: calc.fiscalEmitter.rntrc ?? hub.rntrc,
        };

        const dceEffectiveTax = resolveCteCfopCstForEmission(calc, calc.fiscalEmitter);

        const dceBaseInput = {
            calc: {
                id: calc.id,
                originCity: calc.originCity,
                destCity: calc.destCity,
                cfop: dceEffectiveTax.cfop,
                cst: dceEffectiveTax.cst,
                tipoFrete: calc.tipoFrete,
                observacoes: calc.observacoes,
                volumes: calc.volumes,
                weight: calc.weight,
                effectiveWeight: calc.effectiveWeight,
                cubage: calc.cubage,
                nfValue: calc.nfValue,
                commodity: calc.commodity,
                freightTotal: calc.freightTotal,
                breakdown: calc.breakdown,
                icmsValue: calc.icmsValue,
            },
            order: {
                freightTerm: order.freightTerm,
                remetentePerson: order.remetentePerson,
                destinatarioPerson: order.destinatarioPerson,
                consignatarioPerson: order.consignatarioPerson,
                expedidorPerson: order.expedidorPerson,
                invoicesRel: order.invoicesRel,
                collectionData: order.collectionData,
            },
            hub: emitterPrint,
            person: emitterPerson,
            numero: 0,
            serie,
            ambiente,
        } satisfies CteEmissionInput;

        const readiness = validateDceReadiness(dceBaseInput);
        if (!readiness.ok) {
            const rejected = await prisma.orderFreightCalculation.update({
                where: { id: calcId },
                data: {
                    status: 'DCE_REJECTED',
                    dceStatusReason: readiness.issues.join(' '),
                    dceRejectedAt: new Date(),
                },
                include: {
                    emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                    pricingTable: { select: { id: true, description: true } },
                },
            });
            return res.status(400).json({
                success: false,
                error: `DC-e com pendências: ${readiness.issues.join(' ')}`,
                data: rejected,
            });
        }

        const ready = await prisma.orderFreightCalculation.updateMany({
            where: {
                id: calcId,
                orderId,
                documentType: 'DCE',
                status: { in: ['DRAFT', 'CALCULATED', 'DCE_REJECTED'] },
            },
            data: {
                status: 'DCE_READY',
                dceStatusReason: null,
            },
        });
        if (ready.count !== 1) {
            throw new AppError('DC-e não está em estado elegível para envio. Recarregue o pedido e tente novamente.', 409);
        }

        const numero = calc.fiscalEmitterId
            ? await getNextFiscalEmitterDceNumber(calc.fiscalEmitterId)
            : await getNextDceNumber(hub.id);
        const dceInput = { ...dceBaseInput, numero } satisfies CteEmissionInput;

        await prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: {
                status: 'DCE_SENT',
                dceNumber: String(numero),
                dceSeries: serie,
                dceEnvironment: ambiente,
                dceStatusReason: null,
            },
        });

        const providerResult = await authorizeDceWithProvider(dceInput, {
            mode: providerMode,
            fiscalEmitterProvider: calc.fiscalEmitter?.provider ?? null,
        });
        const now = new Date();
        const payload = buildCtePayload({
            ...dceInput,
            chaveAcesso: providerResult.accessKey ?? null,
            protocolo: providerResult.protocol ?? null,
            autorizacaoEm: providerResult.status === 'AUTHORIZED' ? now.toISOString() : null,
            qrCodeUrl: providerResult.xml ? extractQrCodeUrlFromXml(providerResult.xml) : null,
        });
        const fiscalData =
            providerResult.status === 'AUTHORIZED'
                ? {
                    status: 'DCE_AUTHORIZED' as const,
                    dceAccessKey: providerResult.accessKey ?? null,
                    dceProtocol: providerResult.protocol ?? null,
                    dceXml: providerResult.xml ?? null,
                    dcePdfUrl: providerResult.pdfUrl ?? null,
                    dceStatusReason: null,
                    dceAuthorizedAt: now,
                    dceRejectedAt: null,
                }
                : {
                    status: 'DCE_REJECTED' as const,
                    dceAccessKey: null,
                    dceProtocol: null,
                    dceXml: null,
                    dcePdfUrl: null,
                    dceStatusReason: providerResult.rejectionReason ?? 'DC-e rejeitado.',
                    dceAuthorizedAt: null,
                    dceRejectedAt: now,
                };

        const updated = await prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: fiscalData,
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                pricingTable: { select: { id: true, description: true } },
            },
        });

        const branding = await getBrandingForFiscalEmitter(calc.fiscalEmitterId);

        res.json({
            success: true,
            data: updated,
            payload: { ...payload, documentLabel: 'DC-e' },
            branding,
            fiscal: providerResult,
            message:
                providerResult.status === 'AUTHORIZED'
                    ? 'DC-e autorizado pelo provedor fiscal configurado.'
                    : 'DC-e rejeitado pelo provedor fiscal configurado.',
        });
    } catch (error) {
        next(error);
    }
});

// ==================== TSM O.S.: documento do frete em um toque ====================

async function assertOrderAtActingHub(req: AuthRequest, orderId: string): Promise<string> {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { currentHubId: true } });
    if (!order) throw new AppError('Order not found', 404);
    if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
        throw new AppError('Not authorized to access this order', 403);
    }
    if (!order.currentHubId) throw new AppError('Pedido sem hub atual: o documento do frete sai do hub que tem a carga.', 400);
    return order.currentHubId;
}

// GET /api/orders/:orderId/freight-calculations/suggestion — pagador, documento, emitente, preço e pendências.
router.get('/suggestion', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        await assertOrderAtActingHub(req, orderId);
        res.json({ success: true, data: await getFreightSuggestion(orderId) });
    } catch (error) {
        next(error);
    }
});

const informedSchema = z.object(
    Object.fromEntries(BREAKDOWN_KEYS.map((key) => [key, z.number().nonnegative().max(10_000_000).optional()])) as Record<
        (typeof BREAKDOWN_KEYS)[number],
        z.ZodOptional<z.ZodNumber>
    >,
);
const prepareSchema = z.object({
    documentType: z.enum(['CTE', 'DCE', 'MINUTA']),
    pricingTableId: z.string().trim().min(1).max(128).optional(),
    informed: informedSchema.optional(),
    reason: z.string().trim().max(500).optional(),
    /** Outro documento além do já emitido (o pedido pode ter vários cálculos). */
    newDocument: z.boolean().optional(),
});

// POST /api/orders/:orderId/freight-calculations/prepare — deixa o cálculo pronto para emitir, sem duplicar:
// documento ativo do mesmo tipo é devolvido; rascunho/rejeitado é reaproveitado; senão cria. Trava por pedido.
router.post('/prepare', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const body = prepareSchema.parse(req.body);
        const hubId = await assertOrderAtActingHub(req, orderId);
        const suggestion = await getFreightSuggestion(orderId);

        if (!suggestion.docs.allowed.includes(body.documentType)) throw new AppError(suggestion.docs.reason, 400);
        const pricing = body.pricingTableId
            ? suggestion.tableOptions?.find((option) => option.tableId === body.pricingTableId) ?? null
            : suggestion.pricing;
        if (body.pricingTableId && !pricing) {
            throw new AppError('A tabela escolhida não está disponível para este pedido. Atualize as opções de frete.', 400);
        }
        const informed = body.informed ? informedFreight(body.informed) : null;
        if (informed && informed.total <= 0) throw new AppError('Informe ao menos um valor do frete.', 400);
        if (informed && (suggestion.pricing || suggestion.tableOptions?.length) && !body.reason) {
            throw new AppError('Diga o motivo para usar um valor diferente do da tabela.', 400);
        }
        if (!informed && !pricing) throw new AppError('Sem tabela de preço para este pedido: informe o valor do frete.', 400);
        const fiscalEmitterId = suggestion.emitter?.id ?? null;
        if (body.documentType !== 'MINUTA' && !fiscalEmitterId) {
            throw new AppError('Este hub não tem emitente fiscal ativo para CT-e/DC-e. Fale com a torre.', 400);
        }
        await validateFiscalEmitterSelection({ emissorId: hubId, fiscalEmitterId, user: req.user });

        const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { invoicesRel: true } });
        assertFreightDocTypeAllowedForOrder(body.documentType, order);
        const params = getOrderParams(order);
        const method: 'INFORMADO' | 'ESPECIAL' | 'TARIFA_GERAL' = informed ? 'INFORMADO' : pricing!.method;
        const fields = {
            documentType: body.documentType,
            emissorId: hubId,
            fiscalEmitterId,
            calculationMethod: method,
            pricingTableId: informed ? null : pricing!.tableId,
            routeId: informed ? null : pricing!.routeId,
            ...(informed
                ? { freightTotal: informed.total, breakdown: informed.breakdown as object, icmsValue: informed.breakdown.icms || null, status: 'DRAFT' as const }
                : {}),
        };

        const prepared = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`;
            const calcs = await tx.orderFreightCalculation.findMany({ where: { orderId, documentType: body.documentType }, orderBy: { createdAt: 'desc' } });
            const active = calcs.find((c) => ACTIVE_DOC_STATUSES.includes(c.status));
            if (active && !body.newDocument) return { calc: active, alreadyActive: true, created: false };
            const reusable = calcs.find((c) => REUSABLE_STATUSES.includes(c.status));
            if (reusable) {
                return { calc: await tx.orderFreightCalculation.update({ where: { id: reusable.id }, data: fields }), alreadyActive: false, created: false };
            }
            const cd = (order.collectionData || {}) as Record<string, unknown>;
            const calc = await tx.orderFreightCalculation.create({
                data: {
                    orderId,
                    ...fields,
                    originCity: order.origemPrestacao ?? null,
                    destCity: order.fimPrestacao ?? null,
                    volumes: params.volumes,
                    weight: params.weight,
                    cubage: params.cubage ?? null,
                    nfValue: params.nfValue || 0,
                    commodity: (cd.commodity as string) || null,
                },
            });
            return { calc, alreadyActive: false, created: true };
        });

        if (!prepared.alreadyActive) {
            if (informed) {
                await prisma.orderHistory.create({
                    data: {
                        orderId,
                        eventType: 'NOTE',
                        actorUserId: req.user!.id,
                        description: `Frete informado pelo hub: R$ ${informed.total.toFixed(2)}${body.reason ? ` — motivo: ${body.reason}` : ' — sem tabela de preço aplicável'}`,
                    },
                });
            } else {
                try {
                    await persistAutoFreightCalculation(orderId, prepared.calc.id);
                } catch (error) {
                    if (prepared.created) await prisma.orderFreightCalculation.delete({ where: { id: prepared.calc.id } });
                    throw error;
                }
            }
        }

        const calc = await prisma.orderFreightCalculation.findUniqueOrThrow({
            where: { id: prepared.calc.id },
            include: { fiscalEmitter: { include: { person: true, hub: true } } },
        });
        let preflight: CtePreflightResult | null = null;
        if (calc.documentType === 'CTE') {
            const full = await prisma.order.findUniqueOrThrow({
                where: { id: orderId },
                include: { remetentePerson: true, destinatarioPerson: true, consignatarioPerson: true, expedidorPerson: true, invoicesRel: true },
            });
            const hub = await prisma.hub.findUniqueOrThrow({ where: { id: calc.emissorId }, include: { person: true } });
            preflight = buildCteEmissionInputFromRecords({ order: full, calc, hub }).preflight;
        }
        res.status(prepared.created ? 201 : 200).json({ success: true, data: { calc, preflight, alreadyActive: prepared.alreadyActive } });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0]?.message ?? 'Dados inválidos.', 400));
        next(error);
    }
});

export { router as freightCalculationsRouter };
