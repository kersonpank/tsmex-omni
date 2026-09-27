import prisma from '../../lib/prisma.js';
import { isAcbrCredentialsConfigured } from '../acbr/acbrConfig.js';
import { solicitarEPersistirNsu, putAcbrEmpresaDistNfeConfig, isDistribuicaoRateLimitError } from '../acbr/acbrDistribuicaoNfe.js';
import { manifestarCienciaOperacao } from '../acbr/acbrManifestacao.js';
import { baixarXmlDocumentoDistribuicao } from '../acbr/acbrDistribuicaoNfe.js';
import { parseDistribuicaoDocumento } from '../acbr/distribuicaoNfeDocumentParser.js';
import { extractDocumentoId, extractUltimoNsu } from '../queues/distribuicaoNfeSyncProcessor.js';
import { upsertDiscovered, markManifested, markXmlDownloaded } from './nfeDistribuicaoRepo.js';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import {
    getCargoDataFromDistribuicaoDocument,
    type NfeDistribuicaoDocumentoForCargo,
} from './nfeDistribuicaoCargoData.js';
import { getDistribuicaoCheckpointStatus } from './distribuicaoCheckpointStatus.js';
import { findCargoDataForChave as defaultFindCargoDataForChave } from '../../routes/intakeDemands.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';
import { parseNfeProcXml } from '../acbr/nfeXmlParser.js';

/** Motivo pelo qual não foi possível buscar a NF-e completa via Distribuição ACBr agora —
 * `rate_limit` é acionável na UI (mostra quando tentar de novo); `erro` é só best-effort/log. */
export interface DistribuicaoIndisponivel {
    motivo: 'rate_limit' | 'erro';
    nextAllowedAt?: string;
    mensagem: string;
}

export interface FetchNfeCompletaResult {
    cargo: ParsedNfeCargo | null;
    distribuicaoIndisponivel?: DistribuicaoIndisponivel;
}

export interface FetchNfeCompletaDeps {
    findCargoDataForChave: (chave: string) => Promise<ParsedNfeCargo | undefined>;
    isAcbrCredentialsConfigured: typeof isAcbrCredentialsConfigured;
    findFiscalEmitterByHub: (hubId: string) => Promise<{
        id: string;
        environment: string;
        distribuicaoNfeEnabled: boolean;
        person: { document: string };
    } | null>;
    setDistribuicaoNfeEnabled: (fiscalEmitterId: string) => Promise<void>;
    putAcbrEmpresaDistNfeConfig: typeof putAcbrEmpresaDistNfeConfig;
    solicitarEPersistirNsu: typeof solicitarEPersistirNsu;
    manifestarCienciaOperacao: typeof manifestarCienciaOperacao;
    baixarXmlDocumentoDistribuicao: typeof baixarXmlDocumentoDistribuicao;
    uploadBase64Object: typeof uploadBase64Object;
    upsertDiscovered: typeof upsertDiscovered;
    markManifested: typeof markManifested;
    markXmlDownloaded: typeof markXmlDownloaded;
    getCargoDataFromDistribuicaoDocument: (doc: NfeDistribuicaoDocumentoForCargo) => Promise<ParsedNfeCargo | null>;
    getDistribuicaoCheckpointStatus: typeof getDistribuicaoCheckpointStatus;
    parseNfeProcXml: typeof parseNfeProcXml;
}

export const defaultFetchNfeCompletaDeps: FetchNfeCompletaDeps = {
    findCargoDataForChave: defaultFindCargoDataForChave,
    isAcbrCredentialsConfigured,
    findFiscalEmitterByHub: async (hubId: string) =>
        prisma.fiscalEmitter.findFirst({
            where: { hubId },
            select: { id: true, environment: true, distribuicaoNfeEnabled: true, person: { select: { document: true } } },
        }),
    setDistribuicaoNfeEnabled: async (fiscalEmitterId: string) => {
        await prisma.fiscalEmitter.update({ where: { id: fiscalEmitterId }, data: { distribuicaoNfeEnabled: true } });
    },
    putAcbrEmpresaDistNfeConfig,
    solicitarEPersistirNsu,
    manifestarCienciaOperacao,
    baixarXmlDocumentoDistribuicao,
    uploadBase64Object,
    upsertDiscovered,
    markManifested,
    markXmlDownloaded,
    getCargoDataFromDistribuicaoDocument,
    getDistribuicaoCheckpointStatus,
    parseNfeProcXml,
};

