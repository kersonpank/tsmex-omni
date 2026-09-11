import { efreteAuthedGet, efreteAuthedPost } from './efreteAuth.js';
import type { AdicionarOperacaoTransporteV2Payload } from './efreteCiotMapper.js';
import type { EfreteEnvironment } from './efreteConfig.js';

interface AdicionarOperacaoTransporteResponse {
    Sucesso?: boolean;
    CodigoIdentificacaoOperacao?: string;
    ProtocoloServico?: string;
    Excecao?: { Mensagem?: string; Codigo?: string };
}

export interface SubmitCiotResult {
    codigoIdentificacaoOperacao: string;
    protocoloServico?: string;
    raw: AdicionarOperacaoTransporteResponse;
}

/** POST /services/Pef/AdicionarOperacaoTransporteV2 — nunca chamar sem antes checar idempotência via consultarStatusCiot. */
export async function submitCiotToEfrete(payload: AdicionarOperacaoTransporteV2Payload, environment: EfreteEnvironment): Promise<SubmitCiotResult> {
    const res = await efreteAuthedPost<AdicionarOperacaoTransporteResponse>(
        '/services/Pef/AdicionarOperacaoTransporteV2',
        payload as unknown as Record<string, unknown>, { environment },
    );
    if (!res.CodigoIdentificacaoOperacao) {
        throw new Error('eFrete AdicionarOperacaoTransporteV2: resposta sem CodigoIdentificacaoOperacao.');
    }
    return { codigoIdentificacaoOperacao: res.CodigoIdentificacaoOperacao, protocoloServico: res.ProtocoloServico, raw: res };
}

interface ConsultarCiotResponse {
    Sucesso?: boolean;
    CodigoIdentificacaoOperacao?: string;
    EstadoCiot?: 'EmViagem' | 'Encerrado' | 'Cancelado';
    ProtocoloServico?: string;
    Excecao?: { Mensagem?: string; Codigo?: string };
}

interface ObterCiotPdfResponse {
    Sucesso?: boolean;
    Pdf?: string;
    Excecao?: { Mensagem?: string; Codigo?: string };
}

export type EfreteGet = typeof efreteAuthedGet;

/** Obtém o PDF obrigatório do CIOT autorizado. */
export async function obterCiotPdf(
    codigoIdentificacaoOperacao: string,
    environment: EfreteEnvironment,
    documentoViagem?: string,
    get: EfreteGet = efreteAuthedGet,
): Promise<string> {
    const res = await get<ObterCiotPdfResponse>(
        '/Services/Pef/ObterOperacaoTransportePdf',
        { CodigoIdentificacaoOperacao: codigoIdentificacaoOperacao, ...(documentoViagem ? { DocumentoViagem: documentoViagem } : {}) },
        { environment },
    );
    const pdf = res.Pdf?.trim();
    if (!pdf || !/^[A-Za-z0-9+/]*={0,2}$/.test(pdf) || pdf.length % 4 !== 0) {
        throw new Error('eFrete CIOT: resposta PDF inválida.');
    }
    const bytes = Buffer.from(pdf, 'base64');
    if (!bytes.length || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('eFrete CIOT: conteúdo retornado não é um PDF.');
    }
    return pdf;
}

export interface ConsultarCiotResult {
    exists: boolean;
    codigoIdentificacaoOperacao?: string;
    estado?: 'EmViagem' | 'Encerrado' | 'Cancelado';
    protocoloServico?: string;
}

/**
 * Consulta por `IdOperacaoCliente` — chave de idempotência. Deve ser chamada SEMPRE antes de
 * `submitCiotToEfrete` (inclusive em retry após timeout): se já existir CIOT pra esse id, reusa
 * em vez de reemitir (evita CIOT duplicado / multa ANTT).
 */
export async function consultarStatusCiot(idOperacaoCliente: string, environment: EfreteEnvironment): Promise<ConsultarCiotResult> {
    try {
        const res = await efreteAuthedGet<ConsultarCiotResponse>(
            '/services/Pef/ObterCodigoIdentificacaoOperacaoTransportePorIdOperacaoCliente',
            { IdOperacaoCliente: idOperacaoCliente }, { environment },
        );
        if (!res.CodigoIdentificacaoOperacao) return { exists: false };
        return { exists: true, codigoIdentificacaoOperacao: res.CodigoIdentificacaoOperacao, estado: res.EstadoCiot, protocoloServico: res.ProtocoloServico };
    } catch {
        // Não encontrado é um resultado esperado desta consulta, não uma falha de infraestrutura;
        // tratamos qualquer erro de API aqui como "ainda não existe" — o submit segue o fluxo normal.
        return { exists: false };
    }
}

interface CancelarEncerrarResponse {
    Sucesso?: boolean;
    CodigoIdentificacaoOperacao?: string;
    Protocolo?: string;
    Data?: string;
    Excecao?: { Mensagem?: string; Codigo?: string };
}

export async function cancelarCiot(codigoIdentificacaoOperacao: string, justificativa: string): Promise<void> {
    await efreteAuthedPost<CancelarEncerrarResponse>('/Services/Pef/CancelarOperacaoTransporte', {
        CodigoIdentificacaoOperacao: codigoIdentificacaoOperacao,
        Justificativa: justificativa,
    });
}

export async function encerrarCiot(codigoIdentificacaoOperacao: string): Promise<void> {
    await efreteAuthedPost<CancelarEncerrarResponse>('/Services/Pef/EncerrarOperacaoTransporte', {
        CodigoIdentificacaoOperacao: codigoIdentificacaoOperacao,
    });
}
