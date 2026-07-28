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
 * Parseia o payload de um documento retornado por `dist-nsu`/`cons-chave` (Distribuição NF-e ACBr).
 *
 * CONFIRMADO ao vivo contra a API real (2026-07-27/28, `prod.acbr.api.br`): a ACBr **não** devolve
 * o JSON aninhado estilo XML da SEFAZ que os branches de fallback abaixo assumiam (`resNFe`,
 * `nfeProc.NFe.infNFe`, `procEventoNFe.evento.infEvento`) — ela devolve um formato já achatado e
 * normalizado por ela mesma: `{ tipo_documento: 'nota'|'evento', resumo: boolean, chave_acesso,
 * emitente_cpf_cnpj, numero_protocolo, ... }`. Sem este branch, TODO documento real caía em
 * `DESCONHECIDO` (accessKey/cnpjEmitente null) — descartado em silêncio por quem chama isto
 * (`fetchNfeCompleta.ts` linha ~140, `distribuicaoNfeSyncProcessor.ts`), sem log nenhum. Foi
 * exatamente o que aconteceu numa bipagem real (chave 35260710684336000174550000000018991321178068):
 * a ACBr respondeu `resumo: false` (documento completo já liberado, sem precisar manifestar) e o
 * sistema não usou nada disso.
 *
 * `resumo: false` com `tipo_documento: 'nota'` = NF-e completa já liberada (equivalente a
 * `NFE_PROC` — não precisa mais manifestar Ciência da Operação antes de baixar o XML).
 * `resumo: true` = só resumo leve (equivalente a `RESUMO` — ainda exige manifestação antes do
 * XML completo ficar disponível).
 */
export function parseDistribuicaoDocumento(raw: Record<string, unknown>, nsu: string): ParsedDistribuicaoDocumento {
    if (typeof raw.chave_acesso === 'string' || typeof raw.tipo_documento === 'string') {
        const tipoDocumento = typeof raw.tipo_documento === 'string' ? raw.tipo_documento : '';
        const nsuDoRaw = typeof raw.nsu === 'string' || typeof raw.nsu === 'number' ? String(raw.nsu) : nsu;
        let tipo: DistribuicaoDocumentoTipo;
        if (tipoDocumento === 'evento') tipo = 'EVENTO';
        else if (tipoDocumento === 'nota') tipo = raw.resumo === true ? 'RESUMO' : 'NFE_PROC';
        else tipo = 'DESCONHECIDO';
        return {
            nsu: nsuDoRaw,
            tipo,
            accessKey: normalizedAccessKey(raw.chave_acesso),
            cnpjEmitente: digitsOnly(raw.emitente_cpf_cnpj),
            raw,
        };
    }

    // Fallback: shape aninhado estilo XML SEFAZ — nunca confirmado contra a API real, mantido por
    // segurança caso a ACBr um dia mude o formato de resposta pra este.
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
