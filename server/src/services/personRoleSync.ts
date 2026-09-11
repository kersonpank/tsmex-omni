/**
 * personRoleSync — upsert Person as relational base for a Driver role.
 *
 * Person.document is globally unique (CPF/CNPJ digits-only).
 * Driver is only a role pointing to a Person via personId.
 *
 * Rules:
 *  - If no Person exists: create with supplied address (required).
 *  - If Person exists: merge ONLY empty fields. Never silently overwrite filled values.
 *    Returns `personAlreadyExists: true` and which fields were not overwritten.
 */

import prisma from '../lib/prisma.js';
import { resolveIbgeMunicipio } from './acbr/acbrIbge.js';
import { AppError } from '../middleware/errorHandler.js';

export interface DriverAddressInput {
    cep: string;
    address: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string; // 2-char UF
    cityIbgeCode?: string;
}

export interface UpsertPersonResult {
    person: { id: string; [key: string]: unknown };
    personAlreadyExists: boolean;
    notOverwritten: string[];
}

const ADDRESS_FIELDS: Array<keyof DriverAddressInput & string> = [
    'cep', 'address', 'number', 'complement', 'neighborhood', 'city', 'state',
];

/**
 * Upsert Person for a Driver role.
 *
 * @param normalizedDocument - CPF digits only (caller must normalize)
 * @param legalName          - Driver's full legal name
 * @param address            - Required when creating a new Person; optional for merge
 */
export async function upsertPersonForDriver(
    normalizedDocument: string,
    legalName: string,
    address: DriverAddressInput | undefined,
): Promise<UpsertPersonResult> {
    const existing = await prisma.person.findUnique({ where: { document: normalizedDocument } });

    if (!existing) {
        if (!address) {
            throw new AppError('Endereço é obrigatório para cadastrar um motorista.', 400);
        }

        const ibgeCode = await resolveIbgeMunicipio(address.city, address.state, address.cityIbgeCode);

        const person = await prisma.person.create({
            data: {
                documentType: 'CPF',
                document: normalizedDocument,
                legalName,
                cep: address.cep,
                address: address.address,
                number: address.number,
                complement: address.complement ?? null,
                neighborhood: address.neighborhood,
                city: address.city,
                state: address.state,
                cityIbgeCode: ibgeCode,
            },
        });

        return { person, personAlreadyExists: false, notOverwritten: [] };
    }

    // Person already exists — merge only empty fields, never silently overwrite
    const notOverwritten: string[] = [];
    const updateData: Record<string, unknown> = {};

    if (!existing.legalName) {
        updateData.legalName = legalName;
    } else if (existing.legalName !== legalName) {
        notOverwritten.push('legalName');
    }

    if (address) {
        for (const field of ADDRESS_FIELDS) {
            const existingVal = (existing as Record<string, unknown>)[field];
            const newVal = address[field as keyof DriverAddressInput];
            if (newVal !== undefined && newVal !== null && newVal !== '') {
                if (!existingVal || existingVal === '') {
                    updateData[field] = newVal;
                } else if (existingVal !== newVal) {
                    notOverwritten.push(field);
                }
            }
        }

        // Resolve cityIbgeCode only when it's still missing after the merge
        if (!existing.cityIbgeCode) {
            const cityForIbge = (updateData.city as string | undefined) ?? existing.city ?? undefined;
            const stateForIbge = (updateData.state as string | undefined) ?? existing.state ?? undefined;
            if (cityForIbge && stateForIbge) {
                try {
                    updateData.cityIbgeCode = await resolveIbgeMunicipio(
                        cityForIbge,
                        stateForIbge,
                        address.cityIbgeCode,
                    );
                } catch {
                    // best-effort; caller can let readiness flag it later
                }
            }
        }
    }

    let person: typeof existing = existing;
    if (Object.keys(updateData).length > 0) {
        person = await prisma.person.update({
            where: { id: existing.id },
            data: updateData,
        });
    }

    return { person, personAlreadyExists: true, notOverwritten };
}
