import React from 'react';
import { Link } from 'react-router-dom';
import type { Manifest } from '../../../../types/index';
import { carrierLabel, platesLabel, routeLabel, tripAttention, tripCode, tripStage } from '../../lib/trips';
import { IconAlert } from '../../ui/icons';
import { Pill } from '../../ui/kit';
import { Drawer } from '../../ui/overlay';
import { FiscalCopilot } from './FiscalCopilot';
import { TripCargo, TripDocuments, TripMargin, TripOrders, TripStops, TripTimeline } from './TripSections';

/** Gaveta da viagem: o que falta para ela andar, a linha do tempo e os números. A operação física fica no hub. */
export const TripDrawer: React.FC<{ trip: Manifest | null; onClose: () => void }> = ({ trip, onClose }) => {
    const attention = trip ? tripAttention(trip) : null;
    const stage = trip ? tripStage(trip) : null;
    const hasFiscalDecision = trip ? trip.status === 'COMPLETED' && (trip.fiscalDocuments ?? []).some((doc) => doc.status === 'AUTHORIZED') : false;

    return (
        <Drawer
            open={Boolean(trip)}
            onClose={onClose}
            width={640}
            title={trip ? routeLabel(trip) : 'Viagem'}
            subtitle={
                trip ? (
                    <>
                        <span className="gx-mono">{tripCode(trip)}</span> · {carrierLabel(trip)} · <span className="gx-mono">{platesLabel(trip)}</span>
                    </>
                ) : null
            }
            badge={stage ? <Pill tone={stage.tone}>{stage.label}</Pill> : null}
            footer={
                trip ? (
                    <>
                        <Link to={`/manifests/${trip.id}`} className="gx-btn gx-btn-soft">
                            Abrir viagem completa
                        </Link>
                        <Link to={`/hubs/viagens/${trip.id}`} className="gx-btn gx-btn-ghost">
                            Abrir no hub
                        </Link>
                    </>
                ) : null
            }
        >
            {trip ? (
                <div className="flex flex-col gap-4">
                    {hasFiscalDecision ? (
                        <FiscalCopilot trip={trip} />
                    ) : attention?.reason ? (
                        <div className="gx-inset flex items-start gap-2.5 px-4 py-3.5" role="status">
                            <IconAlert size={18} className={attention.level === 2 ? 'gx-red-text mt-0.5 flex-none' : 'gx-yellow-text mt-0.5 flex-none'} />
                            <div>
                                <p className={attention.level === 2 ? 'gx-red-text font-semibold' : 'gx-yellow-text font-semibold'}>{attention.level === 2 ? 'Travada' : 'Precisa de atenção'}</p>
                                <p className="gx-soft mt-0.5 text-[14px]">{attention.reason}. Resolva no hub ou na viagem completa.</p>
                            </div>
                        </div>
                    ) : null}
                    <TripTimeline trip={trip} />
                    <TripCargo trip={trip} />
                    <TripMargin trip={trip} />
                    <TripDocuments trip={trip} />
                    <TripStops trip={trip} />
                    <TripOrders trip={trip} />
                </div>
            ) : null}
        </Drawer>
    );
};
