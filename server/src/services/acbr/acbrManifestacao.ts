import { acbrFetchJson, type AcbrRequestInit } from './acbrHttp.js';
import type { AcbrFiscalEnvironment } from './acbrConfig.js';

/**
 * Schema de `POST /distribuicao/nfe/manifestacoes` (objeto `DistribuicaoNfePedidoManifestacao`
 * da ACBr) — CONFIRMADO pelo usuário em 2026-07-08 (bloqueio da Task 3 resolvido; o OpenAPI da
 * ACBr exige autenticação e este ambiente não tinha credenciais pra validar ao vivo):
 *   { cpf_cnpj, ambiente, chNFe, tpEvento, xJust? }
 * - `chNFe`: chave de acesso de 44 dígitos, só números.
 * - `tpEvento`: código SEFAZ como string — `210210` para Ciência da Operação. Nunca usar um
 *   enum tipo "CIENCIA"; a API espera exatamente o código.
 * - `xJust`: OMITIR por completo para 210210. Só é exigido pela SEFAZ para eventos como
 *   Desconhecimento (210220) ou Operação não Realizada (210240) — não implementados aqui.
 * Custo: 1 crédito ACBr por chamada. Chamador é responsável por já ter checado no banco que o
 * documento está `DISCOVERED` (não `MANIFESTED`) antes de invocar isto — nunca manifestar a
 * mesma `chNFe` duas vezes (ver `distribuicaoNfeSyncProcessor.ts`, que só chama esta função
 * quando `status === 'DISCOVERED'`, e `markManifested`, que é compare-and-swap).
 */
export const CIENCIA_DA_OPERACAO_EVENTO = '210210';

export interface ManifestacaoInput {
    chaveAcesso: string;
    cpfCnpj: string;
    ambiente: 'homologacao' | 'producao';
}

export interface AcbrManifestacaoDeps {
    acbrFetchJson: (path: string, init: AcbrRequestInit) => Promise<Record<string, unknown>>;
}

const defaultDeps: AcbrManifestacaoDeps = { acbrFetchJson };

function digitsOnly(s: string): string {
    return s.replace(/\D/g, '');
}

export function buildManifestacaoBody(input: ManifestacaoInput): Record<string, unknown> {
    return {
        cpf_cnpj: digitsOnly(input.cpfCnpj),
        ambiente: input.ambiente,
        chNFe: digitsOnly(input.chaveAcesso),
        tpEvento: CIENCIA_DA_OPERACAO_EVENTO,
        // xJust omitido de propósito — não exigido/aceito pra 210210 (Ciência da Operação).
    };
}

/** Envia a Ciência da Operação (evento 210210) para uma NF-e descoberta via Distribuição. */
export async function manifestarCienciaOperacao(
    input: ManifestacaoInput,
    deps: AcbrManifestacaoDeps = defaultDeps,
): Promise<Record<string, unknown>> {
    const env: AcbrFiscalEnvironment = input.ambiente === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO';
    return deps.acbrFetchJson('/distribuicao/nfe/manifestacoes', {
        method: 'POST',
        body: JSON.stringify(buildManifestacaoBody(input)),
        scopes: ['empresa', 'nfe', 'distribuicao-nfe'],
        apiEnvironment: env,
    });
}
