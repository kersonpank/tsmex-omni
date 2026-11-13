import { useMemo } from 'react';
import { invoicesApi, payablesApi, type InvoiceableOrder } from '../../../../lib/api';
import { useResource } from '../../lib/resource';
import { isInvoiceOpen, payableTotals, receivableTotals } from '../../lib/financeiro';
import { usePayables } from '../../lib/data';

/** Leituras do Financeiro. Chaves com prefixo `invoices:` e `payables:` para `invalidate`. */

export interface InvoiceItemRow {
    id: string;
    description?: string | null;
    amount: string | number;
    order?: { nfNumber?: string | null } | null;
}

/** Fatura como o servidor devolve (Prisma: valores decimais chegam como texto). */
export interface InvoiceRow {
    id: string;
    invoiceNumber?: string | null;
    accountId: string;
    account?: { id: string; name: string } | null;
    subtotal?: string | number | null;
    total?: string | number | null;
    status: string;
    dueDate?: string | null;
    createdAt?: string | null;
    notes?: string | null;
    items?: InvoiceItemRow[];
}

export function useInvoices() {
    return useResource<InvoiceRow[]>('invoices:list', async () => ((await invoicesApi.list({ limit: 100 })).data ?? []) as InvoiceRow[], { staleMs: 30_000 });
}

const EL_PAGE = 200;

/** Pedidos a faturar. `pages` cresce com "Carregar mais"; cada página traz 200. */
export function useEligibleOrders(pages: number) {
    return useResource<{ items: InvoiceableOrder[]; total: number }>(
        `invoices:eligible:${pages}`,
        async () => {
            const items: InvoiceableOrder[] = [];
            let total = 0;
            for (let page = 0; page < pages; page += 1) {
                const res = await invoicesApi.eligibleOrders({ limit: EL_PAGE, offset: page * EL_PAGE });
                items.push(...res.data);
                total = res.pagination.total;
                if (!res.pagination.hasMore) break;
            }
            return { items, total };
        },
        { staleMs: 30_000 },
    );
}

async function mapLimited<T, R>(list: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(list.length);
    let next = 0;
    const worker = async () => {
        while (next < list.length) {
            const index = next++;
            out[index] = await task(list[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
    return out;
}

/**
 * A lista de faturas não traz o saldo (total menos recebimentos ativos); o saldo vem de
 * `GET /invoices/:id/receipts`. Busca só das faturas abertas, poucas por vez. Fatura cuja
 * leitura falhar fica de fora do mapa e o total mostra "aproximado".
 */
export function useReceivable() {
    const invoices = useInvoices();
    const open = useMemo(() => (invoices.data ?? []).filter((invoice) => isInvoiceOpen(invoice)), [invoices.data]);
    const key = open.length ? `invoices:balances:${open.map((invoice) => invoice.id).join(',')}` : null;
    const balances = useResource<Record<string, number>>(
        key,
        async () => {
            const entries = await mapLimited<InvoiceRow, readonly [string, number] | null>(open, 6, async (invoice) => {
                try {
                    return [invoice.id, (await invoicesApi.receipts(invoice.id)).data.balance] as const;
                } catch {
                    return null;
                }
            });
            return Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => entry != null));
        },
        { staleMs: 30_000 },
    );
    const totals = useMemo(
        () => (invoices.data && (open.length === 0 || balances.data) ? receivableTotals(invoices.data, balances.data ?? {}) : null),
        [invoices.data, balances.data, open.length],
    );
    return { invoices, balances: balances.data, totals };
}

export function usePayableTotals() {
    const payables = usePayables();
    const totals = useMemo(() => (payables.data ? payableTotals(payables.data) : null), [payables.data]);
    return { payables, totals };
}

export type SettlementCandidate = Awaited<ReturnType<typeof payablesApi.settlementCandidates>>['data'][number];

export function useSettlementCandidates() {
    return useResource<SettlementCandidate[]>('payables:candidates', async () => (await payablesApi.settlementCandidates()).data ?? [], { staleMs: 30_000 });
}
