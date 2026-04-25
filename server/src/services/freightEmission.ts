import prisma from '../lib/prisma.js';

/**
 * Obtém o próximo número de Minuta para o Hub (emissor).
 * Incrementa lastMinutaNumber atomicamente e retorna o número atribuído.
 */
export async function getNextMinutaNumber(hubId: string): Promise<number> {
    const hub = await prisma.hub.update({
        where: { id: hubId },
        data: { lastMinutaNumber: { increment: 1 } },
        select: { lastMinutaNumber: true },
    });
    return hub.lastMinutaNumber;
}

/**
 * Obtém o próximo número de CT-e para o Hub (emissor).
 * Incrementa lastCteNumber atomicamente e retorna o número atribuído.
 */
export async function getNextCteNumber(hubId: string): Promise<number> {
    const hub = await prisma.hub.update({
        where: { id: hubId },
        data: { lastCteNumber: { increment: 1 } },
        select: { lastCteNumber: true },
    });
    return hub.lastCteNumber;
}

export async function getNextFiscalEmitterMinutaNumber(fiscalEmitterId: string): Promise<number> {
    const emitter = await prisma.fiscalEmitter.update({
        where: { id: fiscalEmitterId },
        data: { lastMinutaNumber: { increment: 1 } },
        select: { lastMinutaNumber: true },
    });
    return emitter.lastMinutaNumber;
}

export async function getNextFiscalEmitterCteNumber(fiscalEmitterId: string): Promise<number> {
    const emitter = await prisma.fiscalEmitter.update({
        where: { id: fiscalEmitterId },
        data: { lastCteNumber: { increment: 1 } },
        select: { lastCteNumber: true },
    });
    return emitter.lastCteNumber;
}

// --- DTOs para Minuta e CT-e ---

export interface DocumentoParteDto {
    nome: string;
    document: string;
    ie?: string | null;
    endereco?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
    fone?: string | null;
}

export interface DocumentoEmitenteDto extends DocumentoParteDto {
    rntrc?: string | null;
}

export interface DocumentoMercadoriaDto {
    produtoPredominante: string;
    pesoBruto: number;
    pesoFaturado: number;
    volumes: number;
    cubagemM3: number;
    valorTotal: number;
}

export interface DocumentoFreteComponentesDto {
    freightBase: number;
    adValorem: number;
    gris: number;
    toll: number;
    dispatch: number;
    others: number;
    icms: number;
}

export interface MinutaPayloadDto {
    numero: number;
    serie?: number;
    documentLabel: 'MINUTA' | 'DACTE';
    watermark?: string;
    modelo?: string;
    chaveAcesso?: string | null;
    codigoBarras?: string | null;
    qrCodeUrl?: string | null;
    protocolo?: string | null;
    autorizacaoEm?: string | null;
    tipoServico: string;
    cfop: string | null;
    cst?: string | null;
    origemPrestacao: string;
    destinoPrestacao: string;
    emitente: DocumentoEmitenteDto;
    remetente: DocumentoParteDto | null;
    destinatario: DocumentoParteDto | null;
    tomador: DocumentoParteDto | null;
    expedidor: DocumentoParteDto | null;
    recebedor: DocumentoParteDto | null;
    mercadoria: DocumentoMercadoriaDto;
    componentesFrete: DocumentoFreteComponentesDto;
    freightTotal: number;
    valorReceber?: number;
    icmsBase?: number;
    icmsAliquota?: number;
    icmsValor?: number;
    impostos?: {
        icms?: { cst?: string | null; base: number; aliquota: number; valor: number };
        ibsCbs?: { cst?: string | null; classTrib?: string | null; base?: number; valorIbs?: number; valorCbs?: number };
    };
    ide?: {
        naturezaOperacao: string;
        modal: string;
        tipoCte: string;
        tipoServico: string;
        dataHoraEmissao: string;
        ambiente: string;
    };
    observacoes?: string | null;
    documentosOriginarios?: Array<{ tipo: string; cnpjEmitente?: string; serieNumero: string }>;
    recibo?: {
        declaracao: string;
        documentoNumero: string;
    };
}

