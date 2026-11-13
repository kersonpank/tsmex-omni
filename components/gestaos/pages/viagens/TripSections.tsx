import React from 'react';
import { Link } from 'react-router-dom';
import type { Manifest } from '../../../../types/index';
import { dateTime, kg, money, num, pct } from '../../lib/format';
import { linkCostSourceLabel, marginView, STOP_PURPOSE_LABEL, tripMilestones, DOC_STATUS_LABEL, DOC_TYPE_LABEL } from '../../lib/viagens';
import { orderCount } from '../../lib/trips';
import { IconAlert } from '../../ui/icons';
import { Kv, ModeBadge, Pill, Progress } from '../../ui/kit';

const Section: React.FC<{ title: string; children: React.ReactNode; aside?: React.ReactNode }> = ({ title, children, aside }) => (
    <section className="gx-inset px-4 py-3.5">
        <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="gx-label">{title}</h3>
            {aside}
        </div>
        {children}
    </section>
);

export const TripTimeline: React.FC<{ trip: Manifest }> = ({ trip }) => (
    <Section title="Linha da viagem">
        <ol className="flex flex-col">
            {tripMilestones(trip).map((item) => (
                <li key={item.key} className="gx-hair-b flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 last:border-b-0">
                    <span className="flex flex-wrap items-center gap-2">
                        <span className={item.at ? 'font-medium' : 'gx-muted'}>{item.label}</span>
                        <ModeBadge mode={item.mode} />
                    </span>
                    <span className={item.at ? 'gx-num text-[14px]' : 'gx-muted text-[13.5px]'}>{item.at ? dateTime(item.at) : item.note ?? 'pendente'}</span>
                </li>
            ))}
        </ol>
    </Section>
);

export const TripCargo: React.FC<{ trip: Manifest }> = ({ trip }) => (
    <Section title="Carga">
        <Kv label="Pedidos" value={num(orderCount(trip))} />
        <Kv label="Peso" value={kg(trip.totalWeight)} />
        <Kv label="Volume" value={trip.totalVolume != null ? `${Number(trip.totalVolume).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³` : '—'} />
        <Kv label="Valor das notas" value={money(trip.totalValue)} />
        <Kv
            label="Ocupação do veículo"
            value={
                trip.occupancyPercent != null ? (
                    <span className="flex items-center gap-2">
                        <Progress className="w-24" value={trip.occupancyPercent} label="Ocupação" />
                        {pct(trip.occupancyPercent)}
                    </span>
                ) : (
                    'sem dado'
                )
            }
        />
    </Section>
);

export const TripMargin: React.FC<{ trip: Manifest }> = ({ trip }) => {
    const view = marginView(trip);
    const source = linkCostSourceLabel(trip.linkCostSource);
    return (
        <Section title="Margem" aside={<ModeBadge mode="copilot" />}>
            <Kv label="Receita líquida" value={money(view.revenueNet)} />
            <Kv label={source ? `Transportador (${source})` : 'Custo do transportador'} value={view.complete ? money(view.linkCost) : 'não lançado'} />
            <Kv label="Comissão dos hubs" value={money(view.hubCost)} />
            <Kv label="Margem" value={view.hasMargin ? `${money(view.margin)} · ${pct(view.marginPercent, 1)}` : 'incompleta'} strong />
            {view.warnings.length ? (
                <ul className="mt-2 flex flex-col gap-1.5">
                    {view.warnings.map((warning) => (
                        <li key={warning} className="gx-yellow-text flex items-start gap-1.5 text-[13.5px]">
                            <IconAlert size={15} className="mt-0.5 flex-none" />
                            <span>{warning}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </Section>
    );
};

export const TripDocuments: React.FC<{ trip: Manifest }> = ({ trip }) => {
    const docs = trip.fiscalDocuments ?? [];
    return (
        <Section title="Documentos" aside={<ModeBadge mode="auto" />}>
            {docs.length === 0 ? (
                <p className="gx-muted text-[13.5px]">Nenhum documento fiscal emitido ainda.</p>
            ) : (
                <ul className="flex flex-col">
                    {docs.map((doc) => (
                        <li key={doc.id} className="gx-hair-b py-2.5 last:border-b-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium">
                                    {DOC_TYPE_LABEL[doc.documentType]} <span className="gx-mono text-[13px]">{doc.number ? `nº ${doc.number}` : 'sem número'}</span>
                                    {doc.unloadUf ? <span className="gx-muted text-[12.5px]"> · UF {doc.unloadUf}</span> : null}
                                </span>
                                <Pill tone={doc.status === 'REJECTED' ? 'red' : doc.status === 'AUTHORIZED' && trip.status === 'COMPLETED' ? 'yellow' : 'neutral'}>
                                    {DOC_STATUS_LABEL[doc.status] ?? 'Situação desconhecida'}
                                </Pill>
                            </div>
                            <p className="gx-muted mt-0.5 text-[12.5px]">
                                {doc.authorizedAt ? `autorizado ${dateTime(doc.authorizedAt)}` : 'não autorizado'}
                                {doc.closedAt ? ` · encerrado ${dateTime(doc.closedAt)}` : ''}
                            </p>
                            {doc.statusReason ? <p className="gx-soft mt-1 text-[13px]">{doc.statusReason}</p> : null}
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
};

export const TripStops: React.FC<{ trip: Manifest }> = ({ trip }) => {
    const stops = (trip.tripStops ?? []).slice().sort((a, b) => a.sequence - b.sequence);
    if (!stops.length) return null;
    return (
        <Section title="Paradas">
            <ol className="flex flex-col">
                {stops.map((stop) => {
                    const place = stop.destinationLabel || stop.destHub?.name || [stop.destCity, stop.destState].filter(Boolean).join('/') || 'Parada';
                    const state = stop.completedAt ? `concluída ${dateTime(stop.completedAt)}` : stop.arrivedAt ? `chegou ${dateTime(stop.arrivedAt)}` : stop.plannedArrivalAt ? `prevista ${dateTime(stop.plannedArrivalAt)}` : 'sem previsão';
                    return (
                        <li key={stop.id} className="gx-hair-b flex flex-wrap items-baseline justify-between gap-x-4 py-2.5 last:border-b-0">
                            <span>
                                <span className="gx-num mr-2 text-[13px]">{stop.sequence}</span>
                                {place}
                                {stop.purpose ? <span className="gx-muted text-[12.5px]"> · {STOP_PURPOSE_LABEL[stop.purpose]}</span> : null}
                            </span>
                            <span className="gx-muted text-[12.5px]">{state}</span>
                        </li>
                    );
                })}
            </ol>
        </Section>
    );
};

export const TripOrders: React.FC<{ trip: Manifest }> = ({ trip }) => {
    const demands = trip.demands ?? [];
    if (!demands.length) return null;
    return (
        <Section title="Pedidos da viagem">
            <ul className="flex flex-col">
                {demands.map((demand) => {
                    const orderId = demand.order?.id;
                    const body = (
                        <>
                            <span>
                                <span className="gx-num mr-2 text-[14px]">#{demand.orderNumber}</span>
                                <span className="gx-muted text-[12.5px]">NF {demand.nfNumber || '—'}</span>
                            </span>
                            <span className="gx-soft min-w-0 truncate text-[13px]">{demand.destination}</span>
                        </>
                    );
                    return (
                        <li key={demand.id} className="gx-hair-b last:border-b-0">
                            {orderId ? (
                                <Link to={`/gestaos/pedidos?p=${orderId}`} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5 hover:underline">
                                    {body}
                                </Link>
                            ) : (
                                <div className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5">{body}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </Section>
    );
};
