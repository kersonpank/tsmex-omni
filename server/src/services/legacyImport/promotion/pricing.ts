import type { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { resolveLegacyDocument } from './documents.js';
import { mapLegacyPricing, type MappedPricing } from './pricingMap.js';
import { chunk, loadLegacyRows, text } from './source.js';
import type { LegacySourceRow, PromotionContext, PromotionHandler, PromotionOutcome } from './types.js';

/**
 * Rotas e tabelas de preço do legado → PricingRoute + PricingTable.
 * - `rotas` → PricingRoute (identidade pelo nome da rota, sem acento/caixa; rota que já existe não muda);
 * - `tarifas` → PricingTable GENERAL (tabela geral por divisão/rota);
 * - `tabelas_clientes` → PricingTable SPECIAL ligada à Account do CNPJ/CPF do cliente.
 * A PricingTable não tem campo de origem nem chave natural: o `code` leva `legado:<tipo>:<chave do
 * legado>` (a mesma chave do LegacyRecord), e é por ele que a promoção reconhece a tabela já criada.
 * Tabela que já existe nunca é alterada — o TSM é a fonte depois do corte.
 */
const plain = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

interface LegacyRoute { name: string; originCode: string; originName: string; destCode: string; destName: string }

function routeFromName(name: string): LegacyRoute {
    const [left, right] = name.split(/\s*(?:->|>)\s*/);
    return { name, originCode: (left ?? name).trim(), originName: (left ?? name).trim(), destCode: (right ?? name).trim(), destName: (right ?? name).trim() };
}

function routeFromRow(d: Record<string, unknown>): LegacyRoute | null {
    const name = text(d, 'rota');
    if (!name) return null;
    const origin = text(d, 'origem');
    const dest = text(d, 'destino');
    return { name, originCode: origin || name, originName: text(d, 'origemx') || origin || name, destCode: dest || name, destName: text(d, 'destinox') || dest || name };
}

/** Resolve rota por código do legado ou por nome; cria a PricingRoute que ainda não existe. */
class RouteResolver {
    private byCode = new Map<string, LegacyRoute>();
    private byName = new Map<string, LegacyRoute>();
    private ids = new Map<string, string>();
    created = 0;
    constructor(private ctx: PromotionContext) {}

    async init() {
        for (const r of await loadLegacyRows('rotas')) {
            const route = routeFromRow(r.data);
            if (!route) continue;
            this.byCode.set(text(r.data, 'codigo'), route);
            this.byName.set(plain(route.name), route);
        }
        for (const r of await prisma.pricingRoute.findMany({ select: { id: true, name: true } })) this.ids.set(plain(r.name), r.id);
        return this;
    }

    async ensure(route: LegacyRoute): Promise<{ id: string; created: boolean }> {
        const key = plain(route.name);
        const known = this.ids.get(key);
        if (known) return { id: known, created: false };
        const id = this.ctx.dryRun ? `dry:${key}` : (await prisma.pricingRoute.create({ data: route, select: { id: true } })).id;
        this.ids.set(key, id);
        this.created++;
        return { id, created: true };
    }

    /** `code` = código da rota no legado; `name` = nome/descrição quando o código não está em `rotas`. */
    async resolve(code: string, name: string): Promise<{ id: string | null; note?: string }> {
        const legacy = code && code !== '0' ? this.byCode.get(code) : undefined;
        const route = legacy ?? (name ? this.byName.get(plain(name)) ?? routeFromName(name) : null);
        if (!route) return { id: null, note: code && code !== '0' ? `rota ${code} sem nome no legado: tabela criada sem rota` : undefined };
        return { id: (await this.ensure(route)).id };
    }
}

export const promoteRoutes: PromotionHandler = async (ctx) => {
    const resolver = await new RouteResolver(ctx).init();
    const outcomes: PromotionOutcome[] = [];
    for (const r of await loadLegacyRows('rotas')) {
        const route = routeFromRow(r.data);
        if (!route) { outcomes.push({ entity: 'rotas', legacyKey: r.legacyKey, key: '', result: 'rejected', detail: 'rota sem nome' }); continue; }
        const { created } = await resolver.ensure(route);
        outcomes.push({ entity: 'rotas', legacyKey: r.legacyKey, key: route.name, result: created ? 'created' : 'unchanged' });
    }
    return outcomes;
};

interface TableItem {
    row: LegacySourceRow;
    code: string;
    type: 'GENERAL' | 'SPECIAL';
    document?: string;
    routeCode: string;
    routeName: string;
}

const detailOf = (m: MappedPricing, extra?: string) => [
    m.review.length ? `inativa, revisar: ${m.review.join(', ')}` : !m.active ? 'inativa (não liberada no legado)' : '',
    extra ?? '',
    m.unmapped.length ? `| sem equivalente: ${m.unmapped.join('; ')}` : '',
].filter(Boolean).join(' ') || undefined;

async function promoteTables(ctx: PromotionContext, entity: string, items: TableItem[]): Promise<PromotionOutcome[]> {
    const outcomes: PromotionOutcome[] = [];
    const resolver = await new RouteResolver(ctx).init();
    for (const batch of chunk(items, 200)) {
        const codes = batch.map((i) => i.code);
        const existing = new Set((await prisma.pricingTable.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((t) => t.code));
        const docs = [...new Set(batch.flatMap((i) => (i.document ? [i.document] : [])))];
        const accounts = new Map((await prisma.accountCompany.findMany({ where: { cnpj: { in: docs } }, select: { cnpj: true, accountId: true } })).map((c) => [c.cnpj, c.accountId]));
        const data: Prisma.PricingTableCreateManyInput[] = [];

        for (const item of batch) {
            const { row } = item;
            const out = (result: PromotionOutcome['result'], detail?: string) => outcomes.push({ entity, legacyKey: row.legacyKey, key: item.code, result, detail });
            if (existing.has(item.code)) { out('unchanged'); continue; }
            let accountId: string | null = null;
            if (item.type === 'SPECIAL') {
                accountId = (item.document && accounts.get(item.document)) || null;
                if (!accountId && !(ctx.dryRun && item.document && ctx.plannedAccounts.has(item.document))) { out('rejected', item.document ? 'cliente da tabela sem conta no TSM (promova clientes antes)' : 'CPF/CNPJ do cliente da tabela inválido'); continue; }
            }
            const mapped = mapLegacyPricing(row.data);
            if (!mapped.ok) { out('rejected', mapped.reason); continue; }
            const route = await resolver.resolve(item.routeCode, item.routeName);
            const m = mapped.value;
            data.push({
                description: m.description, code: item.code, type: item.type, accountId, routeId: ctx.dryRun ? null : route.id,
                freightValue: m.freightValue, freightUnit: m.freightUnit, minFreightValue: m.minFreightValue, minFreightUnit: m.minFreightUnit,
                adValoremPercent: m.adValoremPercent, grisPercent: m.grisPercent, tollValue: m.tollValue, tollUnit: m.tollUnit,
                dispatchFee: m.dispatchFee, otherFees: m.otherFees, cubeEnabled: m.cubeEnabled, cubeFactor: m.cubeFactor,
                icmsIncluded: m.icmsIncluded, active: m.active,
            });
            out('created', detailOf(m, route.note));
        }
        if (!ctx.dryRun && data.length) await prisma.pricingTable.createMany({ data });
        ctx.log(`${entity}: ${outcomes.length}/${items.length}`);
    }
    return outcomes;
}

export const promoteGeneralTables: PromotionHandler = async (ctx) => {
    const rows = await loadLegacyRows('tarifas');
    return promoteTables(ctx, 'tarifas', rows.map((row) => ({
        row, code: `legado:tarifas:${row.legacyKey}`, type: 'GENERAL' as const,
        routeCode: text(row.data, 'rota'), routeName: text(row.data, 'rotadescr'),
    })));
};

export const promoteClientTables: PromotionHandler = async (ctx) => {
    const rows = await loadLegacyRows('tabelas_clientes');
    return promoteTables(ctx, 'tabelas_clientes', rows.map((row) => ({
        row, code: `legado:tabelas_clientes:${row.legacyKey}`, type: 'SPECIAL' as const,
        document: resolveLegacyDocument(row.data.cnpj_cpf)?.document,
        routeCode: '', routeName: text(row.data, 'rota'),
    })));
};
