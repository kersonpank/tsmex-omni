import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { linkVehicleInclude } from './vehicleUnitService.js';
import { mdfeUnitDataIssues, resolveComposition, unitFieldIssues, type ResolvedVehicleUnit } from './vehicleUnitRules.js';

/**
 * Ficha do transportador para o TSM O.S.: transportador, cada placa da composição e os
 * motoristas, com o que falta para CIOT (e-Frete) e MDF-e — mesmas regras do
 * manifestReadinessService e de buildMdfeVehicles, para a ficha nunca dizer "pronto" e a
 * emissão falhar depois.
 */

export interface AddressLike {
    cep?: string | null;
    address?: string | null;
    number?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    cityIbgeCode?: string | null;
}

export function addressComplete(p: AddressLike | null | undefined): boolean {
    return Boolean(p?.neighborhood && p.cep && p.address && p.number && p.city && p.state && p.cityIbgeCode);
}

export function unitRegistryIssues(unit: ResolvedVehicleUnit, holderAddress: AddressLike | null | undefined): string[] {
    const issues = unitFieldIssues(unit).map((f) => (f.reason === 'invalid' ? `${f.label} inválido` : f.label));
    issues.push(...mdfeUnitDataIssues(unit));
    if (!unit.tareKg || !unit.capacityKg) issues.push('tara e capacidade (kg)');
    if (unit.rntrcHolder && !addressComplete(holderAddress)) issues.push('endereço do responsável RNTRC');
    return issues;
}

export interface DriverLike extends AddressLike {
    active?: boolean | null;
    cnhNumber?: string | null;
    birthDate?: Date | string | null;
    cnhExpiry?: Date | string | null;
}

export function driverRegistryIssues(driver: DriverLike, person: AddressLike | null | undefined, now = new Date()): string[] {
    const issues: string[] = [];
    if (driver.active === false) issues.push('motorista inativo');
    if (!driver.cnhNumber) issues.push('número da CNH');
    if (!driver.birthDate) issues.push('data de nascimento');
    if (!addressComplete(person)) issues.push('endereço');
    if (driver.cnhExpiry && new Date(driver.cnhExpiry) < now) issues.push('CNH vencida');
    return issues;
}

const personAddressSelect = {
    id: true,
    document: true,
    legalName: true,
    rntrc: true,
    cep: true,
    address: true,
    number: true,
    complement: true,
    neighborhood: true,
    city: true,
    state: true,
    cityIbgeCode: true,
} as const;

export async function getCarrierRegistry(linkId: string) {
    const link = await prisma.link.findUnique({
        where: { id: linkId },
        include: { ...linkVehicleInclude, person: { select: personAddressSelect } },
    });
    if (!link) throw new AppError('Transportador não encontrado.', 404);

    const composition = resolveComposition(link);
    const holderIds = [...new Set(composition.units.map((u) => u.rntrcHolder?.personId).filter((id): id is string => Boolean(id)))];
    const holders = new Map(
        (await prisma.person.findMany({ where: { id: { in: holderIds } }, select: personAddressSelect })).map((p) => [p.id, p]),
    );

    const drivers = await prisma.driver.findMany({
        where: { OR: [{ linkId }, { carriers: { some: { linkId, active: true } } }] },
        include: { person: { select: personAddressSelect } },
        orderBy: { name: 'asc' },
    });

    return {
        link: {
            id: link.id,
            name: link.name,
            document: link.document,
            phone: link.phone,
            carrierType: link.carrierType,
            approvalStatus: link.approvalStatus,
            personId: link.personId,
            person: link.person,
        },
        carrierIssues: addressComplete(link.person) ? [] : ['endereço do transportador'],
        units: composition.units.map((unit) => {
            const holder = unit.rntrcHolder ? holders.get(unit.rntrcHolder.personId) ?? null : null;
            return { ...unit, rntrcHolderPerson: holder, issues: unitRegistryIssues(unit, holder) };
        }),
        drivers: drivers.map((d) => ({
            id: d.id,
            name: d.name,
            document: d.document,
            phone: d.phone,
            birthDate: d.birthDate,
            cnhNumber: d.cnhNumber,
            cnhCategory: d.cnhCategory,
            cnhState: d.cnhState,
            cnhExpiry: d.cnhExpiry,
            active: d.active,
            person: d.person,
            issues: driverRegistryIssues(d, d.person),
        })),
    };
}

/** Hub pode editar o transportador que cadastrou ou que já usou numa viagem sua; torre sempre. */
export async function hubCanEditLink(user: { roles: string[]; hubId?: string | null }, linkId: string): Promise<boolean> {
    if (user.roles.includes('ADMIN')) return true;
    if (!user.roles.includes('HUB') || !user.hubId) return false;
    const link = await prisma.link.findUnique({ where: { id: linkId }, select: { createdByHubId: true } });
    if (!link) return false;
    if (link.createdByHubId === user.hubId) return true;
    const used = await prisma.manifest.findFirst({ where: { linkId, hubId: user.hubId }, select: { id: true } });
    return Boolean(used);
}
