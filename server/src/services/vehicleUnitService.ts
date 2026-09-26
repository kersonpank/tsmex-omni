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
    unitRntrc,
    type VehicleUnitRoleValue,
} from './vehicleUnitRules.js';
import { isValidCnpj, isValidCpf } from './documentValidation.js';

const partySelect = {
    select: {
        id: true, document: true, legalName: true, state: true, rntrc: true,
        cep: true, address: true, number: true, neighborhood: true, city: true, cityIbgeCode: true,
    },
} as const;

/** Pessoas da unidade (proprietário do CRLV e responsável RNTRC) — toda leitura que resolve composição inclui. */
export const vehicleUnitPartiesInclude = { ownerPerson: partySelect, rntrcHolderPerson: partySelect } as const;

/** Include do Prisma para ler a composição de um Link (unidades do cavalo e dos reboques). */
export const linkVehicleInclude = {
    tractionUnit: { include: vehicleUnitPartiesInclude },
    trailer1Unit: { include: vehicleUnitPartiesInclude },
    trailer2Unit: { include: vehicleUnitPartiesInclude },
    trailer3Unit: { include: vehicleUnitPartiesInclude },
} as const;

/** Include das unidades escolhidas para a viagem, na ordem dos slots. */
export const manifestVehicleAssignmentsInclude = {
    orderBy: { slot: 'asc' },
    include: { vehicleUnit: { include: vehicleUnitPartiesInclude } },
} as const;

const ROLE_LABEL: Record<VehicleUnitRoleValue, string> = { TRACTION: 'cavalo', TRAILER: 'reboque' };
export const MAX_TRAILERS = 3;

