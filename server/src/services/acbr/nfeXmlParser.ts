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
    /** `xFant` — nome fantasia. */
    nomeFantasia?: string;
    municipio?: string;
    uf?: string;
    ie?: string;
    /** `cMun` — código IBGE do município (7 dígitos), fonte oficial da cidade na NF-e. */
    ibge?: string;
    cep?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
}

export interface ParsedNfeDestinatario {
    cnpj: string;
    /** Destinatário pessoa física (`dest/CPF`) — `cnpj` fica vazio nesse caso. */
    cpf?: string;
    razaoSocial: string;
    ie?: string;
    /** Diferente do emitente, o destinatário não tem enriquecimento externo (BrasilAPI) — o XML é a única fonte de endereço. */
    municipio?: string;
    uf?: string;
    /** `cMun` — código IBGE do município (7 dígitos), fonte oficial da cidade na NF-e. */
    ibge?: string;
    cep?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    /** `1`=contribuinte ICMS, `2`=isento de inscrição, `9`=não contribuinte — diz *por quê* `ie` está ausente. */
    indIEDest?: string;
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
    /**
     * `transp/modFrete` — quem contratou o frete: 0 remetente (CIF), 1 destinatário (FOB),
     * 2 terceiros, 3/4 transporte próprio, 9 sem transporte. Ausente em XMLs antigos guardados.
     */
    modFrete?: string;
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

function optionalText<K extends string>(fields: Record<K, unknown>): Partial<Record<K, string>> {
    const out: Partial<Record<K, string>> = {};
    for (const key of Object.keys(fields) as K[]) {
        const value = fields[key];
        if (value !== undefined && value !== null && String(value) !== '') out[key] = String(value);
    }
    return out;
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
    const enderDest = asRecord(dest?.enderDest);
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
            // Só entram quando presentes no XML (mantém o formato dos XMLs já armazenados).
            ...optionalText({
                nomeFantasia: emit?.xFant, ibge: enderEmit?.cMun, cep: enderEmit?.CEP, logradouro: enderEmit?.xLgr,
                numero: enderEmit?.nro, complemento: enderEmit?.xCpl, bairro: enderEmit?.xBairro,
            }),
        },
        destinatario: {
            cnpj: toText(dest?.CNPJ),
            razaoSocial: toText(dest?.xNome),
            // Ausente quando indIEDest = 2 (isento) ou 9 (não contribuinte) — normal, não é erro de parsing.
            ie: dest?.IE ? toText(dest.IE) : undefined,
            municipio: enderDest?.xMun ? toText(enderDest.xMun) : undefined,
            uf: enderDest?.UF ? toText(enderDest.UF) : undefined,
            ...optionalText({ cpf: dest?.CPF, ibge: enderDest?.cMun, complemento: enderDest?.xCpl }),
            cep: enderDest?.CEP ? toText(enderDest.CEP) : undefined,
            logradouro: enderDest?.xLgr ? toText(enderDest.xLgr) : undefined,
            numero: enderDest?.nro ? toText(enderDest.nro) : undefined,
            bairro: enderDest?.xBairro ? toText(enderDest.xBairro) : undefined,
            indIEDest: dest?.indIEDest ? toText(dest.indIEDest) : undefined,
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
        ...optionalText({ modFrete: transp?.modFrete }),
    };
}
