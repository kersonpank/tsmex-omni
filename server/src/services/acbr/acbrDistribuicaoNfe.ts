import prisma from '../../lib/prisma.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { acbrFetchJson, classifyAcbrErrorResponse, AcbrHttpError } from './acbrHttp.js';

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

/** Confirmado ao vivo (2026-07-28, prod.acbr.api.br): rate-limit de 1 req/hora por CNPJ da
 * Distribuição DF-e vem como HTTP 400 (não 429/402, que já têm tratamento dedicado por outros
 * motivos) sem código estruturado — só um texto livre tipo "...Tente novamente em 57 minuto(s).". */
const DIST_RATE_LIMIT_MINUTES_REGEX = /em\s+(\d+)\s+minuto/i;

export function isDistribuicaoRateLimitError(err: unknown): err is AcbrHttpError {
    return err instanceof AcbrHttpError && err.httpStatus === 400 && DIST_RATE_LIMIT_MINUTES_REGEX.test(err.message);
}

export function parseRateLimitMinutes(err: AcbrHttpError): number {
    const match = err.message.match(DIST_RATE_LIMIT_MINUTES_REGEX);
    const minutes = match ? Number(match[1]) : NaN;
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
}

export interface SolicitarDistribuicaoNfeDeps {
    acbrFetchJson: typeof acbrFetchJson;
    prisma: { fiscalDistribuicaoCheckpoint: Pick<typeof prisma.fiscalDistribuicaoCheckpoint, 'upsert'> };
}

const defaultSolicitarDistribuicaoNfeDeps: SolicitarDistribuicaoNfeDeps = {
    acbrFetchJson,
    prisma: { fiscalDistribuicaoCheckpoint: prisma.fiscalDistribuicaoCheckpoint },
};

/** Best-effort: nunca deixa uma falha ao gravar o cooldown mascarar o resultado real da chamada
 * (sucesso ou erro original) que motivou a gravação. */
async function recordDistNfeNextAllowedAt(
    deps: SolicitarDistribuicaoNfeDeps,
    cpfCnpj: string,
    ambiente: string,
    nextAllowedAt: Date,
): Promise<void> {
    try {
        const doc = digitsOnly(cpfCnpj);
        await deps.prisma.fiscalDistribuicaoCheckpoint.upsert({
            where: { cpfCnpj_ambiente: { cpfCnpj: doc, ambiente } },
            create: { cpfCnpj: doc, ambiente, distNfeNextAllowedAt: nextAllowedAt },
            update: { distNfeNextAllowedAt: nextAllowedAt },
        });
    } catch (err) {
        console.warn('[acbrDistribuicaoNfe] Falha ao gravar distNfeNextAllowedAt:', err instanceof Error ? err.message : err);
    }
}

/**
 * Solicita distribuição DF-e (POST /distribuicao/nfe). Grava `distNfeNextAllowedAt` como
 * side-channel — não muda o resultado desta chamada, só deixa rastro pra UI/próxima chamada
 * saberem quando é seguro tentar de novo (ver `distribuicaoCheckpointStatus.ts`):
 * - sucesso: now()+1h (aproximação nossa do intervalo mínimo da SEFAZ);
 * - recusa reconhecida como rate-limit: now()+N minutos, usando o valor que a própria SEFAZ
 *   informou (mais preciso que o nosso cálculo).
 */
export async function solicitarDistribuicaoNfe(
    body: DistribuicaoNfeRequestBody,
    deps: SolicitarDistribuicaoNfeDeps = defaultSolicitarDistribuicaoNfeDeps,
): Promise<Record<string, unknown>> {
    try {
        const result = await deps.acbrFetchJson<Record<string, unknown>>('/distribuicao/nfe', {
            method: 'POST',
            body: JSON.stringify(body),
            scopes: ['empresa', 'nfe', 'distribuicao-nfe'],
            apiEnvironment: ambienteDistribToApiEnv(body.ambiente),
        });
        await recordDistNfeNextAllowedAt(deps, body.cpf_cnpj, body.ambiente, new Date(Date.now() + 60 * 60 * 1000));
        return result;
    } catch (err) {
        if (isDistribuicaoRateLimitError(err)) {
            const minutes = parseRateLimitMinutes(err);
            await recordDistNfeNextAllowedAt(deps, body.cpf_cnpj, body.ambiente, new Date(Date.now() + minutes * 60 * 1000));
        }
        throw err;
    }
}

/**
 * `solicitarDistribuicaoNfe` + persiste o `ultimo_nsu` da resposta como checkpoint — extraído do
 * handler de `POST /distribuicao-nfe/solicitar` (`fiscalDistribuicao.ts`) pra ser reusável pelo
 * bootstrap automático (`ensureDistribuicaoBootstrap.ts`), que precisa da mesma lógica fora do
 * contexto de uma requisição HTTP.
 */
export async function solicitarEPersistirNsu(body: DistribuicaoNfeRequestBody): Promise<Record<string, unknown>> {
    const data = await solicitarDistribuicaoNfe(body);
    const ultimo = (data as { ultimo_nsu?: number }).ultimo_nsu;
    if (typeof ultimo === 'number') {
        await setUltimoNsuStored(body.cpf_cnpj, body.ambiente, String(ultimo));
    }
    return data;
}

export async function listarDocumentosDistribuicao(params: { top?: number; skip?: number } = {}): Promise<Record<string, unknown>> {
    const q = new URLSearchParams();
    if (params.top != null) q.set('$top', String(params.top));
    if (params.skip != null) q.set('$skip', String(params.skip));
    const qs = q.toString();
    return acbrFetchJson<Record<string, unknown>>(`/distribuicao/nfe/documentos${qs ? `?${qs}` : ''}`, {
        method: 'GET',
        scopes: ['empresa', 'nfe', 'distribuicao-nfe'],
    });
}

export async function getDistribuicaoById(id: string): Promise<Record<string, unknown>> {
    return acbrFetchJson<Record<string, unknown>>(`/distribuicao/nfe/${encodeURIComponent(id)}`, {
        method: 'GET',
        scopes: ['empresa', 'nfe', 'distribuicao-nfe'],
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
    const token = await getAcbrAccessToken(['empresa', 'nfe', 'distribuicao-nfe'], apiEnvironment);
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

/**
 * Configura a Distribuição NF-e da empresa na ACBr — pré-requisito obrigatório, separado do
 * cadastro geral (`POST /empresas`): sem isso, QUALQUER chamada a `/distribuicao/nfe/*` falha
 * com `ConfigDistNfeNotFound`. Descoberto ao testar `cons-chave` pela primeira vez contra a API
 * real (nunca tinha sido exercitado antes). Mesmo padrão de `putAcbrEmpresaCteConfig`
 * (`acbrEmpresa.ts`) — idempotente, seguro chamar de novo.
 */
export async function putAcbrEmpresaDistNfeConfig(
    cpfCnpj: string,
    ambiente: 'homologacao' | 'producao',
): Promise<{ ok: boolean; message?: string }> {
    const cnpj = digitsOnly(cpfCnpj);
    try {
        await acbrFetchJson<Record<string, unknown>>(`/empresas/${cnpj}/distnfe`, {
            method: 'PUT',
            body: JSON.stringify({ ambiente }),
            scopes: ['empresa', 'distribuicao-nfe'],
            apiEnvironment: ambienteDistribToApiEnv(ambiente),
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
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