function ambienteFromEnvironment(environment: string): 'homologacao' | 'producao' {
    return environment === 'PRODUCAO' ? 'producao' : 'homologacao';
}

/**
 * CONFIRMADO ao vivo contra a API real: `POST /distribuicao/nfe` com `tipo_consulta:
 * 'cons-chave'` embrulha a lista de documentos em `documentos`, não em `data`
 * (`{ documentos: [...], codigo_status, motivo_status, ... }`) — diferente do que `dist-nsu`
 * usa (`extractDocumentos` em `distribuicaoNfeSyncProcessor.ts`, que só aceita `data` de
 * propósito). Aceita `data` como fallback só por segurança, caso a ACBr algum dia unifique.
 */
function extractDocumentosConsChave(payload: Record<string, unknown>): Record<string, unknown>[] | null {
    const documentos = payload.documentos;
    if (Array.isArray(documentos)) return documentos as Record<string, unknown>[];
    const data = payload.data;
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    return null;
}

/**
 * Busca os dados completos (emitente + destinatário + carga) de UMA NF-e específica, na
 * cascata pedida: (1) nossa base, já sincronizada, grátis; (2) ACBr sob demanda — `cons-chave`,
 * síncrono, reusando o MESMO pipeline testado do job em lote (`distribuicaoNfeSyncProcessor.ts`:
 * descobrir → manifestar → baixar XML), então uma consulta futura da mesma chave já cai em (1).
 * Aceitável fazer isso síncrono aqui porque é UM documento, não o backfill em lote que a guarda
 * de NSU=0 protege. Também semeia o checkpoint de NSU e liga `distribuicaoNfeEnabled` como
 * efeito colateral — mesma responsabilidade de `ensureDistribuicaoBootstrap.ts`, só que aqui já
 * persistindo o documento também, não só o checkpoint.
 *
 * Nunca lança: qualquer falha na etapa ACBr retorna `{ cargo: null }` (mais `distribuicaoIndisponivel`
 * quando o motivo é acionável pela UI, ex.: rate-limit), e o chamador (`nfe.ts`) cai pro fallback
 * de dados parciais (BrasilAPI).
 */
