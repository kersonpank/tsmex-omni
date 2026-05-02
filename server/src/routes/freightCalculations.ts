import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
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
import { authorizeCteWithProvider, validateCteReadiness, type CteEmissionInput, type CteEnvironment, type CteProviderMode } from '../services/cteService.js';
import { authorizeDceWithProvider, validateDceReadiness } from '../services/dceService.js';
import { getBrandingForFiscalEmitter } from '../services/visualIdentityService.js';
import { getFiscalDocModeForFreight } from '../services/fiscal/fiscalDocPolicy.js';

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

/** Modo simulado sem variável Portainer; emissão ACBr real não usa este valor. */
const SIMULATED_FISCAL_PROVIDER_MODE: CteProviderMode = 'simulate-authorized';

const FISCAL_LOCKED_STATUSES = [
    'CTE_READY',
    'CTE_SENT',
    'CTE_AUTHORIZED',
    'CTE_CANCELLED',
    'DCE_READY',
    'DCE_SENT',
    'DCE_AUTHORIZED',
    'DCE_CANCELLED',
] as const;

// Helper: coleta parâmetros do pedido (volumes, peso, cubagem, valor NF)
function getOrderParams(order: { invoicesRel: { volumes: number; weight: number; cubedVolume: number | null; value: number }[]; collectionData: unknown }) {
    const inv = order.invoicesRel || [];
    const cd = (order.collectionData || {}) as Record<string, unknown>;

    const volumes = inv.reduce((s, i) => s + (i.volumes || 0), 0) || (cd.volumes != null ? Number(cd.volumes) : 0);
    const weight = inv.reduce((s, i) => s + (i.weight || 0), 0) || (cd.weight != null ? Number(cd.weight) : 0);
    const value = inv.reduce((s, i) => s + (i.value || 0), 0) || (cd.nfValue != null ? Number(cd.nfValue) : 0);

    let cubedVolume = inv.reduce((s, i) => s + (i.cubedVolume || 0), 0);
    if (cubedVolume === 0 && cd.cubedVolume != null) cubedVolume = Number(cd.cubedVolume);
    const cubage = cubedVolume > 0 ? cubedVolume : undefined;

    return { volumes, weight, cubage, nfValue: value };
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

        const calc = await prisma.orderFreightCalculation.create({
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

        const updated = await prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: updatePayload as object,
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
            include: {
                invoicesRel: true,
                demand: { include: { client: true } },
            },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to calculate freight for this order', 403);
        }

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            include: {
                pricingTable: { include: { minFreightRanges: { orderBy: { minWeight: 'asc' } } } },
            },
        });

        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        if (calc.status === 'MINUTA_EMITTED' || FISCAL_LOCKED_STATUSES.includes(calc.status as typeof FISCAL_LOCKED_STATUSES[number])) {
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
            // TARIFA_GERAL: buscar tabela GENERAL pela rota
            const routeId = calc.routeId || order.routeId;
            if (!routeId) {
                throw new AppError('Método Tarifa Geral exige uma rota. Informe a rota ou vincule ao pedido.', 400);
            }

            const route = await prisma.pricingRoute.findUnique({
                where: { id: routeId },
            });

            if (!route) throw new AppError('Rota não encontrada', 404);

            if (!table || calc.calculationMethod === 'TARIFA_GERAL') {
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

        // Executar cálculo (lógica do pricing/calculate)
        const cubeFactor = table!.cubeFactor || 300;
        const volume = cubage ?? (weight / 300); // fallback m³
        const cubedWeight = volume * cubeFactor;
        const effectiveWeight = Math.max(weight, cubedWeight);

        let baseFreight = 0;
        switch (table!.freightUnit) {
            case 'RS_KG':
                baseFreight = effectiveWeight * (table!.freightValue || 0);
                break;
            case 'RS_M3':
                baseFreight = volume * (table!.freightValue || 0);
                break;
            case 'RS_UNIT':
                baseFreight = volumes * (table!.freightValue || 0);
                break;
            case 'PERCENT':
                baseFreight = nfValue * (table!.freightValue || 0) / 100;
                break;
        }

        let minFreightValue = table!.minFreightValue || 0;
        const minRanges = table!.minFreightRanges || [];
        if (minRanges.length > 0) {
            const r = minRanges.find(
                (r: { minWeight: number; maxWeight: number | null }) =>
                    effectiveWeight >= r.minWeight && (r.maxWeight == null || effectiveWeight <= r.maxWeight)
            );
            if (r && r.value > baseFreight) {
                minFreightValue = r.value;
                baseFreight = minFreightValue;
            }
        } else if (minFreightValue > baseFreight) {
            baseFreight = minFreightValue;
        }

        const adValorem = (table!.adValoremPercent || 0) * (nfValue / 1000);
        const gris = (table!.grisPercent || 0) * (nfValue / 1000);

        let toll = 0;
        if (table!.tollUnit === 'RS_KG') {
            toll = effectiveWeight * (table!.tollValue || 0);
        } else if (table!.tollUnit === 'FIXED') {
            toll = table!.tollValue || 0;
        }

        const dispatch = table!.dispatchFee || 0;
        const others = table!.otherFees || 0;
        const subtotal = baseFreight + adValorem + gris + toll + dispatch + others;

        let icms = 0;
        if (!table!.icmsIncluded && table!.icmsPercent) {
            icms = subtotal * (table!.icmsPercent / 100);
        }

        const total = subtotal + icms;

        const breakdown = {
            freightBase: baseFreight,
            adValorem,
            gris,
            toll,
            dispatch,
            others,
            icms,
        };

        const updated = await prisma.orderFreightCalculation.update({
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
                routeId: calc.calculationMethod === 'TARIFA_GERAL' ? (calc.routeId || order.routeId) : calc.routeId,
            },
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                pricingTable: { select: { id: true, description: true } },
            },
        });

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

        const calcFields = {
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

        const numero = calc.fiscalEmitterId
            ? await getNextFiscalEmitterMinutaNumber(calc.fiscalEmitterId)
            : await getNextMinutaNumber(hub.id);
        const emitterPerson = calc.fiscalEmitter?.person ?? hub.person;
        if (!emitterPerson) throw new AppError('O emissor deve ter Pessoa (CNPJ) vinculada para emitir', 400);
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

        const updated = await prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: {
                minutaNumber: String(numero),
                status: 'MINUTA_EMITTED',
            },
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                pricingTable: { select: { id: true, description: true } },
            },
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
            include: { emissor: true, fiscalEmitter: { include: { person: true, hub: true } } },
        });

        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        if (calc.documentType !== 'CTE') {
            throw new AppError('Este cálculo não é do tipo CT-e. Use emit-minuta para Minuta.', 400);
        }

        if (FISCAL_LOCKED_STATUSES.includes(calc.status as typeof FISCAL_LOCKED_STATUSES[number])) {
            throw new AppError('CT-e já está preparado, enviado, autorizado ou cancelado para este cálculo.', 400);
        }

        if (calc.freightTotal <= 0) {
            throw new AppError('Calcule o frete ou preencha o valor antes de emitir o CT-e.', 400);
        }

        const hub = await prisma.hub.findUnique({
            where: { id: calc.emissorId },
            include: { person: true },
        });

        if (!hub) throw new AppError('Emissor (Hub) não encontrado', 404);

        if (!calc.fiscalEmitterId || !calc.fiscalEmitter || !calc.fiscalEmitter.active) {
            throw new AppError('É obrigatório vincular um emitente credenciado ativo a este cálculo para emitir CT-e.', 400);
        }

        if (!calc.fiscalEmitter.person) throw new AppError('Emitente credenciado sem pessoa jurídica vinculada.', 400);

        if (!calc.fiscalEmitter.rntrc?.trim() && !hub.rntrc?.trim()) {
            throw new AppError('O emitente credenciado ou Hub emissor deve ter RNTRC cadastrado para emitir CT-e.', 400);
        }

        const ambiente = (calc.fiscalEmitter.environment ?? 'HOMOLOGACAO') as CteEnvironment;
        const providerMode = SIMULATED_FISCAL_PROVIDER_MODE;
        const serie = calc.fiscalEmitter.cteSeries ?? 1;
        const emitterPerson = calc.fiscalEmitter.person;
        const emitterPrint = {
            id: hub.id,
            name: calc.fiscalEmitter.displayName ?? calc.fiscalEmitter.person.legalName ?? hub.name,
            code: hub.code,
            phone: calc.fiscalEmitter.hub?.phone ?? hub.phone,
            rntrc: calc.fiscalEmitter.rntrc ?? hub.rntrc,
        };

        const cteBaseInput = {
            calc: {
                id: calc.id,
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
            numero: 0,
            serie,
            ambiente,
        } satisfies CteEmissionInput;

        const readiness = validateCteReadiness(cteBaseInput);
        if (!readiness.ok) {
            const rejected = await prisma.orderFreightCalculation.update({
                where: { id: calcId },
                data: {
                    status: 'CTE_REJECTED',
                    cteStatusReason: readiness.issues.join(' '),
                    cteRejectedAt: new Date(),
                },
                include: {
                    emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                    pricingTable: { select: { id: true, description: true } },
                },
            });
            return res.status(400).json({
                success: false,
                error: `CT-e com pendências fiscais: ${readiness.issues.join(' ')}`,
                data: rejected,
            });
        }

        const ready = await prisma.orderFreightCalculation.updateMany({
            where: {
                id: calcId,
                orderId,
                documentType: 'CTE',
                status: { in: ['DRAFT', 'CALCULATED', 'CTE_REJECTED'] },
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

        const providerResult = await authorizeCteWithProvider(cteInput, {
            mode: providerMode,
            fiscalEmitterProvider: calc.fiscalEmitter?.provider ?? null,
        });
        const now = new Date();
        const payload = buildCtePayload({
            ...cteInput,
            chaveAcesso: providerResult.accessKey ?? null,
            protocolo: providerResult.protocol ?? null,
            autorizacaoEm: providerResult.status === 'AUTHORIZED' ? now.toISOString() : null,
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
        const providerMode = SIMULATED_FISCAL_PROVIDER_MODE;
        const serie = calc.fiscalEmitter.cteSeries ?? 1;
        const emitterPerson = calc.fiscalEmitter.person;
        const emitterPrint = {
            id: hub.id,
            name: calc.fiscalEmitter.displayName ?? calc.fiscalEmitter.person.legalName ?? hub.name,
            code: hub.code,
            phone: calc.fiscalEmitter.hub?.phone ?? hub.phone,
            rntrc: calc.fiscalEmitter.rntrc ?? hub.rntrc,
        };

        const dceBaseInput = {
            calc: {
                id: calc.id,
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

export { router as freightCalculationsRouter };
