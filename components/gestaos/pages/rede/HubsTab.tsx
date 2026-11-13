import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useExceptions, useHubs, useManifests, useOperationsSummary } from '../../lib/data';
import { num } from '../../lib/format';
import { buildHubRows, redeTotals, type HubRow } from '../../lib/redeHubs';
import { EmptyState, ErrorState, Glass, Loadable, ModeBadge, Panel, Pill, Skeleton, Stat } from '../../ui/kit';

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

const HubCard: React.FC<{ row: HubRow }> = ({ row }) => {
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
                <Link to="/hubs/cobertura" className="gx-btn gx-btn-ghost gx-btn-sm">
                    Cobertura
                </Link>
                <Link to="/gestao?cat=transport&sub=hubs" className="gx-btn gx-btn-ghost gx-btn-sm">
                    Cadastro
                </Link>
            </div>
        </Panel>
    );
};

export const HubsTab: React.FC = () => {
    const hubs = useHubs();
    const summary = useOperationsSummary();
    const exceptions = useExceptions();
    const manifests = useManifests();

    const rows = useMemo(
        () => (hubs.data ? buildHubRows(hubs.data, summary.data, exceptions.data?.items, manifests.data) : []),
        [hubs.data, summary.data, exceptions.data, manifests.data],
    );
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
            {partialError ? <ErrorState message={partialError.error ?? ''} onRetry={partialError.reload} /> : null}
            <Loadable
                state={hubs}
                skeleton={<Skeleton rows={3} height={150} />}
                empty={<EmptyState title="Nenhum hub cadastrado" hint="O cadastro de hubs continua na gestão clássica." action={<Link to="/gestao?cat=transport&sub=hubs" className="gx-btn gx-btn-soft">Abrir cadastro de hubs</Link>} />}
                isEmpty={(list) => list.length === 0}
            >
                {() => (
                    <div className="gx-stagger grid grid-cols-1 gap-5 xl:grid-cols-2">
                        {rows.map((row) => (
                            <HubCard key={row.hub.id} row={row} />
                        ))}
                    </div>
                )}
            </Loadable>
        </div>
    );
};
