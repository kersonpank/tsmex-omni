import { acbrFetchJson, type AcbrRequestInit } from './acbrHttp.js';
import type { AcbrFiscalEnvironment } from './acbrConfig.js';

/**
 * TODO (Task 3 do plano de Distribuição NF-e — BLOQUEADO, não confirmado ainda):
 * Os nomes de campo abaixo (`chave_nfe`, `tipo_evento`, `cpf_cnpj`, `ambiente`) são a melhor
 * hipótese com base no padrão de outras chamadas ACBr já implementadas no projeto
 * (`DistribuicaoNfeRequestBody` em `acbrDistribuicaoNfe.ts` usa `cpf_cnpj`/`ambiente` em
 * snake_case) — NÃO foram confirmados contra a documentação real (o OpenAPI da ACBr exige
 * autenticação e não há credenciais ACBr configuradas neste ambiente pra testar ao vivo).
 * Antes de habilitar `distribuicaoNfeEnabled` em qualquer FiscalEmitter de produção,
 * confirmar este body contra console.acbr.api.br/Postman e ajustar aqui se divergir.
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
        chave_nfe: digitsOnly(input.chaveAcesso),
        cpf_cnpj: digitsOnly(input.cpfCnpj),
        ambiente: input.ambiente,
        tipo_evento: CIENCIA_DA_OPERACAO_EVENTO,
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
        scopes: ['empresa', 'nfe', 'distribuicao'],
        apiEnvironment: env,
    });
}
