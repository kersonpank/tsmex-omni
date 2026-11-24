import type { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { FiscalXmlError, parseFiscalXml, type ParsedFiscalEvent } from './parseFiscalXml.js';

export type ImportOutcome =
    | { result: 'created'; accessKey: string; model: 'CTE' | 'MDFE' }
    | { result: 'duplicate'; accessKey: string }
    | { result: 'own-document'; accessKey: string }
    | { result: 'event-applied'; accessKey: string; tpEvento: string }
    | { result: 'event-duplicate'; accessKey: string; tpEvento: string }
    | { result: 'event-orphan'; accessKey: string; tpEvento: string }
    | { result: 'rejected'; reason: string };

/** cStat de autorização aceitos: 100 autorizado; 150 autorizado fora de prazo. */
const AUTHORIZED = new Set([100, 150]);
/** cStat de evento registrado: 135 vinculado; 136 registrado sem vínculo. */
const EVENT_OK = new Set([135, 136]);

interface StoredEvent {
    tpEvento: string;
    nSeqEvento: number;
    cStat: number | null;
    protocol: string | null;
    at: string | null;
    xmlSha256: string;
}

export interface ImportOptions {
    sourceSystem?: string;
    sourceNote?: string | null;
    importedByUserId?: string | null;
}

async function isOwnDocument(accessKey: string): Promise<boolean> {
    const [cte, mdfe] = await Promise.all([
        prisma.orderFreightCalculation.findFirst({ where: { cteAccessKey: accessKey }, select: { id: true } }),
        prisma.manifestFiscalDocument.findFirst({ where: { accessKey }, select: { id: true } }),
    ]);
    return Boolean(cte || mdfe);
}

async function applyEvent(event: ParsedFiscalEvent): Promise<ImportOutcome> {
    const existing = await prisma.externalFiscalDocument.findUnique({ where: { accessKey: event.accessKey } });
    if (!existing) return { result: 'event-orphan', accessKey: event.accessKey, tpEvento: event.tpEvento };
    const events = (Array.isArray(existing.events) ? existing.events : []) as unknown as StoredEvent[];
    if (events.some((e) => e.xmlSha256 === event.xmlSha256 || (e.tpEvento === event.tpEvento && e.nSeqEvento === event.nSeqEvento))) {
        return { result: 'event-duplicate', accessKey: event.accessKey, tpEvento: event.tpEvento };
    }
    const stored: StoredEvent = {
        tpEvento: event.tpEvento,
        nSeqEvento: event.nSeqEvento,
        cStat: event.cStat,
        protocol: event.protocol,
        at: event.at,
        xmlSha256: event.xmlSha256,
    };
    const registered = event.cStat === null || EVENT_OK.has(event.cStat);
    let status = existing.status;
    if (registered && event.tpEvento === '110111') status = 'CANCELLED';
    else if (registered && event.tpEvento === '110112' && existing.model === 'MDFE' && status !== 'CANCELLED') status = 'CLOSED';
    await prisma.externalFiscalDocument.update({
        where: { id: existing.id },
        data: { events: [...events, stored] as unknown as Prisma.InputJsonValue, status },
    });
    return { result: 'event-applied', accessKey: event.accessKey, tpEvento: event.tpEvento };
}

/**
 * Importa um XML fiscal emitido fora do TSM. Idempotente: a mesma chave entra uma vez; o mesmo
 * evento é aplicado uma vez. Documento que o próprio TSM emitiu é recusado (já está no pedido/viagem).
 * Eventos de documento ainda não importado voltam como `event-orphan` (importe os documentos antes).
 */
export async function importExternalFiscalXml(xml: string, options: ImportOptions = {}): Promise<ImportOutcome> {
    let parsed;
    try {
        parsed = parseFiscalXml(xml);
    } catch (err) {
        if (err instanceof FiscalXmlError) return { result: 'rejected', reason: err.message };
        throw err;
    }
    if (parsed.kind === 'event') return applyEvent(parsed.event);

    const doc = parsed.doc;
    if (doc.cStat !== null && !AUTHORIZED.has(doc.cStat)) {
        return { result: 'rejected', reason: `Documento ${doc.accessKey} não autorizado (cStat ${doc.cStat}).` };
    }
    if (doc.cStat === null || !doc.protocol) {
        return { result: 'rejected', reason: `Documento ${doc.accessKey} sem protocolo de autorização.` };
    }
    if (await isOwnDocument(doc.accessKey)) return { result: 'own-document', accessKey: doc.accessKey };

    try {
        await prisma.externalFiscalDocument.create({
            data: {
                model: doc.model,
                accessKey: doc.accessKey,
                emitterCnpj: doc.emitterCnpj,
                series: doc.series,
                number: doc.number,
                issuedAt: doc.issuedAt,
                environment: doc.environment,
                authorizationCStat: doc.cStat,
                protocol: doc.protocol,
                authorizedAt: doc.authorizedAt,
                totalValue: doc.totalValue,
                senderDocument: doc.senderDocument,
                recipientDocument: doc.recipientDocument,
                takerDocument: doc.takerDocument,
                xml,
                xmlSha256: doc.xmlSha256,
                sourceSystem: options.sourceSystem ?? 'LEGADO',
                sourceNote: options.sourceNote ?? null,
                importedByUserId: options.importedByUserId ?? null,
            },
        });
    } catch (err) {
        if ((err as { code?: string }).code === 'P2002') return { result: 'duplicate', accessKey: doc.accessKey };
        throw err;
    }
    return { result: 'created', accessKey: doc.accessKey, model: doc.model };
}

/** Maior número externo por CNPJ + modelo + série + ambiente (para conferir a numeração na virada). */
export async function externalNumberingSummary(cnpj?: string) {
    const rows = await prisma.externalFiscalDocument.groupBy({
        by: ['emitterCnpj', 'model', 'series', 'environment'],
        where: cnpj ? { emitterCnpj: cnpj.replace(/\D/g, '') } : undefined,
        _max: { number: true, issuedAt: true },
        _count: { _all: true },
    });
    return rows.map((r) => ({
        emitterCnpj: r.emitterCnpj,
        model: r.model,
        series: r.series,
        environment: r.environment,
        lastNumber: r._max.number ?? 0,
        lastIssuedAt: r._max.issuedAt,
        count: r._count._all,
    }));
}
