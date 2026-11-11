import type { FreightCalcStatus, Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { roundMoney } from '../lib/money.js';
import { splitCentsAcrossLegs } from './pricing/revenueSplit.js';

/** Status em que o documento do frete é oficial (CT-e/DC-e autorizado, minuta emitida). */
const OFFICIAL_FREIGHT_STATUSES: FreightCalcStatus[] = ['CTE_AUTHORIZED', 'DCE_AUTHORIZED', 'MINUTA_EMITTED'];
/** Cálculos que nunca valem nem como estimativa (cancelados ou rejeitados). */
const DEAD_FREIGHT_STATUSES: FreightCalcStatus[] = ['CTE_CANCELLED', 'DCE_CANCELLED', 'CTE_REJECTED', 'DCE_REJECTED'];

export interface OrderFreightBreakdown {
    /** Frete cobrado do cliente, com ICMS (valor do documento). */
    gross: number;
    /** ICMS embutido no frete (não é receita da TSM). */
    icms: number;
    /** Frete líquido de ICMS: base da receita e da comissão do hub. */
    net: number;
    /** `OFFICIAL` = documento oficial emitido; `ESTIMATE` = cálculo/cotação sem documento; `NONE` = sem valor. */
    source: 'OFFICIAL' | 'ESTIMATE' | 'NONE';
}

/**
 * Frete do pedido separado em bruto / ICMS / líquido, sempre com 2 casas. Só o documento OFICIAL
 * (CT-e/DC-e autorizado, minuta emitida) é receita realizada; sem ele, o último cálculo vivo ou a
 * cotação da demanda entram como ESTIMATIVA — nunca como receita confirmada.
 */
export async function getOrderFreightBreakdown(orderId: string, tx: Prisma.TransactionClient = prisma): Promise<OrderFreightBreakdown> {
    const build = (freightTotal: number, icmsValue: number | null | undefined, source: 'OFFICIAL' | 'ESTIMATE'): OrderFreightBreakdown => {
        const gross = roundMoney(freightTotal);
        const icms = Math.min(gross, Math.max(0, roundMoney(icmsValue ?? 0)));
        return { gross, icms, net: roundMoney(gross - icms), source };
    };

    const official = await tx.orderFreightCalculation.findFirst({
        where: { orderId, status: { in: OFFICIAL_FREIGHT_STATUSES }, freightTotal: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
    });
    if (official && official.freightTotal > 0) {
        return build(official.freightTotal, official.icmsValue, 'OFFICIAL');
    }

    const draft = await tx.orderFreightCalculation.findFirst({
        where: { orderId, status: { notIn: [...OFFICIAL_FREIGHT_STATUSES, ...DEAD_FREIGHT_STATUSES] }, freightTotal: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
    });
    if (draft && draft.freightTotal > 0) {
        return build(draft.freightTotal, draft.icmsValue, 'ESTIMATE');
    }

    const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { demand: true },
    });
    const quoted = order?.demand?.quotedPrice ?? 0;
    if (quoted > 0) return build(quoted, 0, 'ESTIMATE');
    return { gross: 0, icms: 0, net: 0, source: 'NONE' };
}

/**
 * Frete líquido de ICMS do pedido (base da comissão do hub). Oficial quando há documento emitido;
 * senão, a estimativa (cálculo vivo ou cotação). Ver `getOrderFreightBreakdown`.
 */
export async function getOrderFreightValue(orderId: string, tx: Prisma.TransactionClient = prisma): Promise<number> {
    return (await getOrderFreightBreakdown(orderId, tx)).net;
}

/**
 * Retorna o valor do frete oficial do pedido (OrderFreightCalculation.freightTotal) sem fallbacks.
 * Retorna null se não houver cálculo de frete oficial.
 */
export async function getOfficialFreightTotal(orderId: string, tx: Prisma.TransactionClient = prisma): Promise<number | null> {
    const calc = await tx.orderFreightCalculation.findFirst({
        where: { orderId, status: { in: ['CTE_AUTHORIZED', 'DCE_AUTHORIZED', 'MINUTA_EMITTED'] } },
        orderBy: { createdAt: 'desc' },
    });
    if (calc && calc.freightTotal > 0) {
        return calc.freightTotal;
    }
    return null;
}

/**
 * Normaliza e limpa o nome da cidade para evitar falhas de casamento (ex: "Guarulhos, SP" -> "Guarulhos").
 */
function cleanCity(cityStr: string): string {
    return cityStr.split(/[,|-]/)[0].trim();
}

/**
 * Calcula o custo do Link (motorista) contratado para o manifesto.
 * Retorna null se houver linkId mas nenhum acordo correspondente for encontrado.
 *
 * Fonte de custo (nesta ordem):
 * 1. ManifestFreightAgreement (Carta Frete real da viagem) — freteBruto + pedagio é o
 *    desembolso total real da TSM nesta viagem (deduções como IR/INSS/ISSQN são retidas do
 *    motorista mas continuam sendo custo da TSM, só mudam de destinatário — não abatem o
 *    custo). saldoLiquido (quanto falta pagar ao motorista) é outra métrica, usada no acerto
 *    financeiro (Fatia 3), não na margem.
 * 2. LinkPricingAgreement (estimativa pré-negociada por rota/veículo) — fallback quando a
 *    viagem ainda não tem Carta Frete preenchida.
 */
export async function calculateLinkCost(manifestId: string, tx: Prisma.TransactionClient = prisma): Promise<number | null> {
    const manifest = await tx.manifest.findUnique({
        where: { id: manifestId },
        include: { vehicleType: true, freightAgreement: true },
    });
    if (!manifest) {
        return 0;
    }
    if (!manifest.linkId) {
        return 0; // Custo 0 legítimo (sem linkId, ex. entrega hub próprio)
    }

    if (manifest.freightAgreement) {
        return manifest.freightAgreement.freteBruto + manifest.freightAgreement.pedagio;
    }

    const origin = cleanCity(manifest.origin);
    const destination = cleanCity(manifest.destination);

    // Busca o acordo ativo para o Link, rota e tipo de veículo
    const agreement = await tx.linkPricingAgreement.findFirst({
        where: {
            linkId: manifest.linkId,
            originCity: { contains: origin, mode: 'insensitive' },
            destinationCity: { contains: destination, mode: 'insensitive' },
            vehicleTypeCode: manifest.vehicleType.code,
            active: true,
        },
    });

    if (!agreement) {
        return null; // Acordo não encontrado
    }

    // Calcula de acordo com o costMode
    if (agreement.costMode === 'PER_M3') {
        return (agreement.ratePerM3 || 0) * manifest.totalVolume;
    } else if (agreement.costMode === 'PER_KG') {
        return (agreement.ratePerKg || 0) * manifest.totalWeight;
    } else {
        return agreement.flatRate; // FLAT
    }
}

/**
 * Calcula o custo de comissão/handling de Hub para uma perna de transporte específica.
 * Cobra o Hub de origem apenas na primeira perna (sequence = 1) para evitar cobrança em dobro em hubs intermediários.
 * Cobra o Hub de destino apenas se destHubId não for nulo (pernas de transferência).
 */
export async function calculateLegHubCost(
    leg: { orderId: string; originHubId: string | null; destHubId: string | null; sequence: number },
    freightValue: number,
    tx: Prisma.TransactionClient = prisma
): Promise<number> {
    let hubCost = 0;

    // 1. Origem Hub (somente se for a primeira perna e tiver originHubId)
    if (leg.sequence === 1 && leg.originHubId) {
        const originAgreement = await tx.hubCommissionAgreement.findFirst({
            where: { hubId: leg.originHubId, active: true },
        });
        if (originAgreement) {
            hubCost += originAgreement.handlingFeePerOrder;
            if (originAgreement.percentOfFreight && freightValue > 0) {
                hubCost += (originAgreement.percentOfFreight / 100) * freightValue;
            }
        }
    }

    // 2. Destino Hub (somente se destHubId for informado)
    if (leg.destHubId) {
        const destAgreement = await tx.hubCommissionAgreement.findFirst({
            where: { hubId: leg.destHubId, active: true },
        });
        if (destAgreement) {
            hubCost += destAgreement.handlingFeePerOrder;
            if (destAgreement.percentOfFreight && freightValue > 0) {
                hubCost += (destAgreement.percentOfFreight / 100) * freightValue;
            }
        }
    }

    return hubCost;
}

/**
 * Rateia o custo do Link e soma as comissões de Hub para salvar o allocatedCost de cada perna.
 * Se o custo do Link for indefinido (null), as pernas ficam com allocatedCost = null.
 */
export async function allocateLegCosts(manifestId: string, tx: Prisma.TransactionClient = prisma): Promise<void> {
    const manifest = await tx.manifest.findUnique({
        where: { id: manifestId },
        include: {
            vehicleType: true,
            legs: {
                include: {
                    order: {
                        include: {
                            demand: true,
                        },
                    },
                },
            },
        },
    });

    if (!manifest || manifest.legs.length === 0) {
        return;
    }

    const totalLinkCost = await calculateLinkCost(manifestId, tx);

    // BRIEF 6: Peso efetivo = max(peso, cubedWeight)
    let somaEffWeight = 0;
    const legEffWeights = new Map<string, number>();

    for (const leg of manifest.legs) {
        const weight = leg.order.demand.weight;
        const cubedWeight = leg.order.demand.cubedWeight ?? 0;
        const effWeight = Math.max(weight, cubedWeight);
        legEffWeights.set(leg.orderId, effWeight);
        somaEffWeight += effWeight;
    }

    for (const leg of manifest.legs) {
        // Se custo do Link for null, allocatedCost total da perna fica null (Brief 2)
        if (totalLinkCost === null) {
            await tx.orderLeg.update({
                where: {
                    orderId_manifestId: {
                        orderId: leg.orderId,
                        manifestId: leg.manifestId,
                    },
                },
                data: { allocatedCost: null },
            });
            continue;
        }

        // Calcula a parcela do custo do Link pro-rata pelo peso efetivo
        let linkShare = 0;
        if (totalLinkCost > 0) {
            const effWeight = legEffWeights.get(leg.orderId) || 0;
            if (somaEffWeight > 0) {
                linkShare = totalLinkCost * (effWeight / somaEffWeight);
            } else {
                linkShare = totalLinkCost / manifest.legs.length;
            }
        }

        // Calcula o custo de Hub específico da perna
        const freightValue = await getOrderFreightValue(leg.orderId, tx);
        const hubCost = await calculateLegHubCost(leg, freightValue, tx);

        // Atualiza o custo alocado da perna
        const allocatedCost = linkShare + hubCost;

        await tx.orderLeg.update({
            where: {
                orderId_manifestId: {
                    orderId: leg.orderId,
                    manifestId: leg.manifestId,
                },
            },
            data: { allocatedCost },
        });
    }
}

export interface ManifestMargin {
    /** Compatível com as telas: aponta para a receita LÍQUIDA de ICMS (realizada + estimada). */
    revenue: number;
    /** Frete cobrado dos clientes, com ICMS, rateado para esta viagem. */
    revenueGross: number;
    /** ICMS embutido no frete desta viagem (não é receita). */
    icms: number;
    /** Receita líquida de ICMS desta viagem. */
    revenueNet: number;
    /** Parte da receita líquida que vem de documento oficial emitido. */
    revenueRealized: number;
    /** Há pedido sem documento oficial: o valor é estimativa. */
    revenueEstimated: boolean;
    /** Pedidos da viagem ainda sem documento oficial de frete. */
    ordersWithoutOfficialFreight: number;
    /** Pedidos da viagem sem nenhum valor de frete. */
    ordersWithoutFreightValue: number;
    linkCost: number | null;
    /** De onde veio o custo do transportador. */
    linkCostSource: 'CARTA_FRETE' | 'ACORDO' | 'NONE';
    hubCost: number;
    totalCost: number | null;
    margin: number | null;
    marginPercent: number | null;
    costComplete: boolean;
    missing: string[];
    /** Ocupação do veículo por peso e por volume, em % (null sem capacidade cadastrada). */
    occupancyWeightPercent: number | null;
    occupancyVolumePercent: number | null;
    /** A mais restritiva das duas. */
    occupancyPercent: number | null;
}

const percentOf = (part: number, whole: number | null | undefined): number | null =>
    whole && whole > 0 ? roundMoney((part / whole) * 100) : null;

/**
 * Margem bruta da viagem = receita líquida de ICMS − custo do transportador − comissão do hub.
 *
 * Receita: frete do documento OFICIAL de cada pedido, sem ICMS, rateado entre as pernas do pedido
 * (`splitCentsAcrossLegs`) — um pedido com tronco + entrega NÃO conta o frete cheio em cada
 * viagem; a soma das viagens fecha com o frete do pedido. Sem documento oficial a receita entra
 * como estimativa (`revenueEstimated`).
 */
export async function getManifestMargin(
    manifestId: string,
    tx: Prisma.TransactionClient = prisma
): Promise<ManifestMargin> {
    const manifest = await tx.manifest.findUnique({
        where: { id: manifestId },
        include: {
            vehicleType: true,
            freightAgreement: { select: { id: true } },
            legs: {
                select: {
                    orderId: true,
                    originHubId: true,
                    destHubId: true,
                    sequence: true,
                },
            },
        },
    });

    if (!manifest) {
        return {
            revenue: 0, revenueGross: 0, icms: 0, revenueNet: 0, revenueRealized: 0, revenueEstimated: false,
            ordersWithoutOfficialFreight: 0, ordersWithoutFreightValue: 0,
            linkCost: 0, linkCostSource: 'NONE', hubCost: 0, totalCost: 0, margin: 0, marginPercent: 0,
            costComplete: true, missing: [],
            occupancyWeightPercent: null, occupancyVolumePercent: null, occupancyPercent: null,
        };
    }

    const linkCost = await calculateLinkCost(manifestId, tx);
    const missing: string[] = [];
    let costComplete = true;
    if (manifest.linkId && linkCost === null) {
        costComplete = false;
        missing.push('LinkPricingAgreement not found');
    }

    const orderIds = [...new Set(manifest.legs.map((leg) => leg.orderId))];
    const allLegs = orderIds.length
        ? await tx.orderLeg.findMany({
            where: { orderId: { in: orderIds } },
            select: { orderId: true, manifestId: true, sequence: true, allocatedCost: true },
        })
        : [];

    let grossCents = 0;
    let icmsCents = 0;
    let realizedNetCents = 0;
    let hubCost = 0;
    let withoutOfficial = 0;
    let withoutValue = 0;

    for (const leg of manifest.legs) {
        const freight = await getOrderFreightBreakdown(leg.orderId, tx);
        if (freight.source !== 'OFFICIAL') withoutOfficial += 1;
        if (freight.source === 'NONE') withoutValue += 1;

        const orderLegs = allLegs
            .filter((l) => l.orderId === leg.orderId)
            .map((l) => ({ key: l.manifestId, sequence: l.sequence, allocatedCost: l.allocatedCost }));
        // Perna ainda não gravada no banco (simulação): conta como a única conhecida.
        if (!orderLegs.some((l) => l.key === manifestId)) {
            orderLegs.push({ key: manifestId, sequence: leg.sequence, allocatedCost: null });
        }

        const grossShare = splitCentsAcrossLegs(Math.round(freight.gross * 100), orderLegs).get(manifestId) ?? 0;
        const icmsShare = splitCentsAcrossLegs(Math.round(freight.icms * 100), orderLegs).get(manifestId) ?? 0;
        grossCents += grossShare;
        icmsCents += icmsShare;
        if (freight.source === 'OFFICIAL') realizedNetCents += grossShare - icmsShare;

        hubCost += roundMoney(await calculateLegHubCost(leg, freight.net, tx));
    }

    hubCost = roundMoney(hubCost);
    const revenueGross = grossCents / 100;
    const icms = icmsCents / 100;
    const revenueNet = (grossCents - icmsCents) / 100;
    const revenueRealized = realizedNetCents / 100;

    const occupancyWeightPercent = percentOf(manifest.totalWeight, manifest.vehicleType?.maxWeight);
    const occupancyVolumePercent = percentOf(manifest.totalVolume, manifest.vehicleType?.maxVolume);
    const occupancyValues = [occupancyWeightPercent, occupancyVolumePercent].filter((v): v is number => v !== null);
    const occupancyPercent = occupancyValues.length ? Math.max(...occupancyValues) : null;

    const base = {
        revenue: revenueNet,
        revenueGross,
        icms,
        revenueNet,
        revenueRealized,
        revenueEstimated: withoutOfficial > 0,
        ordersWithoutOfficialFreight: withoutOfficial,
        ordersWithoutFreightValue: withoutValue,
        linkCostSource: (manifest.freightAgreement ? 'CARTA_FRETE' : linkCost !== null && manifest.linkId ? 'ACORDO' : 'NONE') as ManifestMargin['linkCostSource'],
        hubCost,
        occupancyWeightPercent,
        occupancyVolumePercent,
        occupancyPercent,
    };

    if (!costComplete) {
        return { ...base, linkCost: null, totalCost: null, margin: null, marginPercent: null, costComplete: false, missing };
    }

    const finalLinkCost = roundMoney(linkCost ?? 0);
    const totalCost = roundMoney(finalLinkCost + hubCost);
    const margin = roundMoney(revenueNet - totalCost);
    const marginPercent = revenueNet > 0 ? roundMoney((margin / revenueNet) * 100) : 0;

    return { ...base, linkCost: finalLinkCost, totalCost, margin, marginPercent, costComplete: true, missing: [] };
}
