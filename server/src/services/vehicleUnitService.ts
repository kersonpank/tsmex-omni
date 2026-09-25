import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import {
    digitsOnly,
    isValidChassi,
    isValidPlate,
    isValidRenavam,
    isValidRntrc,
    legacyColumnsFromComposition,
    normalizeChassi,
    normalizePlate,
    unitFieldIssues,
    type VehicleUnitRoleValue,
} from './vehicleUnitRules.js';

/** Include do Prisma para ler a composição de um Link (unidades do cavalo e dos reboques). */
export const linkVehicleInclude = {
    tractionUnit: true,
    trailer1Unit: true,
    trailer2Unit: true,
    trailer3Unit: true,
} as const;

const ROLE_LABEL: Record<VehicleUnitRoleValue, string> = { TRACTION: 'cavalo', TRAILER: 'reboque' };
export const MAX_TRAILERS = 3;

const optionalText = z.string().trim().max(120).nullable().optional();

/**
 * Entrada de uma unidade. Campos omitidos NÃO alteram o cadastro existente; `null` limpa.
 * Formato inválido é rejeitado na escrita — campo ausente vira pendência da unidade, não erro.
 */
export const vehicleUnitInputSchema = z.object({
    plate: z.string().min(1, 'Informe a placa.'),
    chassi: z.string().nullable().optional().refine((v) => v == null || v === '' || isValidChassi(normalizeChassi(v)), 'Chassi deve ter 17 caracteres.'),
    renavam: z.string().nullable().optional().refine((v) => v == null || v === '' || isValidRenavam(digitsOnly(v)), 'RENAVAM deve ter de 9 a 11 dígitos.'),
    axles: z.number().int().min(1, 'Eixos deve ser no mínimo 1.').max(12).nullable().optional(),
    rntrc: z.string().nullable().optional().refine((v) => v == null || v === '' || isValidRntrc(digitsOnly(v)), 'RNTRC deve ter 8 ou 9 dígitos.'),
    bodyType: z.enum(['NaoAplicavel', 'Aberta', 'FechadaOuBau', 'Granelera', 'PortaContainer', 'Sider']).nullable().optional(),
    wheelType: z.enum(['NaoAplicavel', 'Truck', 'Toco', 'Cavalo']).nullable().optional(),
    brand: optionalText,
    model: optionalText,
    year: z.number().int().min(1950).max(new Date().getFullYear() + 1).nullable().optional(),
    ownerPersonId: z.string().uuid().nullable().optional(),
    ownerDocument: z.string().nullable().optional(),
    ownerName: optionalText,
});
export type VehicleUnitInput = z.infer<typeof vehicleUnitInputSchema>;

export const linkCompositionSchema = z.object({
    traction: vehicleUnitInputSchema,
    trailers: z.array(vehicleUnitInputSchema).max(MAX_TRAILERS, `No máximo ${MAX_TRAILERS} reboques por composição.`).default([]),
});
export type LinkCompositionInput = z.infer<typeof linkCompositionSchema>;

type Db = Prisma.TransactionClient;

/** Converte a entrada em `data` do Prisma: só o que foi enviado, já normalizado. */
function toUnitData(input: VehicleUnitInput): Prisma.VehicleUnitUncheckedUpdateInput {
    const data: Prisma.VehicleUnitUncheckedUpdateInput = {};
    const text = (v: string | null | undefined) => (v == null ? null : v.trim() || null);
    if (input.chassi !== undefined) data.chassi = input.chassi ? normalizeChassi(input.chassi) : null;
    if (input.renavam !== undefined) data.renavam = input.renavam ? digitsOnly(input.renavam) : null;
    if (input.axles !== undefined) data.axles = input.axles;
    if (input.rntrc !== undefined) data.rntrc = input.rntrc ? digitsOnly(input.rntrc) : null;
    if (input.bodyType !== undefined) data.bodyType = input.bodyType;
    if (input.wheelType !== undefined) data.wheelType = input.wheelType;
    if (input.brand !== undefined) data.brand = text(input.brand);
    if (input.model !== undefined) data.model = text(input.model);
    if (input.year !== undefined) data.year = input.year;
    if (input.ownerPersonId !== undefined) data.ownerPersonId = input.ownerPersonId;
    if (input.ownerDocument !== undefined) data.ownerDocument = input.ownerDocument ? digitsOnly(input.ownerDocument) || null : null;
    if (input.ownerName !== undefined) data.ownerName = text(input.ownerName);
    return data;
}

