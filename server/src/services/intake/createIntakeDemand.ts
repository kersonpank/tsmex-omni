import type {
    Demand,
    DemandDocumentType,
    DemandSource,
    Prisma,
} from '@prisma/client';
import axios from 'axios';
import prisma from '../../lib/prisma.js';
import { parseChaveNfe, extractChaveFromInput, type NfeChaveParsed } from '../../lib/nfeChaveIntake.js';
import {
    computeMissingFields,
    deriveIntakeCompleteness,
    mergeMissingFields,
    NFE_KEY_ALWAYS_MISSING,
    type IntakeCargoSnapshot,
    type IntakeFieldKey,
} from './computeMissingFields.js';
import {
    intakeEventDescription,
    normalizeExternalReference,
} from './intakeDemandPolicy.js';

export interface CreateIntakeDemandInput {
    sourceType: Extract<DemandSource, 'MANUAL_HUB' | 'DECLARATION' | 'NFE_KEY'>;
    clientId: string;
    expectedHubId?: string | null;
    externalReference?: string | null;
    documentType?: DemandDocumentType | null;
    documentKey?: string | null;
    nfNumber?: string;
    nfValue?: number;
    origin?: string;
    destination?: string;
    commodity?: string;
    weight?: number;
    volume?: number;
    units?: number;
    riskClass?: 'A' | 'B' | 'C';
    intentType?: 'QUOTE_ONLY' | 'COLLECT' | 'DROP_AT_HUB';
    declarationData?: Prisma.InputJsonValue;
    rawInputData?: Prisma.InputJsonValue;
    /** Campos extras para merge em missingFields (ex.: chave NF). */
    extraMissingFields?: IntakeFieldKey[];
}

export interface CreateIntakeFromNfeKeyInput {
    chave: string;
    clientId: string;
    expectedHubId?: string | null;
    rawInputData?: Prisma.InputJsonValue;
}

export interface NfeKeyLookupData {
    parsed: NfeChaveParsed;
    emitenteRazaoSocial: string | null;
    emitenteTradeName: string | null;
    emitenteMunicipio: string | null;
}

const PLACEHOLDER_ORIGIN = 'A definir';
const PLACEHOLDER_DEST = 'A definir';
const PLACEHOLDER_COMMODITY = 'A definir';

function buildIdempotencyRef(
    sourceType: DemandSource,
    documentKey: string | null | undefined,
    externalReference: string | null | undefined,
): string | null {
    if (sourceType === 'NFE_KEY' && documentKey) {
        return normalizeExternalReference(documentKey);
    }
    return normalizeExternalReference(externalReference);
}

async function findExistingIntakeDemand(
    sourceType: DemandSource,
    externalReference: string | null,
): Promise<Demand | null> {
    if (!externalReference) return null;
    return prisma.demand.findFirst({
        where: {
            sourceType,
            externalReference,
        },
        include: { order: true },
    });
}

function snapshotFromInput(input: CreateIntakeDemandInput): IntakeCargoSnapshot {
    return {
        nfNumber: input.nfNumber ?? 'PENDENTE',
        nfValue: input.nfValue ?? 0,
        origin: input.origin ?? PLACEHOLDER_ORIGIN,
        destination: input.destination ?? PLACEHOLDER_DEST,
        commodity: input.commodity ?? PLACEHOLDER_COMMODITY,
        weight: input.weight ?? 0,
        volume: input.volume ?? 0,
        units: input.units ?? 1,
        documentType: input.documentType ?? null,
        documentKey: input.documentKey ?? null,
        declarationDescription:
            input.declarationData && typeof input.declarationData === 'object' && !Array.isArray(input.declarationData)
                ? String((input.declarationData as Record<string, unknown>).description ?? '')
                : null,
    };
}