/** Formato genérico para envio à API de CT-e (SEFAZ/agregador). */
export interface CtePayloadDto {
    numero: number;
    serie?: number;
    documentLabel?: 'MINUTA' | 'DACTE';
    watermark?: string;
    modelo?: string;
    chaveAcesso?: string | null;
    codigoBarras?: string | null;
    qrCodeUrl?: string | null;
    protocolo?: string | null;
    autorizacaoEm?: string | null;
    tipoServico: string;
    cfop: string | null;
    cst?: string | null;
    origemPrestacao: string;
    destinoPrestacao: string;
    emitente: DocumentoEmitenteDto;
    remetente: DocumentoParteDto | null;
    destinatario: DocumentoParteDto | null;
    tomador: DocumentoParteDto | null;
    expedidor: DocumentoParteDto | null;
    recebedor: DocumentoParteDto | null;
    mercadoria: DocumentoMercadoriaDto;
    componentesFrete: DocumentoFreteComponentesDto;
    valorTotal: number;
    valorReceber?: number;
    icms?: { base: number; aliquota: number; valor: number };
    impostos?: MinutaPayloadDto['impostos'];
    ide?: MinutaPayloadDto['ide'];
    observacoes?: string | null;
    documentosOriginarios?: Array<{ tipo: string; cnpjEmitente?: string; serieNumero: string }>;
}

function personToParteDto(p: { legalName: string; document: string; stateRegistration?: string | null; address?: string | null; neighborhood?: string | null; number?: string | null; city?: string | null; state?: string | null; cep?: string | null } | null): DocumentoParteDto | null {
    if (!p) return null;
    const endereco = [p.address, p.number, p.neighborhood].filter(Boolean).join(', ');
    return {
        nome: p.legalName,
        document: p.document,
        ie: p.stateRegistration ?? null,
        endereco: endereco || undefined,
        municipio: p.city ?? undefined,
        uf: p.state ?? undefined,
        cep: p.cep ?? undefined,
    };
}

function hubPersonToEmitenteDto(hub: { name: string; code: string; phone?: string | null; rntrc?: string | null }, person: { legalName: string; document: string; stateRegistration?: string | null; address?: string | null; neighborhood?: string | null; number?: string | null; city?: string | null; state?: string | null; cep?: string | null }): DocumentoEmitenteDto {
    const base = personToParteDto(person)!;
    return {
        ...base,
        rntrc: hub.rntrc ?? null,
    };
}

