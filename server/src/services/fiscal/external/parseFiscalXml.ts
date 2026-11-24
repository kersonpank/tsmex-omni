import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

/**
 * Leitura de XML fiscal emitido fora do TSM (sistema legado, contingência): CT-e (mod. 57) e
 * MDF-e (mod. 58) autorizados (`cteProc`/`mdfeProc`) e eventos (`procEventoCTe`/`procEventoMDFe`).
 * Só extrai o que a trava de numeração e o arquivo precisam; o XML original é guardado inteiro.
 */

export type ParsedFiscalXml =
    | { kind: 'document'; doc: ParsedFiscalDocument }
    | { kind: 'event'; event: ParsedFiscalEvent };

export interface ParsedFiscalDocument {
    model: 'CTE' | 'MDFE';
    accessKey: string;
    emitterCnpj: string;
    series: number;
    number: number;
    issuedAt: Date;
    environment: 'PRODUCAO' | 'HOMOLOGACAO';
    cStat: number | null;
    protocol: string | null;
    authorizedAt: Date | null;
    totalValue: string | null;
    senderDocument: string | null;
    recipientDocument: string | null;
    takerDocument: string | null;
    xmlSha256: string;
}

export interface ParsedFiscalEvent {
    model: 'CTE' | 'MDFE';
    accessKey: string;
    /** 110111 cancelamento, 110112 encerramento (MDF-e), 110110 carta de correção (CT-e). */
    tpEvento: string;
    nSeqEvento: number;
    cStat: number | null;
    protocol: string | null;
    at: string | null;
    xmlSha256: string;
}

export class FiscalXmlError extends Error {}

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
});

const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const text = (v: unknown): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'object') return text((v as Record<string, unknown>)['#text']);
    const s = String(v).trim();
    return s ? s : null;
};
const int = (v: unknown): number | null => {
    const s = text(v);
    if (s === null || !/^\d+$/.test(s)) return null;
    return Number(s);
};
const date = (v: unknown): Date | null => {
    const s = text(v);
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
};
const doc = (node: unknown): string | null => {
    if (!node || typeof node !== 'object') return null;
    const n = node as Record<string, unknown>;
    const d = digits(n.CNPJ ?? n.CPF);
    return d || null;
};

/** DV da chave de acesso (módulo 11, pesos 2..9 da direita para a esquerda) — igual para NF-e, CT-e e MDF-e. */
export function isValidAccessKey(key: string): boolean {
    if (!/^\d{44}$/.test(key)) return false;
    const base = key.slice(0, 43);
    const sum = [...base].reverse().reduce((acc, d, i) => acc + Number(d) * ((i % 8) + 2), 0);
    const rest = 11 - (sum % 11);
    const dv = rest >= 10 ? 0 : rest;
    return dv === Number(key[43]);
}

function sha256(xml: string): string {
    return createHash('sha256').update(xml, 'utf8').digest('hex');
}

function keyFromId(id: unknown, prefix: string): string {
    const s = text(id) ?? '';
    return s.startsWith(prefix) ? s.slice(prefix.length) : digits(s);
}

