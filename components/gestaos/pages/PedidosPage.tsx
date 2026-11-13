import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ordersApi } from '../../../lib/api';
import type { OrderAggregateSummary, OrderListItem } from '../../../types/index';
import { num, money } from '../lib/format';
import { orderFilterParams, ORDER_FILTERS, pageRange, PAGE_SIZE, type OrderFilter } from '../lib/pedidos';
import { useResource } from '../lib/resource';
import { IconSearch } from '../ui/icons';
import { Button, Chip, EmptyState, Loadable, PageHeader, Panel, Skeleton, Stat, TextInput } from '../ui/kit';
import { OrderDrawer } from './pedidos/OrderDrawer';
import { OrderTable } from './pedidos/OrderTable';

interface OrderPage {
    rows: OrderListItem[];
    total: number;
}

/** Pedidos: onde está a carga, e o que falta para ela seguir. */
const PedidosPage: React.FC = () => {
    const [params, setParams] = useSearchParams();
    const urlQuery = params.get('q') ?? '';
    const openId = params.get('p');
    const [draft, setDraft] = useState(urlQuery);
    const [query, setQuery] = useState(urlQuery.trim());
    const [filter, setFilter] = useState<OrderFilter>('all');
    const [offset, setOffset] = useState(0);

    const patchUrl = useCallback(
        (changes: Record<string, string | null>) =>
            setParams(
                (current) => {
                    const next = new URLSearchParams(current);
                    for (const [key, value] of Object.entries(changes)) {
                        if (value) next.set(key, value);
                        else next.delete(key);
                    }
                    return next;
                },
                { replace: true },
            ),
        [setParams],
    );

    // Busca vinda de fora (Ctrl K, link) entra no campo e na consulta.
    useEffect(() => {
        setDraft(urlQuery);
        setQuery(urlQuery.trim());
        setOffset(0);
    }, [urlQuery]);

    // Digitação: espera ~350 ms, vai para a URL e volta para a primeira página.
    useEffect(() => {
        if (draft.trim() === query) return;
        const timer = window.setTimeout(() => {
            setQuery(draft.trim());
            setOffset(0);
            patchUrl({ q: draft.trim() || null });
        }, 350);
        return () => window.clearTimeout(timer);
    }, [draft, query, patchUrl]);

    const filters = useMemo(() => orderFilterParams(query, filter), [query, filter]);
    const filterKey = JSON.stringify(filters);

    const list = useResource<OrderPage>(
        `orders:list:${JSON.stringify({ ...filters, limit: PAGE_SIZE, offset })}`,
        async () => {
            const res = await ordersApi.list({ ...filters, limit: PAGE_SIZE, offset, sortBy: 'updatedAt', sortDir: 'desc' });
            const rows = Array.isArray(res?.data) ? res.data : [];
            return { rows, total: res?.pagination?.total ?? rows.length };
        },
        { staleMs: 15_000 },
    );
    const totals = useResource<OrderAggregateSummary>(`orders:aggregate:${filterKey}`, async () => (await ordersApi.aggregate(filters)).data, { staleMs: 30_000 });

    const rows = list.data?.rows ?? [];
    const total = list.data?.total ?? 0;
    const row = openId ? rows.find((order) => order.id === openId) ?? null : null;

    const chooseFilter = (next: OrderFilter) => {
        setFilter(next);
        setOffset(0);
    };

    return (
        <>
            <PageHeader title="Pedidos" question="Onde está a carga, e o que falta para ela seguir?" />

            <div className="gx-rise mb-5 flex flex-col gap-3">
                <div className="relative">
                    <IconSearch size={18} className="gx-muted pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                    <TextInput
                        type="search"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Buscar por número do pedido, NF, cliente, origem ou destino"
                        aria-label="Buscar pedido"
                        className="!h-12 !pl-11 !text-[16px]"
                    />
                </div>
                <div className="gx-no-scrollbar flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por situação">
                    {ORDER_FILTERS.map((item) => (
                        <Chip key={item.id} active={filter === item.id} onClick={() => chooseFilter(item.id)}>
                            {item.label}
                        </Chip>
                    ))}
                </div>
            </div>

            <Panel className="gx-rise mb-5">
                <Loadable state={totals} skeleton={<Skeleton rows={1} height={56} />}>
                    {(sum) => (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
                            <Stat label="Pedidos" value={num(sum.totalOrders)} />
                            <Stat label="Peso" value={`${num(sum.totalWeightKg)} kg`} />
                            <Stat label="Volume" value={`${Number(sum.totalVolumeM3 ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³`} />
                            <Stat label="Valor das notas" value={money(sum.totalValueBRL)} />
                        </div>
                    )}
                </Loadable>
            </Panel>

            <Panel padded={false} className="gx-rise">
                <Loadable
                    state={list}
                    skeleton={<Skeleton rows={8} height={48} className="px-5 py-4" />}
                    isEmpty={(page) => page.rows.length === 0}
                    empty={
                        <div className="px-5 py-4">
                            <EmptyState
                                title="Nenhum pedido encontrado"
                                hint={query || filter !== 'all' ? 'Mude a situação ou limpe a busca para ver os outros pedidos.' : 'Os pedidos aparecem aqui assim que forem criados.'}
                            />
                        </div>
                    }
                >
                    {() => <OrderTable orders={rows} selectedId={openId} onOpen={(id) => patchUrl({ p: id })} />}
                </Loadable>
                {list.data && total > 0 ? (
                    <div className="gx-hair-t flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <span className="gx-muted text-[13.5px]">{pageRange(offset, rows.length, total)}</span>
                        <div className="flex gap-2">
                            <Button size="sm" variant="soft" disabled={offset === 0 || list.refreshing} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                                Anterior
                            </Button>
                            <Button size="sm" variant="soft" disabled={offset + PAGE_SIZE >= total || list.refreshing} onClick={() => setOffset(offset + PAGE_SIZE)}>
                                Próxima
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Panel>

            <OrderDrawer orderId={openId} row={row} onClose={() => patchUrl({ p: null })} />
        </>
    );
};

export default PedidosPage;