const optionalText = z.string().trim().max(120).nullable().optional();
const vehicleUf = z.enum(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']).nullable().optional();

/**
 * Entrada de uma unidade. Campos omitidos NÃO alteram o cadastro existente; `null` limpa.
 * Formato inválido é rejeitado na escrita — campo ausente vira pendência da unidade, não erro.
 */
export const vehicleUnitInputSchema = z.object({
    plate: z.string().min(1, 'Informe a placa.'),
    chassi: z.string().nullable().optional().refine((v) => v == null || v === '' || isValidChassi(normalizeChassi(v)), 'Chassi deve ter 17 caracteres.'),
    renavam: z.string().nullable().optional().refine((v) => v == null || v === '' || isValidRenavam(digitsOnly(v)), 'RENAVAM deve ter de 9 a 11 dígitos.'),
    axles: z.number().int().min(1, 'Eixos deve ser no mínimo 1.').max(12).nullable().optional(),
    tareKg: z.number().int().min(1).max(200000).nullable().optional(),
    capacityKg: z.number().int().min(1).max(200000).nullable().optional(),
    capacityM3: z.number().int().min(0).max(1000).nullable().optional(),
    rntrc: z.string().nullable().optional().refine((v) => v == null || v === '' || isValidRntrc(digitsOnly(v)), 'RNTRC deve ter 8 ou 9 dígitos.'),
    bodyType: z.enum(['NaoAplicavel', 'Aberta', 'FechadaOuBau', 'Granelera', 'PortaContainer', 'Sider']).nullable().optional(),
    wheelType: z.enum(['NaoAplicavel', 'Truck', 'Toco', 'Cavalo']).nullable().optional(),
    brand: optionalText,
    model: optionalText,
    year: z.number().int().min(1950).max(new Date().getFullYear() + 1).nullable().optional(),
    ownerPersonId: z.string().uuid().nullable().optional(),
    ownerDocument: z.string().nullable().optional(),
    ownerName: optionalText,
    // Responsável RNTRC (quem responde na ANTT por esta unidade). `rntrc` acima é o número DELE.
    rntrcHolderSameAsOwner: z.boolean().optional(),
    rntrcHolderPersonId: z.string().uuid().nullable().optional(),
    rntrcHolderDocument: z.string().nullable().optional(),
    rntrcHolderName: optionalText,
    mdfeOwnerType: z.enum(['0', '1', '2']).nullable().optional(),
    licensedState: vehicleUf,
    ownerState: vehicleUf,
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
    if (input.tareKg !== undefined) data.tareKg = input.tareKg;
    if (input.capacityKg !== undefined) data.capacityKg = input.capacityKg;
    if (input.capacityM3 !== undefined) data.capacityM3 = input.capacityM3;
    if (input.bodyType !== undefined) data.bodyType = input.bodyType;
    if (input.wheelType !== undefined) data.wheelType = input.wheelType;
    if (input.brand !== undefined) data.brand = text(input.brand);
    if (input.model !== undefined) data.model = text(input.model);
    if (input.year !== undefined) data.year = input.year;
    if (input.ownerPersonId !== undefined) data.ownerPersonId = input.ownerPersonId;
    if (input.ownerDocument !== undefined) data.ownerDocument = input.ownerDocument ? digitsOnly(input.ownerDocument) || null : null;
    if (input.ownerName !== undefined) data.ownerName = text(input.ownerName);
    if (input.mdfeOwnerType !== undefined) data.mdfeOwnerType = input.mdfeOwnerType;
    if (input.licensedState !== undefined) data.licensedState = input.licensedState?.toUpperCase() ?? null;
    if (input.ownerState !== undefined) data.ownerState = input.ownerState?.toUpperCase() ?? null;
    return data;
}

/** Cria ou atualiza a unidade pela placa (identidade global). Papel diferente do cadastrado = conflito. */
export async function upsertVehicleUnit(db: Db, role: VehicleUnitRoleValue, input: VehicleUnitInput, context: UnitPartyContext = {}) {
    const plate = normalizePlate(input.plate);
    if (!isValidPlate(plate)) throw new AppError(`Placa ${input.plate} inválida: use 7 caracteres alfanuméricos.`, 400);

    const existing = await db.vehicleUnit.findUnique({ where: { plate } });
    if (existing && existing.role !== role) {
        throw new AppError(`A placa ${plate} já está cadastrada como ${ROLE_LABEL[existing.role]}; não pode ser usada como ${ROLE_LABEL[role]}.`, 409);
    }

    const data = toUnitData(input);
    await applyUnitParties(db, input, data, existing, context);

    const include = vehicleUnitPartiesInclude;
    if (existing) {
        return Object.keys(data).length
            ? db.vehicleUnit.update({ where: { id: existing.id }, data, include })
            : db.vehicleUnit.findUniqueOrThrow({ where: { id: existing.id }, include });
    }
    return db.vehicleUnit.create({ data: { ...(data as Prisma.VehicleUnitUncheckedCreateInput), plate, role }, include });
}

/** Contexto da gravação: o transportador (Link) é o responsável RNTRC quando a unidade não tem outro. */
export interface UnitPartyContext {
    defaultHolderPersonId?: string | null;
}

/** Pessoa pelo documento; cria o cadastro mínimo (documento + nome) quando ainda não existe. */
async function findOrCreateParty(db: Db, rawDocument: string, name: string | null | undefined, label: string) {
    const document = digitsOnly(rawDocument);
    const valid = document.length === 11 ? isValidCpf(document) : document.length === 14 ? isValidCnpj(document) : false;
    if (!valid) throw new AppError(`${label}: CPF ou CNPJ inválido.`, 400);
    const person = await db.person.findUnique({ where: { document }, select: { id: true } });
    if (person) return person.id;
    if (!name?.trim()) throw new AppError(`${label}: informe o nome para cadastrar ${document.length === 11 ? 'o CPF' : 'o CNPJ'}.`, 400);
    const created = await db.person.create({
        data: { document, documentType: document.length === 11 ? 'CPF' : 'CNPJ', legalName: name.trim() },
        select: { id: true },
    });
    return created.id;
}

/**
 * Proprietário (CRLV) e responsável RNTRC da unidade, ambos como Person. O responsável é, por padrão,
 * o proprietário (definido uma vez; depois só muda quando informado). O número do RNTRC é gravado na
 * pessoa responsável — nunca sobrescreve um RNTRC diferente já cadastrado nela.
 */
async function applyUnitParties(
    db: Db,
    input: VehicleUnitInput,
    data: Prisma.VehicleUnitUncheckedUpdateInput,
    existing: { ownerPersonId: string | null; rntrcHolderPersonId: string | null } | null,
    context: UnitPartyContext = {},
) {
    if (input.ownerPersonId === undefined && data.ownerDocument) {
        data.ownerPersonId = await findOrCreateParty(db, data.ownerDocument as string, input.ownerName, 'Proprietário');
    }
    const ownerPersonId = (data.ownerPersonId !== undefined ? data.ownerPersonId : existing?.ownerPersonId) as string | null | undefined;

    let holderId: string | null | undefined;
    if (input.rntrcHolderSameAsOwner) holderId = ownerPersonId ?? null;
    else if (input.rntrcHolderPersonId !== undefined) holderId = input.rntrcHolderPersonId;
    else if (input.rntrcHolderDocument) holderId = await findOrCreateParty(db, input.rntrcHolderDocument, input.rntrcHolderName, 'Responsável RNTRC');
    else if (!existing?.rntrcHolderPersonId && ownerPersonId) holderId = ownerPersonId; // padrão = proprietário
    else if (!existing?.rntrcHolderPersonId && context.defaultHolderPersonId) holderId = context.defaultHolderPersonId; // sem proprietário: o transportador
    if (holderId !== undefined) data.rntrcHolderPersonId = holderId;

    const rntrc = input.rntrc ? digitsOnly(input.rntrc) : '';
    if (!rntrc) return;
    const effectiveHolderId = holderId !== undefined ? holderId : existing?.rntrcHolderPersonId ?? null;
    if (!effectiveHolderId) throw new AppError('Informe o proprietário ou o responsável RNTRC antes de cadastrar o RNTRC.', 422);
    const holder = await db.person.findUnique({ where: { id: effectiveHolderId }, select: { legalName: true, rntrc: true } });
    if (!holder) throw new AppError('Responsável RNTRC não encontrado.', 404);
    if (!holder.rntrc) {
        await db.person.update({ where: { id: effectiveHolderId }, data: { rntrc } });
    } else if (digitsOnly(holder.rntrc) !== rntrc) {
        throw new AppError(`${holder.legalName} já tem o RNTRC ${holder.rntrc}. Se ${rntrc} é de outra pessoa, escolha-a como responsável RNTRC; se o cadastro está errado, corrija na ficha da pessoa.`, 409);
    }
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
        const link = await tx.link.findUnique({ where: { id: linkId }, select: { id: true, personId: true } });
        if (!link) throw new AppError('Link not found', 404);

        const context = { defaultHolderPersonId: link.personId };
        const traction = await upsertVehicleUnit(tx, 'TRACTION', input.traction, context);
        const trailers = [];
        for (const trailer of input.trailers) trailers.push(await upsertVehicleUnit(tx, 'TRAILER', trailer, context));

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
        include: vehicleUnitPartiesInclude,
    });
    return units.map((unit) => ({ ...unit, rntrc: unitRntrc(unit), missingFields: unitFieldIssues(unit) }));
}

export async function getVehicleUnit(id: string) {
    const unit = await prisma.vehicleUnit.findUnique({ where: { id }, include: vehicleUnitPartiesInclude });
    if (!unit) throw new AppError('Unidade de veículo não encontrada.', 404);
    return { ...unit, rntrc: unitRntrc(unit), missingFields: unitFieldIssues(unit) };
}

/** Atualiza dados da unidade (a placa é a identidade e não muda; para outra placa, cadastre outra unidade). */
export async function updateVehicleUnit(id: string, input: Omit<VehicleUnitInput, 'plate'>) {
    await prisma.$transaction(async (tx) => {
        const existing = await tx.vehicleUnit.findUnique({ where: { id }, select: { ownerPersonId: true, rntrcHolderPersonId: true } });
        if (!existing) throw new AppError('Unidade de veículo não encontrada.', 404);
        const unitInput = { plate: 'X', ...input };
        const data = toUnitData(unitInput);
        await applyUnitParties(tx, unitInput, data, existing);
        if (Object.keys(data).length) await tx.vehicleUnit.update({ where: { id }, data });
    });
    return getVehicleUnit(id);
}
