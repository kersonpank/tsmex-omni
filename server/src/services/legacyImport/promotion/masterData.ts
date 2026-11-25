import { importMasterData, type MasterDataKind } from '../importMasterData.js';
import { driverRow, personRow, vehicleRow } from './adapters.js';
import { forEachLegacyBatch } from './source.js';
import type { LegacySourceRow, PromotionContext, PromotionHandler, PromotionOutcome } from './types.js';

/**
 * Pessoas, motoristas e veículos: reaproveita `importMasterData` (identidade por CPF/CNPJ e placa,
 * só preenche lacuna, recusa DV/placa inválidos). Esta etapa só lê o arquivo do legado em lotes e
 * traduz cada linha para o formato que o importador entende.
 */
const BATCH = 1000;

type Adapter = (d: Record<string, unknown>) => Record<string, string>;
type Plan = (ctx: PromotionContext, key: string) => void;
/** No dry-run o proprietário que a etapa de pessoas CRIARIA ainda não existe: o aviso do importador não se aplica. */
const ownerWillExist = (ctx: PromotionContext, row: Record<string, string>, detail?: string) =>
    ctx.dryRun && !!detail?.startsWith('(proprietário ainda não cadastrado') && ctx.plannedPersons.has(row.proprietario_cpf_cnpj ?? '');

function makeHandler(entity: string, kind: MasterDataKind, adapt: Adapter, plan?: Plan): PromotionHandler {
    return async (ctx) => {
        const outcomes: PromotionOutcome[] = [];
        await forEachLegacyBatch(entity, BATCH, async (rows: LegacySourceRow[]) => {
            const adapted = rows.map((r) => adapt(r.data));
            const results = await importMasterData(kind, adapted, { dryRun: ctx.dryRun });
            results.forEach((r, i) => {
                if (ownerWillExist(ctx, adapted[i], r.detail)) r.detail = undefined;
                if (ctx.dryRun && (r.result === 'created' || r.result === 'updated')) plan?.(ctx, r.key);
                outcomes.push({ entity, legacyKey: rows[i].legacyKey, key: r.key, result: r.result, detail: r.detail });
            });
            ctx.log(`${entity}: ${outcomes.length} linhas`);
        });
        return outcomes;
    };
}

export const promotePersons = makeHandler('pessoas', 'persons', personRow, (ctx, key) => ctx.plannedPersons.add(key));
export const promoteDrivers = makeHandler('motoristas', 'drivers', driverRow);
export const promoteVehicles = makeHandler('veiculos', 'vehicles', vehicleRow);
