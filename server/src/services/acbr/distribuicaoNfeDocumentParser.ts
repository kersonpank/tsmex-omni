export type DistribuicaoDocumentoTipo = 'RESUMO' | 'NFE_PROC' | 'EVENTO' | 'DESCONHECIDO';

export interface ParsedDistribuicaoDocumento {
    nsu: string;
    tipo: DistribuicaoDocumentoTipo;
    accessKey: string | null;
    cnpjEmitente: string | null;
    raw: Record<string, unknown>;
}

function digitsOnly(s: unknown): string | null {
    return typeof s === 'string' ? s.replace(/\D/g, '') : null;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

function normalizedAccessKey(chave: unknown): string | null {
    const digits = digitsOnly(chave);
    return digits && digits.length === 44 ? digits : null;
}

/**
 * Parseia o payload de um documento retornado por `dist-nsu` (Distribuição NF-e ACBr).
 * Nomes de campo (`resNFe`, `nfeProc.NFe.infNFe`, `procEventoNFe.evento.infEvento`) seguem o
 * schema padrão de Distribuição DFe da SEFAZ — confirmar contra um payload real (Task 2 do
 * plano) antes de considerar definitivo, ajustando aqui se a API ACBr divergir.
 */
export function parseDistribuicaoDocumento(raw: Record<string, unknown>, nsu: string): ParsedDistribuicaoDocumento {
    const resNFe = asRecord(raw.resNFe);
    if (resNFe) {
        return {
            nsu,
            tipo: 'RESUMO',
            accessKey: normalizedAccessKey(resNFe.chNFe),
            cnpjEmitente: digitsOnly(resNFe.CNPJ),
            raw,
        };
    }

    const infNFe = asRecord(asRecord(asRecord(raw.nfeProc)?.NFe)?.infNFe);
    if (infNFe) {
        const emit = asRecord(infNFe.emit);
        return {
            nsu,
            tipo: 'NFE_PROC',
            accessKey: normalizedAccessKey(infNFe.Id),
            cnpjEmitente: digitsOnly(emit?.CNPJ),
            raw,
        };
    }

    const infEvento = asRecord(asRecord(asRecord(raw.procEventoNFe)?.evento)?.infEvento);
    if (infEvento) {
        return {
            nsu,
            tipo: 'EVENTO',
            accessKey: normalizedAccessKey(infEvento.chNFe),
            cnpjEmitente: digitsOnly(infEvento.CNPJ),
            raw,
        };
    }

    return { nsu, tipo: 'DESCONHECIDO', accessKey: null, cnpjEmitente: null, raw };
}
