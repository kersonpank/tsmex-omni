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
    tipoServico: string;
    cfop: string | null;
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
    icmsBase?: number;
    icmsAliquota?: number;
    icmsValor?: number;
    observacoes?: string | null;
    documentosOriginarios?: Array<{ tipo: string; cnpjEmitente?: string; serieNumero: string }>;
}

/** Formato genérico para envio à API de CT-e (SEFAZ/agregador). */
export interface CtePayloadDto {
    numero: number;
    serie?: number;
    tipoServico: string;
    cfop: string | null;
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
    icms?: { base: number; aliquota: number; valor: number };
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
        serie: 1,
        tipoServico: calc.tipoFrete || 'Normal',
        cfop: calc.cfop,
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
        icmsValor: calc.icmsValue ?? undefined,
        observacoes: calc.observacoes,
        documentosOriginarios: docs.length ? docs : undefined,
    };
}

/** Monta o payload para CT-e (envio à API fiscal). */
export function buildCtePayload(params: Parameters<typeof buildMinutaPayload>[0]): CtePayloadDto {
    const m = buildMinutaPayload(params);
    return {
        numero: m.numero,
        serie: m.serie,
        tipoServico: m.tipoServico,
        cfop: m.cfop,
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
        observacoes: m.observacoes,
        documentosOriginarios: m.documentosOriginarios,
    };
}
