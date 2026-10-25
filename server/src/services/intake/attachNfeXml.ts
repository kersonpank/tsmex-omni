import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { isObjectStorageConfigured, uploadBase64Object } from '../../lib/objectStorage.js';
import { parseNfeProcXml, type ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

export interface AttachNfeXmlDeps {
    parse: (xml: string) => ParsedNfeCargo;
    upload: (params: { base64: string; fileName: string; mimeType: string; keyPrefix: string }) => Promise<{ storageKey: string }>;
    isStorageConfigured: () => boolean;
}

const defaultDeps: AttachNfeXmlDeps = {
    parse: parseNfeProcXml,
    upload: uploadBase64Object,
    isStorageConfigured: isObjectStorageConfigured,
};

export interface AttachNfeXmlInput {
    demandId: string;
    xml: string;
    actorUserId?: string | null;
}

/**
 * Anexa o XML da NF-e no balcão (fallback quando a Distribuição não trouxe o arquivo).
 * Valida que o XML é da mesma nota da demanda, guarda o arquivo com checksum e grava a carga
 * em `rawInputData.nfeXmlData` — o mesmo formato que `resolveLocalNfeCargo` usa como cache.
 */
export async function attachNfeXmlToDemand(input: AttachNfeXmlInput, deps: AttachNfeXmlDeps = defaultDeps): Promise<ParsedNfeCargo> {
    const demand = await prisma.demand.findUnique({
        where: { id: input.demandId },
        select: { id: true, status: true, documentKey: true, rawInputData: true },
    });
    if (!demand) throw new AppError('Demand not found', 404);
    if (demand.status !== 'AWAITING_ARRIVAL') throw new AppError('Demanda não está aguardando chegada', 400);

    const accessKey = demand.documentKey?.replace(/\D/g, '') ?? '';
    if (accessKey.length !== 44) throw new AppError('Esta entrada não tem chave de NF-e para conferir com o XML.', 400);

    // Defesa em profundidade: NF-e autorizada não tem DTD; recusa entidades/DOCTYPE.
    if (/<!DOCTYPE|<!ENTITY/i.test(input.xml)) throw new AppError('Arquivo XML inválido.', 400);

    let cargo: ParsedNfeCargo;
    try {
        cargo = deps.parse(input.xml);
    } catch {
        throw new AppError('Não foi possível ler este XML. Envie o XML completo da NF-e (nfeProc).', 400);
    }
    const chave = cargo.chave.replace(/\D/g, '');
    if (chave !== accessKey) {
        throw new AppError(`Este XML é de outra nota (chave …${chave.slice(-8)}). Confira o arquivo.`, 400);
    }

    const buffer = Buffer.from(input.xml, 'utf-8');
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    let storageKey: string | null = null;
    if (deps.isStorageConfigured()) {
        try {
            const uploaded = await deps.upload({
                base64: buffer.toString('base64'),
                fileName: `${accessKey}-nfe.xml`,
                mimeType: 'application/xml',
                keyPrefix: 'nfe-xml/balcao',
            });
            storageKey = uploaded.storageKey;
        } catch (error) {
            console.warn('[intake] Falha ao guardar o XML anexado no storage:', error instanceof Error ? error.message : error);
        }
    } else {
        console.warn('[intake] Object storage não configurado: XML anexado guardado só como carga na demanda.');
    }

    const current = demand.rawInputData && typeof demand.rawInputData === 'object' && !Array.isArray(demand.rawInputData)
        ? demand.rawInputData as Prisma.JsonObject : {};
    await prisma.demand.update({
        where: { id: demand.id },
        data: {
            rawInputData: {
                ...current,
                nfeXmlUpload: {
                    storageKey,
                    checksum,
                    size: buffer.length,
                    uploadedAt: new Date().toISOString(),
                    uploadedByUserId: input.actorUserId ?? null,
                },
                nfeXmlData: JSON.parse(JSON.stringify(cargo)),
            } as Prisma.InputJsonValue,
        },
    });
    return cargo;
}
