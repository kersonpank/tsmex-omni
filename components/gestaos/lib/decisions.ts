import type { HubExceptionItem } from '../../../types/index';
import { money, plural } from './format';
import type { Mode } from './modes';
import type { Tone } from './trips';

/**
 * Fila do Copilot: o que precisa de uma pessoa, e qual ação o sistema põe à mão.
 * Duas naturezas: exceção (um registro, resolvido ali mesmo) e pilha (vários itens, abre a área).
 */

export type DecisionArea = 'fiscal' | 'operacao' | 'financeiro' | 'comercial' | 'rede';

export const AREA_LABEL: Record<DecisionArea, string> = {
    fiscal: 'Fiscal',
    operacao: 'Operação',
    financeiro: 'Financeiro',
    comercial: 'Comercial',
    rede: 'Rede',
};

export type SystemAction =
    | { type: 'retryFiscalClosure'; manifestId: string; label: string; why: string }
    | { type: 'resumeCteQueue'; label: string; why: string }
    | { type: 'resumeNfeQueue'; label: string; why: string };

export function exceptionArea(category: string): DecisionArea {
    return category.startsWith('FISCAL') ? 'fiscal' : 'operacao';
}

/** A ação de um toque que o sistema propõe para a exceção; `null` = decisão manual. */
export function systemActionFor(item: Pick<HubExceptionItem, 'category' | 'manifestId'>): SystemAction | null {
    if (item.category === 'FISCAL_ENCERRAMENTO_PENDENTE' && item.manifestId) {
        return {
            type: 'retryFiscalClosure',
            manifestId: item.manifestId,
            label: 'Tentar encerrar de novo',
            why: 'As tentativas automáticas se esgotaram. Repetir agora reinicia a contagem e o sistema volta a insistir sozinho.',
        };
    }
    if (item.category === 'FISCAL_PROVIDER_QUOTA') {
        return {
            type: 'resumeCteQueue',
            label: 'Retomar a fila de CT-e',
            why: 'A fila foi pausada porque a cota do emissor acabou. Com a cota regularizada, retomar libera os CT-e parados.',
        };
    }
    if (item.category === 'FISCAL_DISTRIBUICAO_NFE_QUOTA') {
        return {
            type: 'resumeNfeQueue',
            label: 'Retomar a busca de NF-e',
            why: 'A busca de notas na SEFAZ foi pausada por cota. Retomar faz a varredura continuar de onde parou.',
        };
    }
    return null;
}

export function exceptionMode(item: Pick<HubExceptionItem, 'category' | 'manifestId'>): Mode {
    return systemActionFor(item) ? 'copilot' : 'manual';
}

export function exceptionTone(item: Pick<HubExceptionItem, 'overdue' | 'severity'>): Tone {
    if (item.overdue || item.severity === 'CRITICAL') return 'red';
    if (item.severity === 'WARNING') return 'yellow';
    return 'neutral';
}

export interface Pile {
    id: string;
    area: DecisionArea;
    tone: Tone;
    title: string;
    detail: string;
    /** Rota interna da Gestão V2 onde a pilha é resolvida. */
    to: string;
    cta: string;
}

export interface PileInput {
    pendingCarriers?: number | null;
    invoiceable?: { count: number; totalAmount: number; oldestDays: number } | null;
    payables?: Array<{ status: string; dueDate: string; balance: number }> | null;
    quotesPending?: number | null;
}

/** Pilhas de trabalho manual. Só entra o que tem item; nada de cartão vazio. */
export function buildPiles(input: PileInput, now: Date = new Date()): Pile[] {
    const piles: Pile[] = [];

    const open = (input.payables ?? []).filter((p) => p.status === 'PENDING' && p.balance > 0);
    const overdue = open.filter((p) => new Date(p.dueDate).getTime() < now.getTime());
    const soon = open.filter((p) => {
        const due = new Date(p.dueDate).getTime();
        return due >= now.getTime() && due - now.getTime() <= 3 * 86_400_000;
    });
    const sum = (rows: Array<{ balance: number }>) => rows.reduce((total, row) => total + row.balance, 0);
    if (overdue.length) {
        piles.push({
            id: 'payables-overdue',
            area: 'financeiro',
            tone: 'red',
            title: `${plural(overdue.length, 'título vencido', 'títulos vencidos')} de transportador`,
            detail: `${money(sum(overdue))} em aberto`,
            to: '/gestaos/financeiro?aba=pagar',
            cta: 'Abrir títulos',
        });
    }
    if (soon.length) {
        piles.push({
            id: 'payables-soon',
            area: 'financeiro',
            tone: 'yellow',
            title: `${plural(soon.length, 'título vence', 'títulos vencem')} em até 3 dias`,
            detail: `${money(sum(soon))} a pagar`,
            to: '/gestaos/financeiro?aba=pagar',
            cta: 'Abrir títulos',
        });
    }

    const invoiceable = input.invoiceable;
    if (invoiceable && invoiceable.count > 0) {
        piles.push({
            id: 'invoiceable',
            area: 'financeiro',
            tone: invoiceable.oldestDays > 7 ? 'yellow' : 'neutral',
            title: `${plural(invoiceable.count, 'frete emitido', 'fretes emitidos')} sem fatura`,
            detail: `${money(invoiceable.totalAmount)} · o mais antigo há ${plural(invoiceable.oldestDays, 'dia', 'dias')}`,
            to: '/gestaos/financeiro?aba=faturar',
            cta: 'Faturar',
        });
    }

    if (input.pendingCarriers && input.pendingCarriers > 0) {
        piles.push({
            id: 'carriers-pending',
            area: 'rede',
            tone: 'yellow',
            title: `${plural(input.pendingCarriers, 'transportador aguarda', 'transportadores aguardam')} aprovação`,
            detail: 'Sem aprovação não recebem oferta de viagem',
            to: '/gestaos/rede?aba=transportadores',
            cta: 'Analisar',
        });
    }

    if (input.quotesPending && input.quotesPending > 0) {
        piles.push({
            id: 'quotes-pending',
            area: 'comercial',
            tone: 'neutral',
            title: `${plural(input.quotesPending, 'demanda aguarda', 'demandas aguardam')} cotação`,
            detail: 'Cliente esperando preço',
            to: '/gestaos/comercial',
            cta: 'Cotar',
        });
    }

    return piles;
}
