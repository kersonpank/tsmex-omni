import React, { useMemo, useState } from 'react';
import { pricingApi } from '../../../../lib/api';
import type { PricingRoute, PricingTable } from '../../../../types/index';
import { filterTables, freightSummary, TABLE_TYPE_LABEL } from '../../lib/comercialForms';
import { invalidate, useResource } from '../../lib/resource';
import { ConfirmButton, SearchInput } from '../../ui/form';
import { Button, Chip, EmptyState, Loadable, Panel, Pill, Skeleton } from '../../ui/kit';
import { useAction } from '../../ui/overlay';
import { PricingTableDrawer } from './PricingTableDrawer';
import { RouteDrawer } from './RouteDrawer';

type TableRow = PricingTable & { client?: { companyName: string } | null; route?: PricingRoute | null; _count?: unknown };
type RouteRow = PricingRoute & { _count?: { tables: number } };

const TablesPanel: React.FC = () => {
    const [type, setType] = useState('');
    const [routeId, setRouteId] = useState('');
    const [query, setQuery] = useState('');
    const [activeOnly, setActiveOnly] = useState(true);
    const [editing, setEditing] = useState<TableRow | null>(null);
    const [creating, setCreating] = useState(false);
    const { busy, run } = useAction();

    const routes = useResource<PricingRoute[]>('pricing:routes:active', async () => (await pricingApi.listRoutes({ includeInactive: false })).data ?? [], { staleMs: 60_000 });
    const state = useResource<TableRow[]>(`pricing:tables:${type}:${routeId}`, async () => ((await pricingApi.listTables({ ...(type ? { type } : {}), ...(routeId ? { routeId } : {}) })).data ?? []) as TableRow[], { staleMs: 30_000 });
    const rows = useMemo(() => filterTables(state.data ?? [], query, activeOnly), [state.data, query, activeOnly]);

    const toggleActive = async (table: TableRow) => {
        const ok = await run(`active:${table.id}`, () => pricingApi.updateTable(table.id, { active: !table.active }), {
            success: table.active ? 'Tabela desativada.' : 'Tabela ativada.',
            error: 'Não foi possível mudar a situação da tabela.',
        });
        if (ok) invalidate('pricing:');
        return ok;
    };

    return (
        <Panel
            title="Tabelas de preço"
            hint="A tabela geral vale para todos; a especial vale só para o cliente escolhido."
            mode="manual"
            padded={false}
            actions={
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                    Nova tabela
                </Button>
            }
        >
            <div className="flex flex-col gap-3 px-5 pb-3">
                <SearchInput value={query} onChange={setQuery} placeholder="Buscar tabela pela descrição" aria-label="Buscar tabelas" />
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar tabelas">
                    <Chip active={type === ''} onClick={() => setType('')}>
                        Todas
                    </Chip>
                    <Chip active={type === 'GENERAL'} onClick={() => setType('GENERAL')}>
                        Gerais
                    </Chip>
                    <Chip active={type === 'SPECIAL'} onClick={() => setType('SPECIAL')}>
                        Especiais
                    </Chip>
                    <Chip active={activeOnly} onClick={() => setActiveOnly((current) => !current)}>
                        Só ativas
                    </Chip>
                    <select className="gx-input w-auto min-w-[180px]" aria-label="Filtrar por rota" value={routeId} onChange={(event) => setRouteId(event.target.value)}>
                        <option value="">Todas as rotas</option>
                        {(routes.data ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                                {r.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <Loadable state={state} skeleton={<Skeleton className="px-5" rows={4} height={60} />}>
                {() =>
                    rows.length === 0 ? (
                        <div className="px-5 pb-3">
                            <EmptyState title="Nenhuma tabela com esse filtro." hint="Crie uma tabela nova ou mude o filtro." />
                        </div>
                    ) : (
                        <ul>
                            {rows.map((table) => (
                                <li key={table.id} className="gx-hair-b flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 last:border-b-0">
                                    <div className="min-w-0 flex-1 basis-64">
                                        <p className="truncate font-semibold">{table.description}</p>
                                        <p className="gx-soft truncate text-[13.5px]">
                                            {table.route?.name ?? 'Todas as rotas'}
                                            {table.client?.companyName ? ` · ${table.client.companyName}` : ''}
                                        </p>
                                        <p className="gx-muted text-[12.5px]">{freightSummary(table)}</p>
                                    </div>
                                    <div className="flex flex-none flex-wrap items-center gap-2">
                                        <Pill tone={table.type === 'SPECIAL' ? 'royal' : 'neutral'}>{TABLE_TYPE_LABEL[table.type]}</Pill>
                                        <Pill tone={table.active ? 'neutral' : 'yellow'}>{table.active ? 'Ativa' : 'Inativa'}</Pill>
                                        <Button size="sm" variant="soft" onClick={() => setEditing(table)} aria-label={`Editar ${table.description}`}>
                                            Editar
                                        </Button>
                                        {table.active ? (
                                            <ConfirmButton label="Desativar" confirmLabel="Desativar?" variant="ghost" onConfirm={async () => toggleActive(table)} disabled={busy === `active:${table.id}`} />
                                        ) : (
                                            <Button size="sm" variant="ghost" loading={busy === `active:${table.id}`} onClick={() => void toggleActive(table)}>
                                                Ativar
                                            </Button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )
                }
            </Loadable>
            <PricingTableDrawer open={creating || Boolean(editing)} table={creating ? null : editing} onClose={() => (creating ? setCreating(false) : setEditing(null))} />
        </Panel>
    );
};

const RoutesPanel: React.FC = () => {
    const [editing, setEditing] = useState<RouteRow | null>(null);
    const [creating, setCreating] = useState(false);
    const [showInactive, setShowInactive] = useState(false);
    const { run } = useAction();
    const state = useResource<RouteRow[]>(`pricing:routes:${showInactive ? 'all' : 'active'}`, async () => ((await pricingApi.listRoutes({ includeInactive: showInactive })).data ?? []) as RouteRow[], { staleMs: 30_000 });

    const remove = async (route: RouteRow) => {
        const ok = await run(`delete:${route.id}`, () => pricingApi.deleteRoute(route.id), { success: 'Rota desativada.', error: 'Não foi possível desativar a rota.' });
        if (ok) invalidate('pricing:');
        return ok;
    };

    return (
        <Panel
            title="Rotas de preço"
            hint="Trechos de origem e destino que as tabelas usam."
            mode="manual"
            padded={false}
            actions={
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                    Nova rota
                </Button>
            }
        >
            <div className="flex flex-wrap gap-2 px-5 pb-3">
                <Chip active={showInactive} onClick={() => setShowInactive((current) => !current)}>
                    Mostrar inativas
                </Chip>
            </div>
            <Loadable state={state} skeleton={<Skeleton className="px-5" rows={3} height={56} />} isEmpty={(data) => data.length === 0} empty={<div className="px-5 pb-3"><EmptyState title="Nenhuma rota cadastrada." hint="Crie a primeira rota para usá-la nas tabelas." /></div>}>
                {(routes) => (
                    <ul>
                        {routes.map((route) => (
                            <li key={route.id} className="gx-hair-b flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5 last:border-b-0">
                                <div className="min-w-0 flex-1 basis-56">
                                    <p className="truncate font-semibold">{route.name}</p>
                                    <p className="gx-soft text-[13.5px]">
                                        <span className="gx-mono">{route.originCode}</span> {route.originName} → <span className="gx-mono">{route.destCode}</span> {route.destName}
                                    </p>
                                    {route._count ? <p className="gx-muted text-[12.5px]">{route._count.tables} {route._count.tables === 1 ? 'tabela' : 'tabelas'}</p> : null}
                                </div>
                                <div className="flex flex-none flex-wrap items-center gap-2">
                                    {!route.active ? <Pill tone="yellow">Inativa</Pill> : null}
                                    <Button size="sm" variant="soft" onClick={() => setEditing(route)} aria-label={`Editar rota ${route.name}`}>
                                        Editar
                                    </Button>
                                    {route.active ? <ConfirmButton label="Excluir" confirmLabel="Excluir rota?" onConfirm={async () => remove(route)} /> : null}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Loadable>
            <RouteDrawer open={creating || Boolean(editing)} route={creating ? null : editing} onClose={() => (creating ? setCreating(false) : setEditing(null))} />
        </Panel>
    );
};

export const TarifasTab: React.FC = () => (
    <div className="gx-stagger flex flex-col gap-6">
        <TablesPanel />
        <RoutesPanel />
    </div>
);
