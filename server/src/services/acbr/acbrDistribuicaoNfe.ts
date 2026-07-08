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
 * TODO (mesmo bloqueio de schema não confirmado das Tasks 3/9 — sem credenciais ACBr neste
 * ambiente e o OpenAPI exige autenticação): baixa o XML de um documento da Distribuição NF-e
 * via `GET /distribuicao/nfe/documentos/{id}/xml`. O `documentoId` esperado aqui é o campo
 * `id` do payload retornado por `dist-nsu` — mesma convenção já confirmada em produção para
 * CT-e (`downloadCteXml` em `acbrCteEmit.ts` usa `created.id` da resposta de `POST /cte`).
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
