/**
 * Tipos da promoção do arquivo do legado (LegacyRecord) para entidades reais do TSM.
 * A promoção é idempotente: identidade pela chave natural (CNPJ/CPF, placa), só preenche lacunas
 * e nunca sobrescreve campo já preenchido no TSM.
 */
export type PromotionResult = 'created' | 'updated' | 'unchanged' | 'rejected';

/** Um item promovido (ou recusado) — uma linha do relatório. */
export interface PromotionOutcome {
    /** Nome da etapa (pessoas, clientes, tarifas…). */
    entity: string;
    /** Chave da linha no arquivo do legado (LegacyRecord.legacyKey). */
    legacyKey: string;
    /** Chave natural no TSM (CNPJ/CPF, placa, código da tabela…). */
    key: string;
    result: PromotionResult;
    detail?: string;
}

/** Linha do arquivo do legado, como a promoção a lê. */
export interface LegacySourceRow {
    id: string;
    legacyKey: string;
    data: Record<string, unknown>;
}

/**
 * Contexto compartilhado entre as etapas. No dry-run nada é gravado; os conjuntos `planned*` guardam
 * o que as etapas anteriores CRIARIAM, para a etapa seguinte não recusar a linha por dependência.
 */
export interface PromotionContext {
    dryRun: boolean;
    plannedPersons: Set<string>;
    plannedAccounts: Set<string>;
    log: (message: string) => void;
}

export type PromotionHandler = (ctx: PromotionContext) => Promise<PromotionOutcome[]>;

export function newContext(options: { dryRun: boolean; log?: (m: string) => void }): PromotionContext {
    return { dryRun: options.dryRun, plannedPersons: new Set(), plannedAccounts: new Set(), log: options.log ?? (() => undefined) };
}
