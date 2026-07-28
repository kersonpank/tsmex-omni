import { XMLParser } from 'fast-xml-parser';

export interface ParsedNfeProduto {
    descricao: string;
    ncm: string;
    quantidade: number;
    valorUnitario: number;
    valorTotal: number;
}

export interface ParsedNfeEmitente {
    cnpj: string;
    razaoSocial: string;
    municipio?: string;
    uf?: string;
    ie?: string;
}

export interface ParsedNfeDestinatario {
    cnpj: string;
    razaoSocial: string;
    ie?: string;
}

export interface ParsedNfeTransportador {
    cnpj: string;
    razaoSocial: string;
    ie?: string;
}

export interface ParsedNfeCargo {
    chave: string;
    emitente: ParsedNfeEmitente;
    destinatario: ParsedNfeDestinatario;
    /** `undefined` quando o XML não declara transportador (`<transp><transporta>` ausente/CNPJ vazio) — comum em frete próprio/sem transportador formal. */
    transportador?: ParsedNfeTransportador;
    produtos: ParsedNfeProduto[];
    pesoBruto?: number;
    pesoLiquido?: number;
    quantidadeVolumes?: number;
    valorTotalNota: number;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

function toArray(v: unknown): Record<string, unknown>[] {
    if (v === undefined || v === null) return [];
    return (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
}

function toNumber(v: unknown): number {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : 0;
}

function toText(v: unknown): string {
    return v === undefined || v === null ? '' : String(v);
}

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) => name === 'det' || name === 'vol',
});

/**
 * Parseia o XML completo (`nfeProc`, layout 4.00 da SEFAZ) baixado via Distribuição NF-e ACBr
 * para extrair dados de carga (produtos, peso, volumes) e partes (emitente/destinatário).
 * Tags padrão (`infNFe`, `emit`, `dest`, `det`, `transp.vol`, `total.ICMSTot`) são schema público
 * estável da NF-e — diferente de payloads proprietários da ACBr, não exigem confirmação por spike,
 * mas o parser deve ser validado contra 1 XML real antes de depender dele em produção.
 */
export function parseNfeProcXml(xml: string): ParsedNfeCargo {
    const doc = xmlParser.parse(xml) as Record<string, unknown>;

    const infNFe =
        asRecord(asRecord(asRecord(doc.nfeProc)?.NFe)?.infNFe) ??
        asRecord(asRecord(doc.NFe)?.infNFe);

    if (!infNFe) {
        throw new Error('XML não contém nfeProc/NFe/infNFe — não é uma NF-e completa autorizada reconhecida.');
    }

    const chaveAttr = infNFe['@_Id'];
    const chave = typeof chaveAttr === 'string' ? chaveAttr.replace(/^NFe/, '') : '';

    const emit = asRecord(infNFe.emit);
    const enderEmit = asRecord(emit?.enderEmit);
    const dest = asRecord(infNFe.dest);
    const det = toArray(infNFe.det);
    const total = asRecord(asRecord(infNFe.total)?.ICMSTot);
    const transp = asRecord(infNFe.transp);
    const vols = toArray(transp?.vol);
    const transporta = asRecord(transp?.transporta);

    const produtos: ParsedNfeProduto[] = det.map((item) => {
        const prod = asRecord(item.prod) ?? {};
        return {
            descricao: toText(prod.xProd),
            ncm: toText(prod.NCM),
            quantidade: toNumber(prod.qCom),
            valorUnitario: toNumber(prod.vUnCom),
            valorTotal: toNumber(prod.vProd),
        };
    });

    let pesoBruto: number | undefined;
    let pesoLiquido: number | undefined;
    let quantidadeVolumes: number | undefined;
    if (vols.length > 0) {
        pesoBruto = vols.reduce((sum, v) => sum + toNumber(v.pesoB), 0);
        pesoLiquido = vols.reduce((sum, v) => sum + toNumber(v.pesoL), 0);
        quantidadeVolumes = vols.reduce((sum, v) => sum + toNumber(v.qVol), 0);
    }

    return {
        chave,
        emitente: {
            cnpj: toText(emit?.CNPJ),
            razaoSocial: toText(emit?.xNome),
            municipio: enderEmit?.xMun ? toText(enderEmit.xMun) : undefined,
            uf: enderEmit?.UF ? toText(enderEmit.UF) : undefined,
            ie: emit?.IE ? toText(emit.IE) : undefined,
        },
        destinatario: {
            cnpj: toText(dest?.CNPJ),
            razaoSocial: toText(dest?.xNome),
            // Ausente quando indIEDest = 2 (isento) ou 9 (não contribuinte) — normal, não é erro de parsing.
            ie: dest?.IE ? toText(dest.IE) : undefined,
        },
        transportador: transporta?.CNPJ
            ? {
                  cnpj: toText(transporta.CNPJ),
                  razaoSocial: toText(transporta.xNome),
                  ie: transporta.IE ? toText(transporta.IE) : undefined,
              }
            : undefined,
        produtos,
        pesoBruto,
        pesoLiquido,
        quantidadeVolumes,
        valorTotalNota: toNumber(total?.vNF),
    };
}
