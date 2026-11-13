import React from 'react';
import clsx from 'clsx';
import type { Manifest } from '../../../../types/index';
import { dayLabel, kg, plural, timeHM } from '../../lib/format';
import { carrierLabel, DOC_STATE_LABEL, docState, orderCount, platesLabel, routeLabel, tripAttention, tripClock, tripCode, tripStage, type DocState, type Tone } from '../../lib/trips';
import { IconAlert } from '../../ui/icons';
import { Pill, Progress } from '../../ui/kit';

const DOC_TONE: Record<DocState, Tone> = { none: 'neutral', processing: 'royal', authorized: 'royal', closed: 'neutral', rejected: 'red' };

/** Um documento só vira alerta quando falta de verdade: viagem cancelada ou ainda em montagem não "deve" MDF-e. */
function docTone(trip: Manifest, state: DocState): Tone {
    if (state === 'none' && (trip.status === 'ACCEPTED' || trip.status === 'IN_PROGRESS')) return 'yellow';
    return DOC_TONE[state];
}

const DocPill: React.FC<{ trip: Manifest; type: 'MDFE' | 'CIOT'; name: string }> = ({ trip, type, name }) => {
    const state = docState(trip, type);
    return (
        <Pill tone={docTone(trip, state)} title={`${name}: ${DOC_STATE_LABEL[state]}`}>
            {name} {DOC_STATE_LABEL[state]}
        </Pill>
    );
};

/** Uma viagem na lista: horário, rota, quem leva, carga, documentos, estágio e o motivo da atenção. */
export const TripRow: React.FC<{ trip: Manifest; selected: boolean; onOpen: () => void; now: Date }> = ({ trip, selected, onOpen, now }) => {
    const attention = tripAttention(trip, now);
    const stage = tripStage(trip);
    const clock = tripClock(trip);
    const orders = orderCount(trip);
    const occupancy = trip.occupancyPercent;

    return (
        <button type="button" className="gx-row !rounded-none" aria-current={selected || undefined} onClick={onOpen}>
            <div className="grid items-center gap-x-5 gap-y-3 lg:grid-cols-[104px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto]">
                <div className="min-w-0">
                    <p className="gx-num text-[17px] leading-none">{timeHM(clock.iso)}</p>
                    <p className="gx-muted mt-1 text-[12px]">
                        {clock.label} {dayLabel(clock.iso, now)}
                    </p>
                </div>

                <div className="min-w-0">
                    <p className="truncate text-[16px] font-semibold tracking-[-0.01em]">{routeLabel(trip)}</p>
                    <p className="gx-soft mt-0.5 truncate text-[13.5px]">
                        {carrierLabel(trip)} · <span className="gx-mono text-[12.5px]">{platesLabel(trip)}</span>
                    </p>
                </div>

                <div className="min-w-0">
                    <p className="text-[13.5px]">
                        {plural(orders, 'pedido', 'pedidos')} · {kg(trip.totalWeight)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                        <Progress className="min-w-0 flex-1" value={occupancy} tone={occupancy != null && occupancy > 100 ? 'red' : 'royal'} label="Ocupação do veículo" />
                        <span className="gx-muted w-[72px] flex-none text-right text-[12px]">{occupancy != null ? `${Math.round(occupancy)}% cheio` : 'sem ocupação'}</span>
                    </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                    <DocPill trip={trip} type="MDFE" name="MDF-e" />
                    <DocPill trip={trip} type="CIOT" name="CIOT" />
                </div>

                <div className="flex items-center gap-2 lg:justify-end">
                    <span className="gx-mono gx-muted text-[12px]">{tripCode(trip)}</span>
                    <Pill tone={stage.tone}>{stage.label}</Pill>
                </div>
            </div>

            {attention.reason ? (
                <p className={clsx('mt-2.5 flex items-center gap-1.5 text-[13.5px] font-semibold', attention.level === 2 ? 'gx-red-text' : 'gx-yellow-text')}>
                    <IconAlert size={15} className="flex-none" />
                    {attention.level === 2 ? 'Travada: ' : 'Atenção: '}
                    {attention.reason}
                </p>
            ) : null}
        </button>
    );
};
