import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Manifest } from '../../../../types/index';
import { dayLabel, kg, plural, timeHM } from '../../lib/format';
import type { UseResourceResult } from '../../lib/resource';
import { carrierLabel, DOC_STATE_LABEL, docState, isLiveTrip, orderCount, platesLabel, routeLabel, sortByAttention, tripAttention, tripClock, tripStage, type DocState, type Tone } from '../../lib/trips';
import { IconArrowRight } from '../../ui/icons';
import { EmptyState, Loadable, Panel, Pill, Progress, Skeleton } from '../../ui/kit';

/** Quadro de viagens do Hoje: as que pedem atenção primeiro, e um toque até o detalhe. */

const DOC_TONE: Record<DocState, Tone> = { none: 'neutral', processing: 'yellow', authorized: 'royal', closed: 'neutral', rejected: 'red' };
const LIMIT = 8;

const DocPill: React.FC<{ name: string; state: DocState }> = ({ name, state }) => (
    <Pill tone={DOC_TONE[state]}>
        {name} {DOC_STATE_LABEL[state]}
    </Pill>
);

export const TripBoard: React.FC<{ manifests: UseResourceResult<Manifest[]>; now: Date }> = ({ manifests, now }) => {
    const navigate = useNavigate();
    const live = useMemo(() => sortByAttention((manifests.data ?? []).filter(isLiveTrip), now), [manifests.data, now]);

    return (
        <Panel
            title="Viagens em andamento"
            count={manifests.data ? live.length : null}
            hint="As que pedem atenção vêm primeiro."
            padded={false}
            actions={
                <Link to="/gestaos/viagens" className="gx-btn gx-btn-soft gx-btn-sm">
                    Ver todas <IconArrowRight size={15} />
                </Link>
            }
        >
            <Loadable state={manifests} skeleton={<Skeleton rows={4} height={52} className="px-5 pb-4" />}>
                {() =>
                    live.length === 0 ? (
                        <EmptyState className="mx-5 mb-4" title="Nenhuma viagem em andamento." hint="Viagens em montagem, na estrada ou com documento aberto aparecem aqui." />
                    ) : (
                        <div className="gx-scroll-x">
                            <table className="gx-table min-w-[940px]">
                                <thead>
                                    <tr>
                                        <th>Quando</th>
                                        <th>Rota</th>
                                        <th>Transportador</th>
                                        <th>Carga</th>
                                        <th>Documentos</th>
                                        <th>Situação</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {live.slice(0, LIMIT).map((trip) => {
                                        const clock = tripClock(trip);
                                        const attention = tripAttention(trip, now);
                                        const stage = tripStage(trip);
                                        const occupancy = trip.occupancyPercent ?? null;
                                        return (
                                            <tr key={trip.id} data-clickable="true" onClick={() => navigate(`/gestaos/viagens?v=${trip.id}`)}>
                                                <td>
                                                    <span className="gx-num block text-[15px]">{clock.iso ? timeHM(clock.iso) : '—'}</span>
                                                    <span className="gx-muted block text-[12px]">
                                                        {clock.label}
                                                        {clock.iso ? ` · ${dayLabel(clock.iso, now)}` : ''}
                                                    </span>
                                                </td>
                                                <td>
                                                    <Link to={`/gestaos/viagens?v=${trip.id}`} className="font-semibold" onClick={(event) => event.stopPropagation()}>
                                                        {routeLabel(trip)}
                                                    </Link>
                                                </td>
                                                <td>
                                                    <span className="block">{carrierLabel(trip)}</span>
                                                    <span className="gx-mono gx-muted block">{platesLabel(trip)}</span>
                                                </td>
                                                <td>
                                                    <span className="block">
                                                        {plural(orderCount(trip), 'pedido', 'pedidos')} · {kg(trip.totalWeight)}
                                                    </span>
                                                    {occupancy != null ? (
                                                        <span className="mt-1.5 flex items-center gap-2">
                                                            <Progress value={occupancy} className="w-[84px]" label="Ocupação do veículo" />
                                                            <span className="gx-mono gx-muted">{Math.round(occupancy)}%</span>
                                                        </span>
                                                    ) : null}
                                                </td>
                                                <td>
                                                    <span className="flex flex-wrap gap-1.5">
                                                        <DocPill name="MDF-e" state={docState(trip, 'MDFE')} />
                                                        <DocPill name="CIOT" state={docState(trip, 'CIOT')} />
                                                    </span>
                                                </td>
                                                <td>
                                                    <Pill tone={attention.level === 2 ? 'red' : attention.level === 1 ? 'yellow' : stage.tone} dot={attention.level === 2}>
                                                        {stage.label}
                                                    </Pill>
                                                    {attention.reason ? (
                                                        <span className={`mt-1 block text-[12.5px] ${attention.level === 2 ? 'gx-red-text' : 'gx-yellow-text'}`}>{attention.reason}</span>
                                                    ) : null}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {live.length > LIMIT ? (
                                <p className="gx-muted px-5 py-3 text-[13px]">
                                    Mostrando {LIMIT} de {live.length}. <Link to="/gestaos/viagens" className="gx-royal-text font-semibold">Ver todas</Link>
                                </p>
                            ) : null}
                        </div>
                    )
                }
            </Loadable>
        </Panel>
    );
};