export async function fetchNfeCompleta(
    hubId: string | null | undefined,
    chave: string,
    deps: FetchNfeCompletaDeps = defaultFetchNfeCompletaDeps,
): Promise<FetchNfeCompletaResult> {
    const cached = await deps.findCargoDataForChave(chave);
    if (cached) return { cargo: cached };

    if (!hubId || !deps.isAcbrCredentialsConfigured()) return { cargo: null };

    let cpfCnpj: string | null = null;
    let ambiente: 'homologacao' | 'producao' | null = null;

    try {
        const emitter = await deps.findFiscalEmitterByHub(hubId);
        if (!emitter) return { cargo: null };

        cpfCnpj = emitter.person.document.replace(/\D/g, '');
        if (cpfCnpj.length !== 14) return { cargo: null }; // Distribuição DFe é só CNPJ

        ambiente = ambienteFromEnvironment(emitter.environment);

        // Pré-requisito descoberto na prática (ConfigDistNfeNotFound): a empresa precisa dessa
        // configuração ANTES de qualquer chamada a /distribuicao/nfe/* funcionar — separado do
        // cadastro geral (POST /empresas). Idempotente, sem custo (config, não consulta fiscal).
        await deps.putAcbrEmpresaDistNfeConfig(cpfCnpj, ambiente);

        if (!emitter.distribuicaoNfeEnabled) {
            await deps.setDistribuicaoNfeEnabled(emitter.id);
        }

        const response = await deps.solicitarEPersistirNsu({
            cpf_cnpj: cpfCnpj,
            ambiente,
            tipo_consulta: 'cons-chave',
            cons_chave: chave,
        });

        const docs = extractDocumentosConsChave(response);
        if (!docs || docs.length === 0) {
            const motivo = (response as { motivo_status?: string }).motivo_status;
            if (motivo) {
                console.warn(`[fetchNfeCompleta] SEFAZ não retornou documento pra ${chave} (${ambiente}): ${motivo}`);
            }
            return { cargo: null };
        }

        const ultimoNsu = extractUltimoNsu(response);
        const raw = docs[0];
        const nsuDoDocumento = typeof raw.nsu === 'string' || typeof raw.nsu === 'number' ? String(raw.nsu) : String(ultimoNsu ?? '0');
        const parsed = parseDistribuicaoDocumento(raw, nsuDoDocumento);
        if (!parsed.accessKey || !parsed.cnpjEmitente) return { cargo: null };

        const doc = await deps.upsertDiscovered({
            nsu: parsed.nsu,
            accessKey: parsed.accessKey,
            tipo: parsed.tipo,
            cnpjEmitente: parsed.cnpjEmitente,
            ambiente,
            fiscalEmitterId: emitter.id,
            resumoRaw: parsed.raw,
        });

        if (doc.xmlStorageKey) {
            const cargo = await deps.getCargoDataFromDistribuicaoDocument({ tipo: doc.tipo, xmlStorageKey: doc.xmlStorageKey });
            return { cargo };
        }

        let status = doc.status;
        if (status === 'DISCOVERED') {
            // tipo NFE_PROC (resumo: false) = SEFAZ já liberou o documento completo pra este
            // CNPJ — pular Ciência da Operação (ato exclusivo do destinatário legal). Mesma
            // lógica de `distribuicaoNfeSyncProcessor.ts` (`runManifestacaoEDownloadPhases`).
            if (parsed.tipo !== 'NFE_PROC') {
                await deps.manifestarCienciaOperacao({ chaveAcesso: parsed.accessKey, cpfCnpj, ambiente });
            }
            await deps.markManifested(doc.id);
            status = 'MANIFESTED';
        }
        if (status !== 'MANIFESTED') return { cargo: null };

        const documentoId = extractDocumentoId(doc.resumoRaw);
        if (!documentoId) return { cargo: null };

        const xml = await deps.baixarXmlDocumentoDistribuicao(documentoId, ambiente);
        const parsedXml = deps.parseNfeProcXml(xml);
        if (parsedXml.chave.replace(/\D/g, '') !== parsed.accessKey.replace(/\D/g, '')) return { cargo: null };
        const uploaded = await deps.uploadBase64Object({
            base64: Buffer.from(xml, 'utf-8').toString('base64'),
            fileName: `${parsed.accessKey}.xml`,
            mimeType: 'application/xml',
            keyPrefix: `nfe-distribuicao/${parsed.accessKey}/xml`,
            storageKey: `nfe-distribuicao/${parsed.accessKey}/xml/${parsed.accessKey}.xml`,
        });
        await deps.markXmlDownloaded(doc.id, uploaded.storageKey, undefined, { checksum: uploaded.checksum, size: uploaded.size });

        const cargo = await deps.getCargoDataFromDistribuicaoDocument({ tipo: parsed.tipo, xmlStorageKey: uploaded.storageKey });
        return { cargo };
    } catch (err) {
        console.warn(
            `[fetchNfeCompleta] Falha ao buscar NF-e ${chave} via ACBr:`,
            err instanceof Error ? err.message : err,
        );
        if (isDistribuicaoRateLimitError(err) && cpfCnpj && ambiente) {
            // O cooldown já foi gravado por `solicitarDistribuicaoNfe` (side-channel) — só
            // relemos o checkpoint pra saber o `nextAllowedAt` autoritativo, sem recalcular.
            try {
                const status = await deps.getDistribuicaoCheckpointStatus(cpfCnpj, ambiente);
                return {
                    cargo: null,
                    distribuicaoIndisponivel: {
                        motivo: 'rate_limit',
                        nextAllowedAt: status.nextAllowedAt ?? undefined,
                        mensagem: 'A SEFAZ permite só 1 consulta de Distribuição por hora para este CNPJ.',
                    },
                };
            } catch {
                return {
                    cargo: null,
                    distribuicaoIndisponivel: {
                        motivo: 'rate_limit',
                        mensagem: 'A SEFAZ permite só 1 consulta de Distribuição por hora para este CNPJ.',
                    },
                };
            }
        }
        return { cargo: null };
    }
}