/** Cria ou atualiza a unidade pela placa (identidade global). Papel diferente do cadastrado = conflito. */
export async function upsertVehicleUnit(db: Db, role: VehicleUnitRoleValue, input: VehicleUnitInput) {
    const plate = normalizePlate(input.plate);
    if (!isValidPlate(plate)) throw new AppError(`Placa ${input.plate} inválida: use 7 caracteres alfanuméricos.`, 400);

    const existing = await db.vehicleUnit.findUnique({ where: { plate } });
    if (existing && existing.role !== role) {
        throw new AppError(`A placa ${plate} já está cadastrada como ${ROLE_LABEL[existing.role]}; não pode ser usada como ${ROLE_LABEL[role]}.`, 409);
    }

    const data = toUnitData(input);
    // Dono informado só por documento: vincula à Person quando ela já existe.
    if (data.ownerDocument && input.ownerPersonId === undefined) {
        const person = await db.person.findUnique({ where: { document: data.ownerDocument as string }, select: { id: true } });
        if (person) data.ownerPersonId = person.id;
    }

    if (existing) {
        return Object.keys(data).length ? db.vehicleUnit.update({ where: { id: existing.id }, data }) : existing;
    }
    return db.vehicleUnit.create({ data: { ...(data as Prisma.VehicleUnitUncheckedCreateInput), plate, role } });
}

/**
 * Define a composição (cavalo + até 3 reboques) de um Link. Unidades são criadas/atualizadas e o Link
 * passa a apontar para elas; as colunas legadas do Link são espelhadas na mesma transação para não
 * quebrar leitores ainda não migrados.
 */
export async function setLinkComposition(linkId: string, input: LinkCompositionInput) {
    const tractionPlate = normalizePlate(input.traction.plate);
    const trailerPlates = input.trailers.map((t) => normalizePlate(t.plate));
    if (trailerPlates.includes(tractionPlate)) throw new AppError('A placa do cavalo não pode repetir como reboque.', 400);
    if (new Set(trailerPlates).size !== trailerPlates.length) throw new AppError('Há placas de reboque repetidas na composição.', 400);

    return prisma.$transaction(async (tx) => {
        const link = await tx.link.findUnique({ where: { id: linkId }, select: { id: true } });
        if (!link) throw new AppError('Link not found', 404);

        const traction = await upsertVehicleUnit(tx, 'TRACTION', input.traction);
        const trailers = [];
        for (const trailer of input.trailers) trailers.push(await upsertVehicleUnit(tx, 'TRAILER', trailer));

        return tx.link.update({
            where: { id: linkId },
            data: {
                tractionUnitId: traction.id,
                trailer1UnitId: trailers[0]?.id ?? null,
                trailer2UnitId: trailers[1]?.id ?? null,
                trailer3UnitId: trailers[2]?.id ?? null,
                ...legacyColumnsFromComposition(traction, trailers),
            },
            include: { vehicleType: true, ...linkVehicleInclude },
        });
    });
}

export interface VehicleUnitSearch {
    q?: string;
    role?: VehicleUnitRoleValue;
    limit?: number;
}

/** Busca por placa (parcial, sem separadores). Devolve as pendências de cada unidade para a prévia. */
export async function searchVehicleUnits({ q, role, limit = 8 }: VehicleUnitSearch) {
    const needle = normalizePlate(q);
    const units = await prisma.vehicleUnit.findMany({
        where: {
            active: true,
            ...(role ? { role } : {}),
            ...(needle ? { plate: { contains: needle } } : {}),
        },
        orderBy: { plate: 'asc' },
        take: Math.min(Math.max(limit, 1), 25),
        include: { ownerPerson: { select: { id: true, legalName: true, document: true } } },
    });
    return units.map((unit) => ({ ...unit, missingFields: unitFieldIssues(unit) }));
}

export async function getVehicleUnit(id: string) {
    const unit = await prisma.vehicleUnit.findUnique({
        where: { id },
        include: { ownerPerson: { select: { id: true, legalName: true, document: true } } },
    });
    if (!unit) throw new AppError('Unidade de veículo não encontrada.', 404);
    return { ...unit, missingFields: unitFieldIssues(unit) };
}

/** Atualiza dados da unidade (a placa é a identidade e não muda; para outra placa, cadastre outra unidade). */
export async function updateVehicleUnit(id: string, input: Omit<VehicleUnitInput, 'plate'>) {
    const data = toUnitData({ plate: 'X', ...input });
    if (!Object.keys(data).length) return getVehicleUnit(id);
    try {
        await prisma.vehicleUnit.update({ where: { id }, data });
    } catch (error: any) {
        if (error?.code === 'P2025') throw new AppError('Unidade de veículo não encontrada.', 404);
        throw error;
    }
    return getVehicleUnit(id);
}
