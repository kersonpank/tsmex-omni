import React from 'react';
import type { Manifest, ManifestReadiness } from '../../../../../types/index';
import { missingItems, TRIP_STEPS, type TripStep } from '../../../lib/viagemWork';
import { IconAlert, IconCheck, IconChevronRight } from '../../../ui/icons';
import { Button, Panel, Pill, Skeleton } from '../../../ui/kit';

const stepLabel = (step: TripStep) => TRIP_STEPS.find((item) => item.id === step)?.label ?? step;

/** "Falta para sair": a prontidão do servidor (Copilot). Cada pendência leva à etapa que a resolve. */
export const MissingPanel: React.FC<{
    trip: Manifest;
    readiness: ManifestReadiness | null;
    loading: boolean;
    error: string | null;
    onGoto: (step: TripStep) => void;
    onReload: () => void;
}> = ({ trip, readiness, loading, error, onGoto, onReload }) => {
    const closed = trip.status === 'IN_PROGRESS' || trip.status === 'COMPLETED' || trip.status === 'CANCELLED';
    const items = readiness ? missingItems(readiness.issues) : [];
    return (
        <Panel title="Falta para sair" hint="O servidor confere a viagem e lista o que impede o próximo passo." mode="copilot" tint="auto" count={readiness ? items.filter((i) => i.blocking).length : null} countTone="yellow">
            {loading ? (
                <Skeleton rows={3} height={38} />
            ) : error && !readiness ? (
                <div role="alert">
                    <p className="gx-red-text text-[13.5px] font-semibold">Não foi possível conferir a prontidão. {error}</p>
                    <Button size="sm" className="mt-2" onClick={onReload}>
                        Tentar de novo
                    </Button>
                </div>
            ) : closed ? (
                <p className="gx-soft text-[14px]">A viagem já passou da fase de preparação. Acompanhe pelas etapas Oferta e saída e Documentos.</p>
            ) : items.length === 0 ? (
                <p className="flex items-center gap-2 text-[14.5px] font-semibold">
                    <IconCheck size={18} className="gx-royal-text" /> Nada pendente. Siga para Oferta e saída.
                </p>
            ) : (
                <ul className="flex flex-col">
                    {items.map((item) => (
                        <li key={item.title} className="gx-hair-b last:border-b-0">
                            <button type="button" className="flex w-full items-start gap-2.5 py-3 text-left" onClick={() => onGoto(item.step)} aria-label={`${item.title}: ir para ${stepLabel(item.step)}`}>
                                <IconAlert size={16} className={item.blocking ? 'gx-red-text mt-1 flex-none' : 'gx-yellow-text mt-1 flex-none'} />
                                <span className="min-w-0 flex-1">
                                    <span className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">{item.title}</span>
                                        <Pill tone={item.blocking ? 'red' : 'yellow'}>{item.blocking ? 'Bloqueia' : 'Aviso'}</Pill>
                                    </span>
                                    {item.messages.slice(0, 2).map((message) => (
                                        <span key={message} className="gx-soft mt-0.5 block text-[13px]">
                                            {message}
                                        </span>
                                    ))}
                                    {item.messages.length > 2 ? <span className="gx-muted block text-[12.5px]">e mais {item.messages.length - 2}</span> : null}
                                    <span className="gx-royal-text mt-1 block text-[12.5px] font-semibold">Resolver em {stepLabel(item.step)}</span>
                                </span>
                                <IconChevronRight size={16} className="gx-muted mt-1.5 flex-none" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="mt-3">
                <Button size="sm" variant="ghost" onClick={onReload}>
                    Reconferir
                </Button>
            </div>
        </Panel>
    );
};
