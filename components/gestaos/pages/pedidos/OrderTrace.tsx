import React from 'react';
import clsx from 'clsx';
import { ordersApi } from '../../../../lib/api';
import { nextSteps, timelineEvents, whereNow, type OrderTimelineData, type TimelineLeg } from '../../../os/lib/timeline';
import { dateTime } from '../../lib/format';
import { useResource } from '../../lib/resource';
import { Loadable, Pill, Skeleton } from '../../ui/kit';

/**
 * Rastreio do pedido. A resposta de `ordersApi.timeline` chega como `unknown`; o formato é o de
 * `server/src/services/orderTimeline.ts` (tipado em components/os/lib/timeline.ts, lib pura sem tela).
 */

const LEG_LABEL: Record<TimelineLeg['legType'], string> = { COLETA: 'Coleta', TRANSFERENCIA: 'Transferência', ENTREGA: 'Entrega ao cliente' };
const TRIP_STATUS: Record<string, string> = {
    DRAFT: 'em montagem',
    PENDING_ACCEPT: 'aguardando aceite',
    ACCEPTED: 'pronta para sair',
    IN_PROGRESS: 'na estrada',
    COMPLETED: 'concluída',
    CANCELLED: 'cancelada',
};
const ATTEMPT_LABEL = { DELIVERED: 'Entregue', PARTIAL: 'Entrega parcial', FAILED: 'Não entregue' } as const;
const NEXT_ACTION: Record<string, string> = { REATTEMPT: 'nova tentativa', RETURN_TO_HUB: 'volta ao hub', TRANSFER: 'transferir' };

const Block: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="gx-inset px-4 py-3.5">
        <h3 className="gx-label mb-2">{title}</h3>
        {children}
    </section>
);

const Trace: React.FC<{ data: OrderTimelineData }> = ({ data }) => {
    const now = whereNow(data);
    const next = nextSteps(data);
    const events = timelineEvents(data);
    return (
        <div className="flex flex-col gap-4">
            <div className={'gx-inset px-4 py-3.5'} role="status">
                <p className="gx-label">Onde está agora</p>
                <p className={clsx('mt-1 text-[16px] font-semibold leading-snug', now.tone === 'bad' && 'gx-red-text')}>{now.headline}</p>
                {now.detail ? <p className="gx-yellow-text mt-1 text-[13.5px] font-semibold">{now.detail}</p> : null}
            </div>

            {next.length ? (
                <Block title="Próximos passos">
                    <ul className="flex flex-col gap-1.5">
                        {next.map((step) => (
                            <li key={step} className="gx-soft text-[13.5px]">
                                {step}
                            </li>
                        ))}
                    </ul>
                </Block>
            ) : null}

            <Block title="Histórico">
                {events.length === 0 ? (
                    <p className="gx-muted text-[13.5px]">Ainda não há registros.</p>
                ) : (
                    <ol className="flex flex-col">
                        {events.map((event) => (
                            <li key={event.id} className="gx-hair-b py-2.5 last:border-b-0">
                                <p className={clsx('text-[14px] font-semibold', event.highlight && 'gx-red-text')}>{event.title}</p>
                                {event.detail ? <p className="gx-soft mt-0.5 text-[13px]">{event.detail}</p> : null}
                                <p className="gx-muted mt-0.5 text-[12.5px]">
                                    {dateTime(event.at)}
                                    {event.where ? ` · ${event.where}` : ''}
                                    {event.actor ? ` · por ${event.actor}` : ''}
                                    {event.photoUrl ? (
                                        <>
                                            {' · '}
                                            <a href={event.photoUrl} target="_blank" rel="noreferrer" className="gx-royal-text underline">
                                                ver foto
                                            </a>
                                        </>
                                    ) : null}
                                </p>
                            </li>
                        ))}
                    </ol>
                )}
            </Block>

            {data.legs.length ? (
                <Block title="Trechos">
                    <ol className="flex flex-col">
                        {data.legs.map((leg) => {
                            const manifest = leg.manifest;
                            const route = manifest ? `${manifest.origin} → ${manifest.destination}` : 'viagem removida';
                            const state = leg.completedAt ? `concluído ${dateTime(leg.completedAt)}` : leg.startedAt ? `saiu ${dateTime(leg.startedAt)}` : 'ainda não saiu';
                            return (
                                <li key={leg.id} className="gx-hair-b py-2.5 last:border-b-0">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-medium">
                                            <span className="gx-num mr-2 text-[13px]">{leg.sequence}</span>
                                            {LEG_LABEL[leg.legType] ?? 'Trecho'}
                                        </span>
                                        {manifest ? <Pill>{TRIP_STATUS[manifest.status] ?? 'situação desconhecida'}</Pill> : null}
                                    </div>
                                    <p className="gx-soft mt-0.5 text-[13px]">{route}</p>
                                    <p className="gx-muted text-[12.5px]">{state}</p>
                                </li>
                            );
                        })}
                    </ol>
                </Block>
            ) : null}

            {data.attempts.length ? (
                <Block title="Tentativas de entrega">
                    <ul className="flex flex-col">
                        {data.attempts.map((attempt) => (
                            <li key={attempt.id} className="gx-hair-b py-2.5 last:border-b-0">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className={clsx('font-medium', attempt.result === 'FAILED' && 'gx-red-text')}>{ATTEMPT_LABEL[attempt.result] ?? 'Tentativa'}</span>
                                    <span className="gx-muted text-[12.5px]">{dateTime(attempt.occurredAt)}</span>
                                </div>
                                {attempt.receiverName ? <p className="gx-soft mt-0.5 text-[13px]">Recebido por {attempt.receiverName}</p> : null}
                                {attempt.exceptionReason ? <p className="gx-soft mt-0.5 text-[13px]">{attempt.exceptionReason}</p> : null}
                                {attempt.nextAction ? <p className="gx-muted text-[12.5px]">Próximo passo: {NEXT_ACTION[attempt.nextAction] ?? 'a definir'}</p> : null}
                            </li>
                        ))}
                    </ul>
                </Block>
            ) : null}
        </div>
    );
};

export const OrderTrace: React.FC<{ orderId: string }> = ({ orderId }) => {
    const state = useResource<OrderTimelineData>(`orders:timeline:${orderId}`, async () => (await ordersApi.timeline(orderId)).data as OrderTimelineData, { staleMs: 15_000 });
    return <Loadable state={state} skeleton={<Skeleton rows={4} height={64} />}>{(data) => <Trace data={data} />}</Loadable>;
};
