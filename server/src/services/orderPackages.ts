import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

/** Fator de cubagem usado na sincronização da Demand (mesmo de createIntakeDemand / syncDemandFromInvoices). */
const CUBE_FACTOR = 300;

export interface OrderPackageInput {
    quantity: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    weightKg?: number | null;
    description?: string | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** m³ total = Σ quantidade × C × L × A (cm) / 1e6, arredondado a 3 casas. */
export function packagesVolumeM3(packages: Pick<OrderPackageInput, 'quantity' | 'lengthCm' | 'widthCm' | 'heightCm'>[]): number {
    const sum = packages.reduce((s, p) => s + (p.quantity * p.lengthCm * p.widthCm * p.heightCm) / 1e6, 0);
    return round3(sum);
}

/**
 * Distribui o m³ entre as NFs proporcionalmente ao peso (sem peso: partes iguais).
 * O último recebe o resto, para a soma bater exatamente com o total.
 */
export function distributeVolume(total: number, weights: number[]): number[] {
    if (weights.length === 0) return [];
    if (weights.length === 1) return [total];
    const sumW = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
    const shares = weights.map((w) => (sumW > 0 ? (w > 0 ? w : 0) / sumW : 1 / weights.length));
    const out: number[] = [];
    let acc = 0;
    shares.forEach((share, i) => {
        if (i === shares.length - 1) out.push(round3(total - acc));
        else {
            const v = round3(total * share);
            out.push(v);
            acc += v;
        }
    });
    return out;
}

export async function getOrderPackages(orderId: string) {
    const packages = await prisma.orderPackage.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    return { packages, volumeM3: packagesVolumeM3(packages) };
}

/**
 * Grava as medidas dos volumes (ou só o m³ total) e propaga a cubagem:
 * NFs do pedido (proporcional ao peso), collectionData.cubedVolume e Demand.volume/cubedWeight.
 * Depois recalcula os fretes automáticos do pedido ainda em DRAFT/CALCULATED (não INFORMADO).
 */
export async function setOrderPackages(orderId: string, packages: OrderPackageInput[] | null, totalM3?: number) {
    const list = packages ?? [];
    const volumeM3 = list.length > 0 ? packagesVolumeM3(list) : round3(Number(totalM3 ?? 0));
    if (!(volumeM3 > 0)) throw new AppError('Informe as medidas ou o m³ total (maior que zero).', 400);

    await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
            where: { id: orderId },
            include: { invoicesRel: true, demand: true },
        });
        if (!order) throw new AppError('Order not found', 404);

        await tx.orderPackage.deleteMany({ where: { orderId } });
        if (list.length > 0) {
            await tx.orderPackage.createMany({
                data: list.map((p) => ({
                    orderId,
                    quantity: p.quantity,
                    lengthCm: p.lengthCm,
                    widthCm: p.widthCm,
                    heightCm: p.heightCm,
                    weightKg: p.weightKg ?? null,
                    description: p.description?.trim() || null,
                })),
            });
        }

        const parts = distributeVolume(volumeM3, order.invoicesRel.map((i) => i.weight || 0));
        for (let i = 0; i < order.invoicesRel.length; i++) {
            await tx.orderInvoice.update({ where: { id: order.invoicesRel[i].id }, data: { cubedVolume: parts[i] } });
        }

        const cd = ((order.collectionData as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
        await tx.order.update({
            where: { id: orderId },
            data: { collectionData: { ...cd, cubedVolume: volumeM3 } as any },
        });

        if (order.demand) {
            await tx.demand.update({
                where: { id: order.demand.id },
                data: { volume: volumeM3, cubedWeight: volumeM3 * CUBE_FACTOR },
            });
        }
    });

    const calcs = await prisma.orderFreightCalculation.findMany({
        where: { orderId, status: { in: ['DRAFT', 'CALCULATED'] }, calculationMethod: { not: 'INFORMADO' } },
        select: { id: true },
    });
    if (calcs.length > 0) {
        const { persistAutoFreightCalculation } = await import('../routes/freightCalculations.js');
        for (const c of calcs) {
            try {
                await persistAutoFreightCalculation(orderId, c.id);
            } catch (e) {
                console.error(JSON.stringify({ level: 'warn', source: 'orderPackages', message: 'Falha ao recalcular frete após cubagem', orderId, calcId: c.id, error: e instanceof Error ? e.message : String(e) }));
            }
        }
    }

    return getOrderPackages(orderId).then((r) => ({ packages: r.packages, volumeM3 }));
}