/** Monta o payload para Minuta (documento interno). */
export function buildMinutaPayload(params: {
    calc: {
        originCity: string | null;
        destCity: string | null;
        cfop: string | null;
        cst?: string | null;
        tipoFrete: string | null;
        observacoes: string | null;
        volumes: number;
        weight: number;
        effectiveWeight: number | null;
        cubage: number | null;
        nfValue: number;
        commodity: string | null;
        freightTotal: number;
        breakdown: unknown;
        icmsValue: number | null;
    };
    order: {
        freightTerm: string | null;
        remetentePerson: { legalName: string; document: string; stateRegistration?: string | null; address?: string | null; neighborhood?: string | null; number?: string | null; city?: string | null; state?: string | null; cep?: string | null } | null;
        destinatarioPerson: { legalName: string; document: string; stateRegistration?: string | null; address?: string | null; neighborhood?: string | null; number?: string | null; city?: string | null; state?: string | null; cep?: string | null } | null;
        consignatarioPerson: { legalName: string; document: string; stateRegistration?: string | null; address?: string | null; neighborhood?: string | null; number?: string | null; city?: string | null; state?: string | null; cep?: string | null } | null;
        expedidorPerson: { legalName: string; document: string; stateRegistration?: string | null; address?: string | null; neighborhood?: string | null; number?: string | null; city?: string | null; state?: string | null; cep?: string | null } | null;
        invoicesRel?: Array<{ nfNumber: string; type: string }>;
    };
    hub: { name: string; code: string; phone?: string | null; rntrc?: string | null };
    person: { legalName: string; document: string; stateRegistration?: string | null; address?: string | null; neighborhood?: string | null; number?: string | null; city?: string | null; state?: string | null; cep?: string | null };
    numero: number;
    serie?: number;
    ambiente?: string;
    documentLabel?: 'MINUTA' | 'DACTE';
    chaveAcesso?: string | null;
    protocolo?: string | null;
    autorizacaoEm?: string | null;
    qrCodeUrl?: string | null;
}): MinutaPayloadDto {
    const { calc, order, hub, person, numero } = params;
    const tomador = order.freightTerm === 'CIF'
        ? order.remetentePerson
        : order.freightTerm === 'FOB'
            ? order.destinatarioPerson
            : (order.consignatarioPerson ?? order.destinatarioPerson);

    const breakdown = (calc.breakdown as Record<string, number>) || {};
    const componentes: DocumentoFreteComponentesDto = {
        freightBase: breakdown.freightBase ?? 0,
        adValorem: breakdown.adValorem ?? 0,
        gris: breakdown.gris ?? 0,
        toll: breakdown.toll ?? 0,
        dispatch: breakdown.dispatch ?? 0,
        others: breakdown.others ?? 0,
        icms: breakdown.icms ?? calc.icmsValue ?? 0,
    };

    const pesoFaturado = calc.effectiveWeight ?? calc.weight;
    const docs = order.invoicesRel?.map((inv) => ({
        tipo: inv.type === 'NFE' ? 'NF-E' : 'OUTRAS',
        serieNumero: inv.nfNumber,
    })) ?? [];

    return {
        numero,
        serie: params.serie ?? 1,
        documentLabel: params.documentLabel ?? 'MINUTA',
        watermark: params.documentLabel === 'DACTE'
            ? (params.ambiente === 'HOMOLOGACAO' ? 'CT-E EMITIDO EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL' : undefined)
            : 'MINUTA - SEM VALOR FISCAL',
        modelo: '57',
        chaveAcesso: params.chaveAcesso ?? null,
        codigoBarras: params.chaveAcesso ?? null,
        qrCodeUrl: params.qrCodeUrl ?? null,
        protocolo: params.protocolo ?? null,
        autorizacaoEm: params.autorizacaoEm ?? null,
        tipoServico: calc.tipoFrete || 'Normal',
        cfop: calc.cfop,
        cst: calc.cst ?? null,
        origemPrestacao: calc.originCity || '',
        destinoPrestacao: calc.destCity || '',
        emitente: hubPersonToEmitenteDto(hub, person),
        remetente: personToParteDto(order.remetentePerson),
        destinatario: personToParteDto(order.destinatarioPerson),
        tomador: personToParteDto(tomador),
        expedidor: personToParteDto(order.expedidorPerson),
        recebedor: null,
        mercadoria: {
            produtoPredominante: calc.commodity || 'Não informado',
            pesoBruto: calc.weight,
            pesoFaturado,
            volumes: calc.volumes,
            cubagemM3: calc.cubage ?? 0,
            valorTotal: calc.nfValue,
        },
        componentesFrete: componentes,
        freightTotal: calc.freightTotal,
        valorReceber: calc.freightTotal,
        icmsBase: calc.freightTotal - (calc.icmsValue ?? 0),
        icmsAliquota: calc.icmsValue ? 12 : 0,
        icmsValor: calc.icmsValue ?? undefined,
        impostos: {
            icms: {
                cst: calc.cst ?? null,
                base: calc.freightTotal - (calc.icmsValue ?? 0),
                aliquota: calc.icmsValue ? 12 : 0,
                valor: calc.icmsValue ?? 0,
            },
        },
        ide: {
            naturezaOperacao: 'TRANSPORTE RODOVIARIO DE CARGAS',
            modal: 'Rodoviário',
            tipoCte: 'Normal',
            tipoServico: calc.tipoFrete || 'Normal',
            dataHoraEmissao: new Date().toISOString(),
            ambiente: params.ambiente ?? 'OPERACIONAL',
        },
        observacoes: calc.observacoes,
        documentosOriginarios: docs.length ? docs : undefined,
        recibo: {
            declaracao: 'Declaro que recebi os volumes deste documento em perfeito estado.',
            documentoNumero: String(numero),
        },
    };
}

/** Monta o payload para CT-e (envio à API fiscal). */
export function buildCtePayload(params: Parameters<typeof buildMinutaPayload>[0]): CtePayloadDto {
    const m = buildMinutaPayload({ ...params, documentLabel: 'DACTE' });
    return {
        numero: m.numero,
        serie: m.serie,
        documentLabel: 'DACTE',
        watermark: undefined,
        modelo: m.modelo,
        chaveAcesso: m.chaveAcesso,
        codigoBarras: m.codigoBarras,
        qrCodeUrl: m.qrCodeUrl,
        protocolo: m.protocolo,
        autorizacaoEm: m.autorizacaoEm,
        tipoServico: m.tipoServico,
        cfop: m.cfop,
        cst: m.cst,
        origemPrestacao: m.origemPrestacao,
        destinoPrestacao: m.destinoPrestacao,
        emitente: m.emitente,
        remetente: m.remetente,
        destinatario: m.destinatario,
        tomador: m.tomador,
        expedidor: m.expedidor,
        recebedor: m.recebedor,
        mercadoria: m.mercadoria,
        componentesFrete: m.componentesFrete,
        valorTotal: m.freightTotal,
        icms: m.icmsValor != null ? { base: m.freightTotal - m.icmsValor, aliquota: 12, valor: m.icmsValor } : undefined,
        ide: m.ide,
        impostos: m.impostos,
        valorReceber: m.valorReceber,
        observacoes: m.observacoes,
        documentosOriginarios: m.documentosOriginarios,
    };
}
