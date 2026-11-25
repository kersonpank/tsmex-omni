import type { PromotionOutcome, PromotionResult } from './types.js';

/** Relatório da promoção: resumo por etapa (com os motivos de recusa mais comuns) e CSV completo. */
export interface EntitySummary {
    entity: string;
    counts: Record<PromotionResult, number>;
    /** Motivos agrupados (recusa e avisos), do mais frequente para o menos. */
    reasons: Array<{ result: PromotionResult; reason: string; count: number }>;
}

/** Agrupa pelo texto antes de " | " (o que vem depois são valores de cada linha) e sem números. */
function reasonKey(detail: string): string {
    return detail.split(' | ')[0].replace(/\d+/g, 'N').trim();
}

export function summarize(outcomes: PromotionOutcome[]): EntitySummary[] {
    const byEntity = new Map<string, PromotionOutcome[]>();
    for (const o of outcomes) byEntity.set(o.entity, [...(byEntity.get(o.entity) ?? []), o]);
    return [...byEntity.entries()].map(([entity, list]) => {
        const counts: Record<PromotionResult, number> = { created: 0, updated: 0, unchanged: 0, rejected: 0 };
        const reasons = new Map<string, { result: PromotionResult; reason: string; count: number }>();
        for (const o of list) {
            counts[o.result]++;
            if (!o.detail) continue;
            const reason = reasonKey(o.detail);
            const id = `${o.result}|${reason}`;
            const cur = reasons.get(id) ?? { result: o.result, reason, count: 0 };
            cur.count++;
            reasons.set(id, cur);
        }
        return { entity, counts, reasons: [...reasons.values()].sort((a, b) => b.count - a.count) };
    });
}

export function formatSummary(summary: EntitySummary[], topReasons = 6): string {
    const lines: string[] = [];
    for (const s of summary) {
        const c = s.counts;
        lines.push(`${s.entity}: ${c.created} criados, ${c.updated} preenchidos, ${c.unchanged} iguais, ${c.rejected} recusados`);
        for (const r of s.reasons.slice(0, topReasons)) lines.push(`    ${r.count}x [${r.result}] ${r.reason}`);
    }
    return lines.join('\n');
}

const cell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV com `;` (Excel pt-BR). Contém CPF/CNPJ: dado pessoal, fica fora do git. */
export function toCsv(outcomes: PromotionOutcome[]): string {
    const lines = ['entidade;chave_legado;chave;resultado;detalhe'];
    for (const o of outcomes) lines.push([o.entity, o.legacyKey, o.key, o.result, o.detail ?? ''].map(cell).join(';'));
    return `${lines.join('\n')}\n`;
}