function parseDocument(model: 'CTE' | 'MDFE', proc: Record<string, unknown>, xml: string): ParsedFiscalDocument {
    const isCte = model === 'CTE';
    const root = (isCte ? proc.CTe : proc.MDFe) as Record<string, unknown> | undefined;
    const inf = (isCte ? root?.infCte : root?.infMDFe) as Record<string, unknown> | undefined;
    if (!inf) throw new FiscalXmlError(`XML sem ${isCte ? 'infCte' : 'infMDFe'}.`);
    const ide = (inf.ide ?? {}) as Record<string, unknown>;
    const protRoot = (isCte ? proc.protCTe : proc.protMDFe) as Record<string, unknown> | undefined;
    const prot = (protRoot?.infProt ?? {}) as Record<string, unknown>;

    const accessKey = keyFromId(inf['@Id'], isCte ? 'CTe' : 'MDFe') || digits(isCte ? prot.chCTe : prot.chMDFe);
    if (!isValidAccessKey(accessKey)) throw new FiscalXmlError(`Chave de acesso inválida: ${accessKey || '(vazia)'}.`);
    const expectedModel = isCte ? '57' : '58';
    if (accessKey.slice(20, 22) !== expectedModel) throw new FiscalXmlError(`A chave ${accessKey} não é de modelo ${expectedModel}.`);

    const series = int(ide.serie);
    const number = int(isCte ? ide.nCT : ide.nMDF);
    const issuedAt = date(ide.dhEmi);
    const tpAmb = text(ide.tpAmb);
    if (series === null || number === null || !issuedAt || (tpAmb !== '1' && tpAmb !== '2')) {
        throw new FiscalXmlError(`XML ${accessKey} sem série, número, data de emissão ou ambiente.`);
    }
    const emit = (inf.emit ?? {}) as Record<string, unknown>;
    const emitterCnpj = digits(emit.CNPJ ?? emit.CPF);
    if (!emitterCnpj) throw new FiscalXmlError(`XML ${accessKey} sem CNPJ do emitente.`);

    let takerDocument: string | null = null;
    if (isCte) {
        const toma = (ide.toma4 ?? null) as Record<string, unknown> | null;
        takerDocument = doc(toma);
        if (!takerDocument) {
            const t3 = text(((ide.toma3 ?? ide.toma) as Record<string, unknown> | undefined)?.toma);
            const byCode: Record<string, unknown> = { '0': inf.rem, '1': inf.exped, '2': inf.receb, '3': inf.dest };
            takerDocument = t3 !== null ? doc(byCode[t3]) : null;
        }
    }

    return {
        model,
        accessKey,
        emitterCnpj,
        series,
        number,
        issuedAt,
        environment: tpAmb === '1' ? 'PRODUCAO' : 'HOMOLOGACAO',
        cStat: int(prot.cStat),
        protocol: text(prot.nProt),
        authorizedAt: date(prot.dhRecbto),
        totalValue: isCte ? text(((inf.vPrest ?? {}) as Record<string, unknown>).vTPrest) : null,
        senderDocument: isCte ? doc(inf.rem) : null,
        recipientDocument: isCte ? doc(inf.dest) : null,
        takerDocument,
        xmlSha256: sha256(xml),
    };
}

function parseEvent(model: 'CTE' | 'MDFE', proc: Record<string, unknown>, xml: string): ParsedFiscalEvent {
    const isCte = model === 'CTE';
    const ev = (isCte ? proc.eventoCTe : proc.eventoMDFe) as Record<string, unknown> | undefined;
    const inf = (ev?.infEvento ?? {}) as Record<string, unknown>;
    const ret = ((isCte ? proc.retEventoCTe : proc.retEventoMDFe) as Record<string, unknown> | undefined)?.infEvento as Record<string, unknown> | undefined;
    const accessKey = digits(isCte ? inf.chCTe : inf.chMDFe);
    if (!isValidAccessKey(accessKey)) throw new FiscalXmlError(`Evento com chave inválida: ${accessKey || '(vazia)'}.`);
    const tpEvento = text(inf.tpEvento);
    if (!tpEvento) throw new FiscalXmlError(`Evento da chave ${accessKey} sem tpEvento.`);
    return {
        model,
        accessKey,
        tpEvento,
        nSeqEvento: int(inf.nSeqEvento) ?? 1,
        cStat: int(ret?.cStat),
        protocol: text(ret?.nProt),
        at: text(ret?.dhRegEvento) ?? text(inf.dhEvento),
        xmlSha256: sha256(xml),
    };
}

/** Lê um XML de CT-e/MDF-e (processado) ou de evento. Lança `FiscalXmlError` com motivo legível. */
export function parseFiscalXml(xml: string): ParsedFiscalXml {
    if (!xml || !xml.trim()) throw new FiscalXmlError('Arquivo vazio.');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new FiscalXmlError('XML com DOCTYPE/ENTITY não é aceito.');
    let tree: Record<string, unknown>;
    try {
        tree = parser.parse(xml) as Record<string, unknown>;
    } catch (err) {
        throw new FiscalXmlError(`XML ilegível: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (tree.cteProc) return { kind: 'document', doc: parseDocument('CTE', tree.cteProc as Record<string, unknown>, xml) };
    if (tree.mdfeProc) return { kind: 'document', doc: parseDocument('MDFE', tree.mdfeProc as Record<string, unknown>, xml) };
    if (tree.procEventoCTe) return { kind: 'event', event: parseEvent('CTE', tree.procEventoCTe as Record<string, unknown>, xml) };
    if (tree.procEventoMDFe) return { kind: 'event', event: parseEvent('MDFE', tree.procEventoMDFe as Record<string, unknown>, xml) };
    if (tree.CTe || tree.MDFe) throw new FiscalXmlError('XML sem protocolo de autorização (precisa ser o cteProc/mdfeProc autorizado).');
    throw new FiscalXmlError('Não é XML de CT-e, MDF-e ou evento.');
}
