import type { LinkCostMode, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { roundMoney } from '../../lib/money.js';

type Db = typeof prisma;

/** Tarifa unitária (R$/m³, R$/kg) aceita 4 casas; todo o resto em dinheiro fica com 2. */
const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

export interface LinkAgreementInput {
    linkId: string;
    originCity: string;
    destinationCity: string;
    vehicleTypeCode: string;
    costMode: LinkCostMode;
    flatRate: number;
    ratePerM3?: number | null;
    ratePerKg?: number | null;
}

export interface HubAgreementInput {
    hubId: string;
    handlingFeePerOrder: number;
    percentOfFreight?: number | null;
}

/** Trava curta por chave dentro da transação: dois cadastros simultâneos não criam dois acordos ativos. */
async function lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}::text))::text AS "locked"`;
}

export async function listLinkAgreements(filter: { active?: boolean; linkId?: string }, db: Db = prisma) {
    return db.linkPricingAgreement.findMany({
        where: {
            ...(filter.active !== undefined ? { active: filter.active } : {}),
            ...(filter.linkId ? { linkId: filter.linkId } : {}),
        },
        include: { link: { select: { id: true, name: true } } },
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        take: 500,
    });
}

export async function createLinkAgreement(input: LinkAgreementInput, db: Db = prisma) {
    const originCity = input.originCity.trim();
    const destinationCity = input.destinationCity.trim();
    if (!originCity || !destinationCity) throw new AppError('Informe origem e destino.', 400);
    if (!(input.flatRate >= 0)) throw new AppError('Valor do acordo não pode ser negativo.', 400);
    if (input.costMode === 'PER_M3' && !(input.ratePerM3 && input.ratePerM3 > 0)) {
        throw new AppError('Informe o valor por m³ para este modo de custo.', 400);
    }
    if (input.costMode === 'PER_KG' && !(input.ratePerKg && input.ratePerKg > 0)) {
        throw new AppError('Informe o valor por kg para este modo de custo.', 400);
    }

    return db.$transaction(async (tx) => {
        const link = await tx.link.findUnique({ where: { id: input.linkId }, select: { id: true } });
        if (!link) throw new AppError('Transportador não encontrado.', 404);
        const vehicleType = await tx.vehicleType.findUnique({ where: { code: input.vehicleTypeCode }, select: { code: true } });
        if (!vehicleType) throw new AppError('Tipo de veículo não encontrado.', 400);

        await lock(tx, `link-agreement:${input.linkId}:${input.vehicleTypeCode}`);
        const active = await tx.linkPricingAgreement.findFirst({
            where: {
                linkId: input.linkId,
                vehicleTypeCode: input.vehicleTypeCode,
                originCity: { equals: originCity, mode: 'insensitive' },
                destinationCity: { equals: destinationCity, mode: 'insensitive' },
                active: true,
            },
            select: { id: true },
        });
        if (active) throw new AppError('Já existe acordo ativo deste transportador para esta rota e veículo. Encerre-o antes de criar outro.', 409);

        return tx.linkPricingAgreement.create({
            data: {
                linkId: input.linkId,
                originCity,
                destinationCity,
                vehicleTypeCode: input.vehicleTypeCode,
                costMode: input.costMode,
                flatRate: roundMoney(input.flatRate),
                ratePerM3: input.ratePerM3 != null ? round4(input.ratePerM3) : null,
                ratePerKg: input.ratePerKg != null ? round4(input.ratePerKg) : null,
                active: true,
            },
        });
    });
}

/** Encerrar vigência = desativar (compare-and-swap: só se ainda estiver ativo). */
export async function closeLinkAgreement(id: string, db: Db = prisma) {
    const closed = await db.linkPricingAgreement.updateMany({ where: { id, active: true }, data: { active: false } });
    if (closed.count === 0) {
        const existing = await db.linkPricingAgreement.findUnique({ where: { id }, select: { id: true } });
        throw existing ? new AppError('Este acordo já estava encerrado.', 409) : new AppError('Acordo não encontrado.', 404);
    }
    return db.linkPricingAgreement.findUnique({ where: { id } });
}

export async function listHubAgreements(filter: { active?: boolean; hubId?: string }, db: Db = prisma) {
    return db.hubCommissionAgreement.findMany({
        where: {
            ...(filter.active !== undefined ? { active: filter.active } : {}),
            ...(filter.hubId ? { hubId: filter.hubId } : {}),
        },
        include: { hub: { select: { id: true, name: true } } },
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        take: 500,
    });
}

export async function createHubAgreement(input: HubAgreementInput, db: Db = prisma) {
    const fee = roundMoney(input.handlingFeePerOrder);
    const percent = input.percentOfFreight ?? null;
    if (!(fee >= 0)) throw new AppError('Taxa por pedido não pode ser negativa.', 400);
    if (percent !== null && !(percent >= 0 && percent <= 100)) throw new AppError('Percentual do frete deve ficar entre 0 e 100.', 400);
    if (fee === 0 && !percent) throw new AppError('Informe a taxa por pedido ou o percentual do frete.', 400);

    return db.$transaction(async (tx) => {
        const hub = await tx.hub.findUnique({ where: { id: input.hubId }, select: { id: true } });
        if (!hub) throw new AppError('Hub não encontrado.', 404);

        await lock(tx, `hub-agreement:${input.hubId}`);
        // O custo usa o primeiro acordo ativo do hub: manter um só evita escolha ambígua.
        const active = await tx.hubCommissionAgreement.findFirst({ where: { hubId: input.hubId, active: true }, select: { id: true } });
        if (active) throw new AppError('Este hub já tem acordo de comissão ativo. Encerre-o antes de criar outro.', 409);

        return tx.hubCommissionAgreement.create({
            data: { hubId: input.hubId, handlingFeePerOrder: fee, percentOfFreight: percent !== null ? round4(percent) : null, active: true },
        });
    });
}

export async function closeHubAgreement(id: string, db: Db = prisma) {
    const closed = await db.hubCommissionAgreement.updateMany({ where: { id, active: true }, data: { active: false } });
    if (closed.count === 0) {
        const existing = await db.hubCommissionAgreement.findUnique({ where: { id }, select: { id: true } });
        throw existing ? new AppError('Este acordo já estava encerrado.', 409) : new AppError('Acordo não encontrado.', 404);
    }
    return db.hubCommissionAgreement.findUnique({ where: { id } });
}
