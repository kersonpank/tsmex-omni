import prisma from '../../lib/prisma.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { acbrFetchJson, classifyAcbrErrorResponse } from './acbrHttp.js';

function ambienteDistribToApiEnv(amb: 'homologacao' | 'producao'): AcbrFiscalEnvironment {
    return amb === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO';
}

export type DistribuicaoTipo = 'dist-nsu' | 'cons-nsu' | 'cons-chave';

export interface DistribuicaoNfeRequestBody {
    cpf_cnpj: string;
    ambiente: 'homologacao' | 'producao';
    uf_autor?: string;
    tipo_consulta: DistribuicaoTipo;
    dist_nsu?: number;
    cons_nsu?: number;
    cons_chave?: string;
    ignorar_tempo_espera?: boolean;
}

/** Solicita distribuição DF-e (POST /distribuicao/nfe). */
export async function solicitarDistribuicaoNfe(body: DistribuicaoNfeRequestBody): Promise<Record<string, unknown>> {
    return acbrFetchJson<Record<string, unknown>>('/distribuicao/nfe', {
        method: 'POST',
        body: JSON.stringify(body),
        scopes: ['empresa', 'nfe', 'distribuicao'],
        apiEnvironment: ambienteDistribToApiEnv(body.ambiente),
    });
}

export async function listarDocumentosDistribuicao(params: { top?: number; skip?: number } = {}): Promise<Record<string, unknown>> {
    const q = new URLSearchParams();
    if (params.top != null) q.set('$top', String(params.top));
    if (params.skip != null) q.set('$skip', String(params.skip));
    const qs = q.toString();
    return acbrFetchJson<Record<string, unknown>>(`/distribuicao/nfe/documentos${qs ? `?${qs}` : ''}`, {
        method: 'GET',
        scopes: ['empresa', 'nfe', 'distribuicao'],
    });
}

export async function getDistribuicaoById(id: string): Promise<Record<string, unknown>> {
    return acbrFetchJson<Record<string, unknown>>(`/distribuicao/nfe/${encodeURIComponent(id)}`, {
        method: 'GET',
        scopes: ['empresa', 'nfe', 'distribuicao'],
    });
}

/**
 * Baixa o XML de um documento da Distribuição NF-e via `GET /distribuicao/nfe/documentos/{id}/xml`.
 * CONFIRMADO: `documentoId` é o identificador interno alfanumérico da própria ACBr pra aquele
 * `DistribuicaoNfeDocumento` (formato tipo `nfe_3a196d092d3a42c3a1f83706a47eb64c`) — NUNCA a
 * chave de acesso SEFAZ de 44 dígitos nem o NSU. O chamador (`distribuicaoNfeSyncProcessor.ts`)
 * extrai esse `id` do payload de cada documento descoberto (`extractDocumentoId`); a chave de
 * acesso só serve pra identidade local (`accessKey`) e idempotência, nunca pra montar esta URL.
 * Reusa `classifyAcbrErrorResponse` (mesma função usada por `downloadCteXml`/`downloadCtePdf`)
 * para que 429/402 nesta chamada sejam tratados exatamente como qualquer outra do pipeline.
 */
export async function baixarXmlDocumentoDistribuicao(
    documentoId: string,
    ambiente: 'homologacao' | 'producao',
): Promise<string> {
    const apiEnvironment = ambienteDistribToApiEnv(ambiente);
    const baseUrl = getAcbrApiBaseUrlForEnvironment(apiEnvironment);
    const token = await getAcbrAccessToken(['empresa', 'nfe', 'distribuicao']);
    const path = `/distribuicao/nfe/documentos/${encodeURIComponent(documentoId)}/xml`;
    const res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        await classifyAcbrErrorResponse(res, path, await res.text());
    }
    return res.text();
}

/** Lê ou inicializa NSU armazenado para o CNPJ. */
export async function getUltimoNsuStored(cpfCnpj: string, ambiente: string): Promise<string> {
    const doc = digitsOnly(cpfCnpj);
    const row = await prisma.fiscalDistribuicaoCheckpoint.findUnique({
        where: { cpfCnpj_ambiente: { cpfCnpj: doc, ambiente } },
    });
    return row?.ultimoNsu ?? '0';
}

export async function setUltimoNsuStored(cpfCnpj: string, ambiente: string, ultimoNsu: string): Promise<void> {
    const doc = digitsOnly(cpfCnpj);
    await prisma.fiscalDistribuicaoCheckpoint.upsert({
        where: { cpfCnpj_ambiente: { cpfCnpj: doc, ambiente } },
        create: { cpfCnpj: doc, ambiente, ultimoNsu },
        update: { ultimoNsu },
    });
}

function digitsOnly(s: string): string {
    return s.replace(/\D/g, '');
}
