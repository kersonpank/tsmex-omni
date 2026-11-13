import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AUTO_KIND_LABEL, countByKind, groupByDay, type AutoEvent, type AutoKind } from '../../lib/autopilot';
import { dayLabel, timeHM } from '../../lib/format';
import { routinesByMode } from '../../lib/modes';
import { IconArrowRight, IconBolt, IconCheck, IconDoc, IconReceipt, type IconProps } from '../../ui/icons';
import { Button, ErrorState, Panel, Skeleton } from '../../ui/kit';

/**
 * Feed do Autopilot: o que o sistema executou sozinho, com hora e caminho para conferir.
 * É a metade "trabalho pronto" da tela — a pessoa audita, não executa.
 */

const KIND_ICON: Record<AutoKind, React.FC<IconProps>> = {
    fiscalClosure: IconDoc,
    payable: IconReceipt,
    alertSelfResolved: IconCheck,
};

const KINDS: AutoKind[] = ['fiscalClosure', 'payable', 'alertSelfResolved'];
const FIRST_PAGE = 9;

const EventRow: React.FC<{ event: AutoEvent }> = ({ event }) => {
    const Icon = KIND_ICON[event.kind];
    const body = (
        <>
            <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px]" style={{ background: 'var(--gx-royal-soft)', color: 'var(--gx-royal-text)' }}>
                <Icon size={16} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold leading-snug">{event.title}</span>
                <span className="gx-muted block truncate text-[13px]">{event.detail}</span>
            </span>
            <span className="gx-mono gx-muted flex-none">{timeHM(event.at)}</span>
        </>
    );
    return event.to ? (
        <Link to={event.to} className="gx-row flex items-center gap-3">
            {body}
        </Link>
    ) : (
        <div className="flex items-center gap-3 px-3.5 py-3">{body}</div>
    );
};

export const AutopilotFeed: React.FC<{ events: AutoEvent[]; loading: boolean; error: string | null; onRetry: () => void; now: Date }> = ({
    events,
    loading,
    error,
    onRetry,
    now,
}) => {
    const [showAll, setShowAll] = useState(false);
    const counts = useMemo(() => countByKind(events), [events]);
    const groups = useMemo(() => groupByDay(showAll ? events : events.slice(0, FIRST_PAGE)), [events, showAll]);
    const watching = routinesByMode('auto');

    return (
        <Panel
            title="O sistema resolveu"
            mode="auto"
            tint="auto"
            count={loading ? null : events.length}
            countTone="royal"
            hint="Executado sozinho nos últimos 7 dias. Você só confere."
            padded={false}
        >
            {loading ? (
                <Skeleton rows={5} height={54} className="px-5 pb-5" />
            ) : (
                <>
                    {error ? <ErrorState className="mx-5 mb-3" message={`${error} Parte do histórico pode estar faltando.`} onRetry={onRetry} /> : null}

                    <div className="grid grid-cols-3 gap-2 px-5 pb-3">
                        {KINDS.map((kind) => (
                            <div key={kind} className="gx-inset px-3 py-2.5">
                                <span className="gx-num gx-royal-text block text-[22px] leading-none">{counts[kind]}</span>
                                <span className="gx-muted mt-1.5 block text-[12px] leading-tight">{AUTO_KIND_LABEL[kind]}</span>
                            </div>
                        ))}
                    </div>

                    {events.length === 0 ? (
                        <div className="px-5 pb-5">
                            <div className="gx-inset px-4 py-4">
                                <p className="font-semibold">Nenhuma execução automática nos últimos 7 dias.</p>
                                <p className="gx-muted mt-1 text-[13.5px]">O sistema segue vigiando. Quando ele encerrar um documento, gerar um título ou fechar um alerta, aparece aqui.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="px-2 pb-1">
                            {groups.map((group) => (
                                <section key={group.day}>
                                    <h3 className="gx-label px-3.5 pb-1 pt-3">{dayLabel(group.events[0].at, now)}</h3>
                                    <ul className="flex flex-col gap-0.5">
                                        {group.events.map((event) => (
                                            <li key={event.id}>
                                                <EventRow event={event} />
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ))}
                            {events.length > FIRST_PAGE ? (
                                <div className="px-3.5 pb-2 pt-3">
                                    <Button size="sm" variant="soft" onClick={() => setShowAll((value) => !value)}>
                                        {showAll ? 'Mostrar menos' : `Ver as ${events.length} execuções`}
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    )}

                    <div className="gx-hair-t mx-5 mt-2 py-4">
                        <p className="gx-label flex items-center gap-1.5">
                            <IconBolt size={14} /> Rodando agora, sem você
                        </p>
                        <ul className="mt-2 flex flex-col gap-1.5 text-[13.5px]">
                            {watching.map((routine) => (
                                <li key={routine.id} className="flex items-baseline gap-2">
                                    <span className="gx-pulse gx-royal-text relative top-[-1px] flex-none" aria-hidden="true" />
                                    <span className="gx-soft">{routine.name}</span>
                                </li>
                            ))}
                        </ul>
                        <Link to="/gestaos/sistema" className="gx-royal-text mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold">
                            Como a torre trabalha <IconArrowRight size={15} />
                        </Link>
                    </div>
                </>
            )}
        </Panel>
    );
};
