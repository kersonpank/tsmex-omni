/**
 * personRoleSync — upsert Person as relational base for a role (Driver or Link owner).
 *
 * Person.document is globally unique (CPF/CNPJ digits-only).
 * Driver/Link are only roles pointing to a Person via personId.
 *
 * Rules:
 *  - If no Person exists: create with supplied address (required).
 *  - If Person exists: merge ONLY empty fields. Never silently overwrite filled values.
 *    Returns `personAlreadyExists: true` and which fields were not overwritten.
 */

import prisma from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import { validateSelectedAddress, normalizeCityName } from './selectedCity.js';
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

interface UpsertPersonForRoleOptions {
    documentType: 'CPF' | 'CNPJ';
    missingAddressErrorMessage: string;
    stateRegistration?: string;
    updatePersonAddress?: boolean;
    allowAddresslessCreation?: boolean;
}

async function upsertPersonForRole(
    normalizedDocument: string,
    legalName: string,
    address: DriverAddressInput | undefined,
    options: UpsertPersonForRoleOptions,
    db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<UpsertPersonResult> {
    if (address) address = await validateSelectedAddress(address);
    const existing = await db.person.findUnique({ where: { document: normalizedDocument } });

    if (!existing) {
        if (!address && !options.allowAddresslessCreation) {
            throw new AppError(options.missingAddressErrorMessage, 400);
        }

        const person = await db.person.create({
            data: {
                documentType: options.documentType,
                document: normalizedDocument,
                legalName,
                stateRegistration: options.stateRegistration ?? null,
                cep: address?.cep ?? null,
                address: address?.address ?? null,
                number: address?.number ?? null,
                complement: address?.complement ?? null,
                neighborhood: address?.neighborhood ?? null,
                city: address?.city ?? null,
                state: address?.state ?? null,
                cityIbgeCode: address?.cityIbgeCode ?? null,
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

    if (options.stateRegistration) {
        if (!existing.stateRegistration) {
            updateData.stateRegistration = options.stateRegistration;
        } else if (existing.stateRegistration !== options.stateRegistration) {
            notOverwritten.push('stateRegistration');
        }
    }

    if (address) {
        const fields = [...ADDRESS_FIELDS, 'cityIbgeCode'] as const;
        // An address is one coherent unit. Never combine a new CEP with an old municipality.
        const hasExistingAddress = ADDRESS_FIELDS.some(field => Boolean(existing[field]));
        const compatible = fields.every(field => !existing[field] || !address![field]
            || (field === 'city' ? normalizeCityName(String(existing[field])) === normalizeCityName(address![field]!)
                : field === 'cep' ? String(existing[field]).replace(/\D/g, '') === address!.cep
                : existing[field] === address![field]));
        if (options.updatePersonAddress || !hasExistingAddress || compatible) {
            for (const field of fields) {
                if (options.updatePersonAddress || !existing[field]) updateData[field] = address[field] ?? null;
            }
        } else {
            notOverwritten.push(...fields.filter(field => existing[field] !== address![field]));
        }
    }

    let person: typeof existing = existing;
    if (Object.keys(updateData).length > 0) {
        person = await db.person.update({
            where: { id: existing.id },
            data: updateData,
        });
    }

    return { person, personAlreadyExists: true, notOverwritten };
}

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
    updatePersonAddress = false,
    db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<UpsertPersonResult> {
    return upsertPersonForRole(normalizedDocument, legalName, address, {
        documentType: 'CPF',
        updatePersonAddress,
        allowAddresslessCreation: true,
        missingAddressErrorMessage: 'Endereço é obrigatório para cadastrar um motorista.',
    }, db);
}

/**
 * Upsert Person for a Link owner role (transportador contratado — TAC autônomo ou empresa).
 *
 * @param documentType        - 'CPF' for autônomo, 'CNPJ' for transportadora
 * @param normalizedDocument  - CPF/CNPJ digits only (caller must normalize)
 * @param legalName           - Nome completo (CPF) ou razão social (CNPJ)
 * @param address             - Required when creating a new Person; optional for merge
 * @param stateRegistration   - IE, geralmente vinda de lookup de CNPJ; só preenche se vazia
 */
export async function upsertPersonForLinkOwner(
    documentType: 'CPF' | 'CNPJ',
    normalizedDocument: string,
    legalName: string,
    address: DriverAddressInput | undefined,
    stateRegistration?: string,
    updatePersonAddress = false,
): Promise<UpsertPersonResult> {
    return upsertPersonForRole(normalizedDocument, legalName, address, {
        documentType,
        stateRegistration,
        updatePersonAddress,
        missingAddressErrorMessage: 'Endereço é obrigatório para cadastrar o proprietário do veículo.',
    });
}
