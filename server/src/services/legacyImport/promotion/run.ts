import { promoteClients } from './accounts.js';
import { promoteQuoteContacts, promoteSellerEmails } from './contacts.js';
import { promoteDrivers, promotePersons, promoteVehicles } from './masterData.js';
import { promoteClientTables, promoteGeneralTables, promoteRoutes } from './pricing.js';
import { newContext, type PromotionHandler, type PromotionOutcome } from './types.js';

/**
 * Orquestra a promoção do arquivo do legado. A ordem importa: pessoas antes de clientes, veículos e
 * contatos (dependem da Person); clientes antes das tabelas por cliente (dependem da Account).
 */
export interface PromotionStep {
    name: string;
    /** Listagem do legado (LegacyRecord.entity) de onde a etapa lê. */
    source: string;
    run: PromotionHandler;
}

export const PROMOTION_STEPS: PromotionStep[] = [
    { name: 'pessoas', source: 'pessoas', run: promotePersons },
    { name: 'clientes', source: 'clientes', run: promoteClients },
    { name: 'motoristas', source: 'motoristas', run: promoteDrivers },
    { name: 'veiculos', source: 'veiculos', run: promoteVehicles },
    { name: 'rotas', source: 'rotas', run: promoteRoutes },
    { name: 'tarifas', source: 'tarifas', run: promoteGeneralTables },
    { name: 'tabelas_clientes', source: 'tabelas_clientes', run: promoteClientTables },
    { name: 'contatos', source: 'cotacoes', run: promoteQuoteContacts },
    { name: 'vendedores', source: 'vendedores', run: promoteSellerEmails },
];

/** Listagens do legado sem modelo equivalente no TSM: nunca promovidas, só relatadas. */
export const NOT_PROMOTED: Record<string, string> = {
    agentes: 'são as contas de cobrança/boleto da empresa (banco, convênio, carteira), não conta bancária de pessoa: sem modelo equivalente',
    empresas: 'emitentes fiscais exigem certificado e ambiente: cadastro manual no TSM (Emitente fiscal)',
};

export function selectSteps(only?: string[]): PromotionStep[] {
    if (!only?.length) return PROMOTION_STEPS;
    const known = new Set(PROMOTION_STEPS.map((s) => s.name));
    const unknown = only.filter((n) => !known.has(n) && !NOT_PROMOTED[n]);
    if (unknown.length) throw new Error(`Etapa(s) desconhecida(s): ${unknown.join(', ')}. Válidas: ${[...known].join(', ')}.`);
    return PROMOTION_STEPS.filter((s) => only.includes(s.name));
}

export async function promoteLegacyArchive(options: { dryRun: boolean; only?: string[]; log?: (m: string) => void }): Promise<{ outcomes: PromotionOutcome[]; skipped: Array<{ entity: string; reason: string }> }> {
    const ctx = newContext(options);
    const outcomes: PromotionOutcome[] = [];
    for (const step of selectSteps(options.only)) {
        ctx.log(`▶ ${step.name}${options.dryRun ? ' (simulação)' : ''}`);
        outcomes.push(...(await step.run(ctx)));
    }
    const skipped = Object.entries(NOT_PROMOTED)
        .filter(([entity]) => !options.only?.length || options.only.includes(entity))
        .map(([entity, reason]) => ({ entity, reason }));
    return { outcomes, skipped };
}
