import type { HubExceptionItem } from '../../../types/index';

/** Regras puras da estação Exceções: prazo legível e a ação que resolve cada tipo. */

export function spanLabel(ms: number): string {
    const hours = Math.floor(Math.abs(ms) / 3_600_000);
    if (hours < 1) return 'menos de 1 h';
    if (hours < 48) return `${hours} h`;
    return `${Math.floor(hours / 24)} dias`;
}

export function ageLabel(item: Pick<HubExceptionItem, 'createdAt'>, now: Date = new Date()): string {
    return `aberta há ${spanLabel(now.getTime() - new Date(item.createdAt).getTime())}`;
}

export function dueLabel(item: Pick<HubExceptionItem, 'dueAt' | 'overdue'>, now: Date = new Date()): string {
    if (!item.dueAt) return 'sem prazo';
    const diff = new Date(item.dueAt).getTime() - now.getTime();
    return item.overdue ? `venceu há ${spanLabel(diff)}` : `vence em ${spanLabel(diff)}`;
}

export type ExceptionAction =
    | { kind: 'retryFiscalClosure'; manifestId: string; label: string }
    | { kind: 'link'; to: string; label: string }
    | { kind: 'none' };

export function exceptionAction(item: Pick<HubExceptionItem, 'category' | 'orderId' | 'manifestId'>): ExceptionAction {
    if (item.category === 'FISCAL_ENCERRAMENTO_PENDENTE' && item.manifestId) {
        return { kind: 'retryFiscalClosure', manifestId: item.manifestId, label: 'Tentar encerrar de novo' };
    }
    if (item.orderId) return { kind: 'link', to: `/hubs/pedidos/${item.orderId}`, label: 'Abrir pedido' };
    if (item.manifestId) return { kind: 'link', to: `/hubs/viagens/${item.manifestId}`, label: 'Abrir viagem' };
    return { kind: 'none' };
}

export const MIN_NOTE_LENGTH = 10;

/** "Por que estou vendo isto" e "O que fazer", em uma linha cada, por categoria. */
const EXPLAIN: Record<string, { why: string; what: string; group: string }> = {
    OPERATIONAL_STOCK_AGING: {
        group: 'Carga parada no estoque',
        why: 'A carga está parada no seu estoque há mais dias do que o combinado.',
        what: 'Abra o pedido e monte a viagem, ou registre por que ela segue parada.',
    },
    OPERATIONAL_UNROUTED: {
        group: 'Pedidos sem rota',
        why: 'O pedido está no estoque, mas o sistema não sabe para qual hub ele segue.',
        what: 'Abra o pedido e confira o endereço de entrega; se faltar cobertura, avise a torre.',
    },
    OPERATIONAL_TRIP_LATE: {
        group: 'Viagens atrasadas',
        why: 'A viagem passou da chegada prevista e ainda não foi recebida.',
        what: 'Abra a viagem e confirme com o motorista; se o veículo chegou, registre em Receber.',
    },
    OPERATIONAL_ARRIVAL_DIVERGENCE: {
        group: 'Divergências na chegada',
        why: 'Na conferência da chegada, um pedido veio com avaria ou não chegou.',
        what: 'Abra o pedido, apure com quem despachou e toque em Resolver contando o que foi feito.',
    },
    FISCAL_ENCERRAMENTO_PENDENTE: {
        group: 'Documentos fiscais abertos',
        why: 'A viagem terminou, mas o MDF-e ou o CIOT não foi encerrado na SEFAZ/ANTT.',
        what: 'Toque em Tentar encerrar de novo; se persistir, avise a torre.',
    },
    FISCAL_PROVIDER_ERROR: {
        group: 'Falhas do emissor fiscal',
        why: 'O serviço que emite os documentos fiscais devolveu erro.',
        what: 'Abra o item e tente de novo mais tarde; se repetir, avise a torre.',
    },
};
const FALLBACK = { group: 'Outras pendências', why: 'Algo desta unidade precisa de uma pessoa para seguir.', what: 'Abra o item, resolva e toque em Resolver contando o que foi feito.' };

export function exceptionExplain(category: string) {
    return EXPLAIN[category] ?? FALLBACK;
}

export type ExceptionGroup = { category: string; title: string; items: HubExceptionItem[] };
export const GROUP_MIN = 3;

/** Categorias com ao menos GROUP_MIN cartões viram um grupo; o resto fica avulso. A ordem (prazo) é preservada. */
export function groupExceptions(items: HubExceptionItem[]): Array<{ kind: 'single'; item: HubExceptionItem } | ({ kind: 'group' } & ExceptionGroup)> {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    const out: Array<{ kind: 'single'; item: HubExceptionItem } | ({ kind: 'group' } & ExceptionGroup)> = [];
    const seen = new Map<string, ExceptionGroup>();
    for (const item of items) {
        if ((counts.get(item.category) ?? 0) < GROUP_MIN) {
            out.push({ kind: 'single', item });
            continue;
        }
        let group = seen.get(item.category);
        if (!group) {
            group = { category: item.category, title: exceptionExplain(item.category).group, items: [] };
            seen.set(item.category, group);
            out.push({ kind: 'group', ...group, items: group.items });
        }
        group.items.push(item);
    }
    return out;
}
