import type {
    Demand,
    DemandDocumentType,
    DemandSource,
    Prisma,
} from '@prisma/client';
import axios from 'axios';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { getNextOrderNumber } from '../orderSequence.js';
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
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

export interface CreateIntakeDemandInput {
    sourceType: Extract<DemandSource, 'MANUAL_HUB' | 'DECLARATION' | 'NFE_KEY' | 'DFE_ACBR'>;
    /** Opcional de propósito — cliente (conta faturável) não é pré-requisito pra abrir a Demand;
     * se resolve depois, na confirmação de chegada, conforme o frete (CIF/FOB/REDESPACHO). */
    clientId?: string | null;
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
    /** Opcional — ver `CreateIntakeDemandInput.clientId`. */
    clientId?: string | null;
    expectedHubId?: string | null;
    rawInputData?: Prisma.InputJsonValue;
    /** Origem da Demanda: bipagem manual (default) ou triagem da Distribuição NF-e automática. */
    sourceType?: Extract<DemandSource, 'NFE_KEY' | 'DFE_ACBR'>;
    /**
     * Dados reais de carga extraídos do XML já baixado pela Distribuição NF-e (ACBr), quando a
     * chave bipada já tinha sido descoberta pelo pipeline automático. Presente → nfValue/origin/
     * commodity/weight/units usam valores reais em vez de placeholder. Ausente → comportamento
     * idêntico ao atual (placeholders, tudo pra preenchimento manual).
     */
    cargoData?: ParsedNfeCargo;
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
    if ((sourceType === 'NFE_KEY' || sourceType === 'DFE_ACBR') && documentKey) {
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
        clientId: input.clientId ?? null,
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
        // `undefined` (não `null`): no branch de update (reprocessar a mesma chave idempotente),
        // não informar clientId de novo não deve apagar um valor já resolvido anteriormente.
        clientId: input.clientId ?? undefined,
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
        const hasOrder = Boolean((existing as { order?: { id: string } | null }).order);
        if (existing.status !== 'AWAITING_ARRIVAL' || hasOrder) {
            throw new AppError(
                'Esta chave NF-e já foi processada e não pode ser reaberta na fila de recebimento.',
                409,
            );
        }
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
        const orderNumber = await getNextOrderNumber(tx);
        const demand = await tx.demand.create({
            data: {
                clientId: input.clientId ?? undefined,
                orderNumber,
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

function describeOrigemFromCargo(emitente: ParsedNfeCargo['emitente']): string {
    const localidade = [emitente.municipio, emitente.uf].filter((p) => p && p.trim()).join(', ');
    const parts = [emitente.razaoSocial, localidade].filter((p) => p && p.trim());
    return parts.length > 0 ? parts.join(' - ') : PLACEHOLDER_ORIGIN;
}

function describeDestinoFromCargo(destinatario: ParsedNfeCargo['destinatario']): string {
    const localidade = [destinatario.municipio, destinatario.uf].filter((p) => p && p.trim()).join(', ');
    const parts = [destinatario.razaoSocial, localidade].filter((p) => p && p.trim());
    return parts.length > 0 ? parts.join(' - ') : PLACEHOLDER_DEST;
}

function hasUsableDestino(destinatario: ParsedNfeCargo['destinatario'] | undefined): boolean {
    if (!destinatario) return false;
    return Boolean(destinatario.municipio?.trim() || destinatario.uf?.trim() || destinatario.razaoSocial?.trim());
}

function describeCommodityFromCargo(produtos: ParsedNfeCargo['produtos']): string {
    if (produtos.length === 0) return PLACEHOLDER_COMMODITY;
    const [first, ...rest] = produtos;
    const descricao = first.descricao?.trim() || PLACEHOLDER_COMMODITY;
    if (rest.length === 0) return descricao;
    return `${descricao} e mais ${rest.length} ${rest.length === 1 ? 'item' : 'itens'}`;
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
    const cargoData = input.cargoData;

    const origin = cargoData
        ? describeOrigemFromCargo(cargoData.emitente)
        : emitente.emitenteMunicipio && parsed.uf
            ? `${emitente.emitenteMunicipio}, ${parsed.uf}`
            : parsed.uf || PLACEHOLDER_ORIGIN;

    const commodity = cargoData ? describeCommodityFromCargo(cargoData.produtos) : PLACEHOLDER_COMMODITY;

    const pesoCargo = cargoData ? cargoData.pesoBruto ?? cargoData.pesoLiquido ?? 0 : 0;
    const weight = pesoCargo > 0 ? pesoCargo : 1;

    const unidadesCargo = cargoData?.quantidadeVolumes ?? 0;
    const units = unidadesCargo > 0 ? unidadesCargo : 1;

    const nfValueCargo = cargoData?.valorTotalNota ?? 0;
    const nfValue = nfValueCargo > 0 ? nfValueCargo : 0.01;

    // volume/cubagem nunca vêm do XML padrão da NF-e (não tem m³ nativo) — sempre ficam pra
    // conferência manual, com ou sem cargoData. destination já vem de cargoData.destinatario
    // (o destinatário do XML é sempre a contraparte real — cliente final —, não nós mesmos;
    // nosso papel na NF, quando declarado, é `transportador`) quando disponível.
    const destinatarioTemDado = hasUsableDestino(cargoData?.destinatario);
    const destination = destinatarioTemDado
        ? describeDestinoFromCargo(cargoData!.destinatario)
        : PLACEHOLDER_DEST;

    const forcedMissing = NFE_KEY_ALWAYS_MISSING.filter((field) => {
        if (field === 'weight' && pesoCargo > 0) return false;
        if (field === 'nfValue' && nfValueCargo > 0) return false;
        if (field === 'produtos' && (cargoData?.produtos.length ?? 0) > 0) return false;
        if (field === 'destination' && destinatarioTemDado) return false;
        return true;
    });

    const missingFields = mergeMissingFields(
        computeMissingFields({
            clientId: input.clientId ?? null,
            nfNumber: parsed.nnf,
            nfValue,
            origin,
            destination,
            commodity,
            weight,
            volume: 0,
            units,
            documentType: 'NFE',
            documentKey: parsed.chave,
        }),
        forcedMissing,
    );

    const demand = await createIntakeDemand({
        sourceType: input.sourceType ?? 'NFE_KEY',
        clientId: input.clientId,
        expectedHubId: input.expectedHubId,
        documentType: 'NFE',
        documentKey: parsed.chave,
        nfNumber: parsed.nnf,
        nfValue,
        origin,
        destination,
        commodity,
        weight,
        volume: 0.001,
        units,
        extraMissingFields: missingFields,
        rawInputData: JSON.parse(
            JSON.stringify({
                ...(typeof input.rawInputData === 'object' && input.rawInputData
                    ? input.rawInputData
                    : {}),
                nfeKeyLookup: { parsed, emitente },
                ...(cargoData ? { nfeXmlData: cargoData } : {}),
            }),
        ) as Prisma.InputJsonValue,
    });

    return {
        demand,
        lookup: { parsed, ...emitente },
    };
}
