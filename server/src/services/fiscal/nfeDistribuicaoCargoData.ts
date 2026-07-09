import type { NfeDistribuicaoDocumentoTipo } from '@prisma/client';
import { getObjectAsBase64 as defaultGetObjectAsBase64 } from '../../lib/objectStorage.js';
import { parseNfeProcXml as defaultParseNfeProcXml, type ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

export interface NfeDistribuicaoDocumentoForCargo {
    tipo: NfeDistribuicaoDocumentoTipo;
    xmlStorageKey: string | null;
}

/**
 * Dependências injetáveis — mesmo padrão de `NfeDistribuicaoRepoDeps`
 * (`server/src/services/fiscal/nfeDistribuicaoRepo.ts`): permite testar sem falar com S3 real.
 */
export interface GetCargoDataDeps {
    getObjectAsBase64: (storageKey: string) => Promise<string>;
    parseNfeProcXml?: (xml: string) => ParsedNfeCargo;
}

export const defaultGetCargoDataDeps: GetCargoDataDeps = {
    getObjectAsBase64: defaultGetObjectAsBase64,
    parseNfeProcXml: defaultParseNfeProcXml,
};

/**
 * Só documentos `NFE_PROC` com XML já baixado (`xmlStorageKey` setado, fase de download da
 * sync já concluída) têm dados de carga extraíveis. Documentos `RESUMO`/`EVENTO` nunca têm o
 * XML completo — retornar `null` é o comportamento esperado, não um erro.
 */
export async function getCargoDataFromDistribuicaoDocument(
    doc: NfeDistribuicaoDocumentoForCargo,
    deps: GetCargoDataDeps = defaultGetCargoDataDeps,
): Promise<ParsedNfeCargo | null> {
    if (doc.tipo !== 'NFE_PROC' || !doc.xmlStorageKey) {
        return null;
    }

    const base64 = await deps.getObjectAsBase64(doc.xmlStorageKey);
    const xml = Buffer.from(base64, 'base64').toString('utf-8');
    const parse = deps.parseNfeProcXml ?? defaultParseNfeProcXml;
    return parse(xml);
}
