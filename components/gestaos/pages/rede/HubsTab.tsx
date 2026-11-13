import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { useExceptions, useHubs, useManifests, useOperationsSummary } from '../../lib/data';
import { num } from '../../lib/format';
import { buildHubRows, redeTotals, type HubRow } from '../../lib/redeHubs';
import { matchesHub, type HubStatusFilter } from '../../lib/redeCadastro';
import { Button, Chip, EmptyState, ErrorState, Glass, Loadable, ModeBadge, Panel, Pill, Skeleton, Stat, TextInput } from '../../ui/kit';
import { HUB_PANELS, HubDrawer, type HubPanel } from './hubs/HubDrawer';

const Figure: React.FC<{ label: string; value: number; red?: boolean; to?: string; hint?: string }> = ({ label, value, red, to, hint }) => {
    const body = (
        <>
            <span className="gx-label block">{label}</span>
            <span className={clsx('gx-num mt-0.5 block text-[24px] leading-none', red && 'gx-red-text')}>{num(value)}</span>
            {hint ? <span className={clsx('mt-1 block text-[12px]', red ? 'gx-red-text' : 'gx-muted')}>{hint}</span> : null}
        </>
    );
    return to ? (
        <Link to={to} className="gx-inset block px-3 py-2.5" aria-label={`${label}: ${value}. Abrir a fila no Hoje`}>
            {body}
        </Link>
    ) : (
        <div className="gx-inset px-3 py-2.5">{body}</div>
    );
};

const HubCard: React.FC<{ row: HubRow; onOpen: (panel: HubPanel) => void }> = ({ row, onOpen }) => {
    const { hub } = row;
    return (
        <Panel className={clsx(!hub.active && 'opacity-60')} bodyClassName="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="gx-mono gx-soft text-[12.5px]">{hub.code}</p>
                    <h3 className="gx-h2 mt-0.5">{hub.name}</h3>
                    <p className="gx-muted mt-0.5 text-[13px]">
                        {hub.city}/{hub.state}
                        {row.gatewayName ? <> · abastecido por {row.gatewayName}</> : null}
                    </p>
                </div>
                {!hub.active ? <Pill>inativo</Pill> : null}
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                <Figure label="Em estoque" value={row.stock} />
                <Figure label="Saindo" value={row.departing} />
                <Figure label="Chegando" value={row.arriving} />
                <Figure
                    label="Exceções"
                    value={row.exceptions}
                    red={row.overdue > 0}
                    to={row.exceptions > 0 ? '/gestaos' : undefined}
                    hint={row.overdue > 0 ? `${num(row.overdue)} vencida${row.overdue > 1 ? 's' : ''}` : undefined}
                />
            </div>
            <div className="flex flex-wrap gap-2">
                <Link to="/hubs" className="gx-btn gx-btn-soft gx-btn-sm">
                    Operar este hub
                </Link>
                <Button size="sm" onClick={() => onOpen('dados')}>
                    Editar
                </Button>
                <Button size="sm" onClick={() => onOpen('operadores')}>
                    Operadores
                </Button>
                <Button size="sm" onClick={() => onOpen('cobertura')}>
                    Cobertura
                </Button>
            </div>
        </Panel>
    );
};

export const HubsTab: React.FC = () => {
    const hubs = useHubs();
    const summary = useOperationsSummary();
    const exceptions = useExceptions();
    const manifests = useManifests();

    const [params, setParams] = useSearchParams();
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<HubStatusFilter>('active');
    const openId = params.get('h');
    const rawPanel = params.get('hp');
    const panel: HubPanel = (HUB_PANELS as readonly string[]).includes(rawPanel ?? '') ? (rawPanel as HubPanel) : 'dados';
    const setDrawer = (id: string | null, next: HubPanel = 'dados') => {
        const p = new URLSearchParams(params);
        if (id) p.set('h', id);
        else p.delete('h');
        if (id && next !== 'dados') p.set('hp', next);
        else p.delete('hp');
        setParams(p, { replace: true });
    };

    const allRows = useMemo(
        () => (hubs.data ? buildHubRows(hubs.data, summary.data, exceptions.data?.items, manifests.data) : []),
        [hubs.data, summary.data, exceptions.data, manifests.data],
    );
    const rows = useMemo(() => allRows.filter((row) => matchesHub(row.hub, query, status)), [allRows, query, status]);
    const openHub = openId && openId !== 'novo' ? hubs.data?.find((hub) => hub.id === openId) ?? null : null;
    const totals = useMemo(() => redeTotals(hubs.data ?? [], summary.data), [hubs.data, summary.data]);
    const partialError = [summary, exceptions, manifests].find((source) => source.error && source.data == null);

    return (
        <div className="flex flex-col gap-6">
            <Glass className="gx-rise grid grid-cols-2 gap-1 p-2 md:grid-cols-4">
                <Stat label="Hubs ativos" value={hubs.data ? num(totals.activeHubs) : '—'} />
                <Stat label="Pedidos em estoque" value={summary.data ? num(totals.stock) : '—'} />
                <Stat label="Em trânsito" value={summary.data ? num(totals.inTransit) : '—'} />
                <Stat label="Parados há mais de 7 dias" value={summary.data ? num(totals.aged7d) : '—'} tone={totals.aged7d > 0 ? 'yellow' : 'neutral'} />
            </Glass>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
                <ModeBadge mode="auto" />
                <p className="gx-muted text-[13.5px]">O sistema vigia estoque parado, atraso e pedido sem rota; estoque e exceções abaixo vêm dessa leitura, renovada a cada minuto.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <TextInput type="search" className="max-w-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, código, cidade ou CNPJ" aria-label="Buscar hub" />
                <div className="flex flex-wrap gap-2" role="group" aria-label="Situação do hub">
                    <Chip active={status === 'active'} onClick={() => setStatus('active')}>Ativos</Chip>
                    <Chip active={status === 'inactive'} onClick={() => setStatus('inactive')}>Inativos</Chip>
                    <Chip active={status === 'all'} onClick={() => setStatus('all')}>Todos</Chip>
                </div>
                <Button variant="primary" className="ml-auto" onClick={() => setDrawer('novo')}>
                    Novo hub
                </Button>
            </div>
            {partialError ? <ErrorState message={partialError.error ?? ''} onRetry={partialError.reload} /> : null}
            <Loadable
                state={hubs}
                skeleton={<Skeleton rows={3} height={150} />}
                empty={<EmptyState title="Nenhum hub cadastrado" hint="Crie o primeiro depósito da rede." action={<Button variant="primary" onClick={() => setDrawer('novo')}>Novo hub</Button>} />}
                isEmpty={(list) => list.length === 0}
            >
                {() =>
                    rows.length === 0 ? (
                        <EmptyState title="Nenhum hub nesta visão" hint="Tire a busca ou troque a situação acima." />
                    ) : (
                        <div className="gx-stagger grid grid-cols-1 gap-5 xl:grid-cols-2">
                            {rows.map((row) => (
                                <HubCard key={row.hub.id} row={row} onOpen={(next) => setDrawer(row.hub.id, next)} />
                            ))}
                        </div>
                    )
                }
            </Loadable>
            {openId === 'novo' || openHub ? (
                <HubDrawer
                    hub={openHub}
                    panel={panel}
                    onPanel={(next) => setDrawer(openId, next)}
                    onSaved={(saved) => setDrawer(saved.id, openId === 'novo' ? 'operadores' : 'dados')}
                    onClose={() => setDrawer(null)}
                />
            ) : null}
        </div>
    );
};