export async function createIntakeDemand(input: CreateIntakeDemandInput): Promise<Demand> {
    const documentKey = input.documentKey?.replace(/\D/g, '').length === 44
        ? input.documentKey.replace(/\D/g, '')
        : input.documentKey ?? null;

    const externalReference = buildIdempotencyRef(
        input.sourceType,
        documentKey,
        input.externalReference,
    );

    const existing = await findExistingIntakeDemand(input.sourceType, externalReference);
    const snapshot = snapshotFromInput({ ...input, documentKey });
    let missingFields = mergeMissingFields(
        computeMissingFields(snapshot),
        input.extraMissingFields ?? [],
    );
    const intakeCompleteness = deriveIntakeCompleteness(missingFields);

    const cubeFactor = 300;
    const volume = input.volume && input.volume > 0 ? input.volume : 0.001;
    const cubedWeight = volume * cubeFactor;

    const upsertScalars = {
        clientId: input.clientId,
        nfNumber: snapshot.nfNumber,
        nfValue: snapshot.nfValue > 0 ? snapshot.nfValue : 0.01,
        origin: snapshot.origin,
        destination: snapshot.destination,
        commodity: snapshot.commodity,
        weight: snapshot.weight > 0 ? snapshot.weight : 1,
        volume,
        cubedWeight,
        units: input.units ?? 1,
        riskClass: input.riskClass ?? 'B',
        intentType: input.intentType ?? 'DROP_AT_HUB',
        status: 'AWAITING_ARRIVAL' as const,
        sourceType: input.sourceType,
        documentType: input.documentType ?? null,
        documentKey,
        externalReference,
        expectedHubId: input.expectedHubId ?? null,
        intakeCompleteness,
        missingFields,
        declarationData: input.declarationData ?? undefined,
        rawInputData: input.rawInputData ?? undefined,
    };

    if (existing) {
        return prisma.$transaction(async (tx) => {
            const updated = await tx.demand.update({
                where: { id: existing.id },
                data: upsertScalars,
            });
            await tx.demandEvent.create({
                data: {
                    demandId: existing.id,
                    status: 'AWAITING_ARRIVAL',
                    description: `${intakeEventDescription(input.sourceType)} (atualizada)`,
                    location: updated.origin,
                },
            });
            return updated;
        });
    }

    return prisma.$transaction(async (tx) => {
        const demand = await tx.demand.create({
            data: {
                clientId: input.clientId,
                nfNumber: snapshot.nfNumber,
                nfValue: snapshot.nfValue > 0 ? snapshot.nfValue : 0.01,
                origin: snapshot.origin,
                destination: snapshot.destination,
                commodity: snapshot.commodity,
                weight: snapshot.weight > 0 ? snapshot.weight : 1,
                volume,
                cubedWeight,
                units: input.units ?? 1,
                riskClass: input.riskClass ?? 'B',
                intentType: input.intentType ?? 'DROP_AT_HUB',
                status: 'AWAITING_ARRIVAL',
                sourceType: input.sourceType,
                documentType: input.documentType ?? undefined,
                documentKey,
                externalReference,
                expectedHubId: input.expectedHubId ?? undefined,
                intakeCompleteness,
                missingFields,
                declarationData: input.declarationData ?? undefined,
                rawInputData: input.rawInputData ?? undefined,
            },
        });

        await tx.demandEvent.create({
            data: {
                demandId: demand.id,
                status: 'AWAITING_ARRIVAL',
                description: intakeEventDescription(input.sourceType),
                location: demand.origin,
            },
        });

        return demand;
    });
}

export async function lookupNfeKeyEmitente(cnpj: string): Promise<{
    emitenteRazaoSocial: string | null;
    emitenteTradeName: string | null;
    emitenteMunicipio: string | null;
}> {
    try {
        const cnpjRes = await axios.get(
            `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
            { timeout: 5000 },
        );
        return {
            emitenteRazaoSocial: cnpjRes.data?.razao_social ?? null,
            emitenteTradeName: cnpjRes.data?.nome_fantasia ?? null,
            emitenteMunicipio: cnpjRes.data?.municipio ?? null,
        };
    } catch {
        return {
            emitenteRazaoSocial: null,
            emitenteTradeName: null,
            emitenteMunicipio: null,
        };
    }
}

export async function createIntakeDemandFromNfeKey(
    input: CreateIntakeFromNfeKeyInput,
): Promise<{ demand: Demand; lookup: NfeKeyLookupData }> {
    const chave = extractChaveFromInput(input.chave);
    const parsed = parseChaveNfe(chave);
    if (!parsed) {
        throw new Error('Chave NF-e inválida (44 dígitos, modelo 55 ou 57)');
    }

    const emitente = await lookupNfeKeyEmitente(parsed.cnpjEmit);
    const origin =
        emitente.emitenteMunicipio && parsed.uf
            ? `${emitente.emitenteMunicipio}, ${parsed.uf}`
            : parsed.uf || PLACEHOLDER_ORIGIN;

    const missingFields = mergeMissingFields(
        computeMissingFields({
            nfNumber: parsed.nnf,
            nfValue: 0,
            origin,
            destination: PLACEHOLDER_DEST,
            commodity: PLACEHOLDER_COMMODITY,
            weight: 0,
            volume: 0,
            units: 1,
            documentType: 'NFE',
            documentKey: parsed.chave,
        }),
        NFE_KEY_ALWAYS_MISSING,
    );

    const demand = await createIntakeDemand({
        sourceType: 'NFE_KEY',
        clientId: input.clientId,
        expectedHubId: input.expectedHubId,
        documentType: 'NFE',
        documentKey: parsed.chave,
        nfNumber: parsed.nnf,
        nfValue: 0.01,
        origin,
        destination: PLACEHOLDER_DEST,
        commodity: PLACEHOLDER_COMMODITY,
        weight: 1,
        volume: 0.001,
        units: 1,
        extraMissingFields: missingFields,
        rawInputData: JSON.parse(
            JSON.stringify({
                ...(typeof input.rawInputData === 'object' && input.rawInputData
                    ? input.rawInputData
                    : {}),
                nfeKeyLookup: { parsed, emitente },
            }),
        ) as Prisma.InputJsonValue,
    });

    return {
        demand,
        lookup: { parsed, ...emitente },
    };
}
