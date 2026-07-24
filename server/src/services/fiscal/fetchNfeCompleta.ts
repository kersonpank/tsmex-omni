import prisma from '../../lib/prisma.js';
import { isAcbrCredentialsConfigured } from '../acbr/acbrConfig.js';
import { solicitarEPersistirNsu, putAcbrEmpresaDistNfeConfig } from '../acbr/acbrDistribuicaoNfe.js';
import { manifestarCienciaOperacao } from '../acbr/acbrManifestacao.js';
import { baixarXmlDocumentoDistribuicao } from '../acbr/acbrDistribuicaoNfe.js';
import { parseDistribuicaoDocumento } from '../acbr/distribuicaoNfeDocumentParser.js';
import { extractDocumentos, extractDocumentoId, extractUltimoNsu } from '../queues/distribuicaoNfeSyncProcessor.js';
import { upsertDiscovered, markManifested, markXmlDownloaded } from './nfeDistribuicaoRepo.js';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import {
    getCargoDataFromDistribuicaoDocument,
    type NfeDistribuicaoDocumentoForCargo,
} from './nfeDistribuicaoCargoData.js';
import { findCargoDataForChave as defaultFindCargoDataForChave } from '../../routes/intakeDemands.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

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
};

function ambienteFromEnvironment(environment: string): 'homologacao' | 'producao' {
    return environment === 'PRODUCAO' ? 'producao' : 'homologacao';
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
 * Nunca lança: qualquer falha na etapa ACBr retorna `null`, e o chamador (`nfe.ts`) cai pro
 * fallback de dados parciais (BrasilAPI).
 */
export async function fetchNfeCompleta(
    hubId: string | null | undefined,
    chave: string,
    deps: FetchNfeCompletaDeps = defaultFetchNfeCompletaDeps,
): Promise<ParsedNfeCargo | null> {
    const cached = await deps.findCargoDataForChave(chave);
    if (cached) return cached;

    if (!hubId || !deps.isAcbrCredentialsConfigured()) return null;

    try {
        const emitter = await deps.findFiscalEmitterByHub(hubId);
        if (!emitter) return null;

        const cpfCnpj = emitter.person.document.replace(/\D/g, '');
        if (cpfCnpj.length !== 14) return null; // Distribuição DFe é só CNPJ

        const ambiente = ambienteFromEnvironment(emitter.environment);

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

        const docs = extractDocumentos(response);
        if (!docs || docs.length === 0) return null;

        const ultimoNsu = extractUltimoNsu(response);
        const raw = docs[0];
        const nsuDoDocumento = typeof raw.nsu === 'string' || typeof raw.nsu === 'number' ? String(raw.nsu) : String(ultimoNsu ?? '0');
        const parsed = parseDistribuicaoDocumento(raw, nsuDoDocumento);
        if (!parsed.accessKey || !parsed.cnpjEmitente) return null;

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
            return await deps.getCargoDataFromDistribuicaoDocument({ tipo: doc.tipo, xmlStorageKey: doc.xmlStorageKey });
        }

        let status = doc.status;
        if (status === 'DISCOVERED') {
            await deps.manifestarCienciaOperacao({ chaveAcesso: parsed.accessKey, cpfCnpj, ambiente });
            await deps.markManifested(doc.id);
            status = 'MANIFESTED';
        }
        if (status !== 'MANIFESTED') return null;

        const documentoId = extractDocumentoId(doc.resumoRaw);
        if (!documentoId) return null;

        const xml = await deps.baixarXmlDocumentoDistribuicao(documentoId, ambiente);
        const uploaded = await deps.uploadBase64Object({
            base64: Buffer.from(xml, 'utf-8').toString('base64'),
            fileName: `${parsed.accessKey}.xml`,
            mimeType: 'application/xml',
            keyPrefix: `nfe-distribuicao/${parsed.accessKey}/xml`,
        });
        await deps.markXmlDownloaded(doc.id, uploaded.storageKey);

        return await deps.getCargoDataFromDistribuicaoDocument({ tipo: parsed.tipo, xmlStorageKey: uploaded.storageKey });
    } catch (err) {
        console.warn(
            `[fetchNfeCompleta] Falha ao buscar NF-e ${chave} via ACBr:`,
            err instanceof Error ? err.message : err,
        );
        return null;
    }
}
