import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';

/**
 * Retorna o frete cobrado do cliente para o pedido (freightTotal ou quotedPrice).
 */
export async function getOrderFreightValue(orderId: string, tx: Prisma.TransactionClient = prisma): Promise<number> {
    const calc = await tx.orderFreightCalculation.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
    });
    if (calc && calc.freightTotal > 0) {
        return calc.freightTotal;
    }
    const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { demand: true },
    });
    return order?.demand?.quotedPrice || 0;
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

/**
 * Retorna as métricas de margem bruta (receita - custos) do manifesto.
 */
export async function getManifestMargin(
    manifestId: string,
    tx: Prisma.TransactionClient = prisma
): Promise<{
    revenue: number;
    linkCost: number | null;
    hubCost: number;
    totalCost: number | null;
    margin: number | null;
    marginPercent: number | null;
    costComplete: boolean;
    missing: string[];
}> {
    const manifest = await tx.manifest.findUnique({
        where: { id: manifestId },
        include: {
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
            revenue: 0,
            linkCost: 0,
            hubCost: 0,
            totalCost: 0,
            margin: 0,
            marginPercent: 0,
            costComplete: true,
            missing: [],
        };
    }

    const linkCost = await calculateLinkCost(manifestId, tx);
    const missing: string[] = [];
    let costComplete = true;

    if (manifest.linkId && linkCost === null) {
        costComplete = false;
        missing.push('LinkPricingAgreement not found');
    }

    let revenue = 0;
    let hubCost = 0;

    for (const leg of manifest.legs) {
        const freight = await getOrderFreightValue(leg.orderId, tx);
        revenue += freight;
        hubCost += await calculateLegHubCost(leg, freight, tx);
    }

    if (!costComplete) {
        return {
            revenue,
            linkCost: null,
            hubCost,
            totalCost: null,
            margin: null,
            marginPercent: null,
            costComplete: false,
            missing,
        };
    }

    const finalLinkCost = linkCost ?? 0;
    const totalCost = finalLinkCost + hubCost;
    const margin = revenue - totalCost;
    const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0;

    return {
        revenue,
        linkCost: finalLinkCost,
        hubCost,
        totalCost,
        margin,
        marginPercent,
        costComplete: true,
        missing: [],
    };
}
