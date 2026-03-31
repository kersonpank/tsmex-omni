import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { getNextMinutaNumber, getNextCteNumber, buildMinutaPayload, buildCtePayload } from '../services/freightEmission.js';

const router = Router({ mergeParams: true });

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
const createFreightCalcSchema = z.object({
    documentType: z.enum(['CTE', 'MINUTA']),
    emissorId: z.string().uuid(),
    calculationMethod: z.enum(['ESPECIAL', 'TARIFA_GERAL', 'INFORMADO']),
    pricingTableId: z.string().uuid().optional().nullable(),
    routeId: z.string().uuid().optional().nullable(),
    originCity: z.string().optional().nullable(),
    destCity: z.string().optional().nullable(),
    cfop: z.string().optional().nullable(),
    tipoFrete: z.string().optional().nullable(),
    cst: z.string().optional().nullable(),
    observacoes: z.string().optional().nullable(),
});

const updateFreightCalcSchema = createFreightCalcSchema.partial().extend({
    // Para INFORMADO: breakdown manual
    freightTotal: z.number().optional(),
    breakdown: z.record(z.string(), z.number()).optional().nullable(),
    icmsValue: z.number().optional().nullable(),
});

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

        // HUB user: só pode usar seu hub como emissor
        if (req.user!.roles.includes('HUB') && req.user!.hubId !== data.emissorId) {
            throw new AppError('Você só pode usar seu próprio Hub como emissor', 403);
        }

        const { volumes, weight, cubage, nfValue } = getOrderParams(order);
        const cd = (order.collectionData || {}) as Record<string, unknown>;
        const commodity = (cd.commodity as string) || null;

        const calc = await prisma.orderFreightCalculation.create({
            data: {
                orderId,
                documentType: data.documentType as 'CTE' | 'MINUTA',
                emissorId: data.emissorId,
                calculationMethod: data.calculationMethod as 'ESPECIAL' | 'TARIFA_GERAL' | 'INFORMADO',
                pricingTableId: data.pricingTableId || null,
                routeId: data.routeId || null,
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
            select: { id: true, currentHubId: true },
        });

        if (!order) throw new AppError('Order not found', 404);

        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to update this order', 403);
        }

        const existing = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
        });

        if (!existing) throw new AppError('Cálculo de frete não encontrado', 404);

        const data = updateFreightCalcSchema.partial().parse(req.body);

        const updatePayload: Record<string, unknown> = {};
        if (data.documentType != null) updatePayload.documentType = data.documentType;
        if (data.emissorId != null) updatePayload.emissorId = data.emissorId;
        if (data.calculationMethod != null) updatePayload.calculationMethod = data.calculationMethod;
        if (data.pricingTableId !== undefined) updatePayload.pricingTableId = data.pricingTableId ?? null;
        if (data.routeId !== undefined) updatePayload.routeId = data.routeId ?? null;
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
            include: { emissor: true },
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
        if (!hub.person) throw new AppError('O Hub emissor deve ter Pessoa (CNPJ) vinculada para emitir', 400);

        const numero = await getNextMinutaNumber(hub.id);

        const payload = buildMinutaPayload({
            calc: {
                originCity: calc.originCity,
                destCity: calc.destCity,
                cfop: calc.cfop,
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
            },
            hub: { name: hub.name, code: hub.code, phone: hub.phone, rntrc: hub.rntrc },
            person: hub.person,
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

        res.json({
            success: true,
            data: updated,
            payload, // JSON para o frontend gerar impressão/PDF
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
            include: { emissor: true },
        });

        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        if (calc.documentType !== 'CTE') {
            throw new AppError('Este cálculo não é do tipo CT-e. Use emit-minuta para Minuta.', 400);
        }

        if (calc.status === 'CTE_AUTHORIZED') {
            throw new AppError('CT-e já autorizado para este cálculo.', 400);
        }

        if (calc.freightTotal <= 0) {
            throw new AppError('Calcule o frete ou preencha o valor antes de emitir o CT-e.', 400);
        }

        const hub = await prisma.hub.findUnique({
            where: { id: calc.emissorId },
            include: { person: true },
        });

        if (!hub) throw new AppError('Emissor (Hub) não encontrado', 404);
        if (!hub.person) throw new AppError('O Hub emissor deve ter Pessoa (CNPJ) vinculada para emitir', 400);

        if (!hub.rntrc || !hub.rntrc.trim()) {
            throw new AppError('O Hub emissor deve ter RNTRC cadastrado para emitir CT-e.', 400);
        }

        const numero = await getNextCteNumber(hub.id);

        const payload = buildCtePayload({
            calc: {
                originCity: calc.originCity,
                destCity: calc.destCity,
                cfop: calc.cfop,
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
            },
            hub: { name: hub.name, code: hub.code, phone: hub.phone, rntrc: hub.rntrc },
            person: hub.person,
            numero,
        });

        // TODO: chamar API fiscal (Lonngren, Plugnotas, etc.) com payload; em sucesso gravar cteAccessKey e cteProtocol
        // Por ora apenas simula e retorna payload para testes
        const updated = await prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: {
                status: 'CTE_AUTHORIZED',
                cteAccessKey: null, // preenchido quando integrar API real
                cteProtocol: null,
            },
            include: {
                emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                pricingTable: { select: { id: true, description: true } },
            },
        });

        res.json({
            success: true,
            data: updated,
            payload, // payload montado para envio à API fiscal
            message: 'Integração com API SEFAZ pendente. Payload montado para testes.',
        });
    } catch (error) {
        next(error);
    }
});

export { router as freightCalculationsRouter };
