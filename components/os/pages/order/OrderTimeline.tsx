import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ordersApi } from '../../../../lib/api';
import { formatDateTimeBR } from '../../lib/dateBR';
import { nextSteps, timelineEvents, whereNow, type OrderTimelineData, type TimelineEvent, type TimelineKind } from '../../lib/timeline';
import { OsCard, OsErrorNotice, OsSkeletonRows } from '../../ui/kit';
import { IconAlert, IconCheck, IconDeliver, IconReceive, IconTag, IconTruck, IconX, type OsIconProps } from '../../ui/icons';
import { apiErrorMessage } from '../../ui/Sheet';

const ICONS: Record<TimelineKind, React.FC<OsIconProps>> = {
    created: IconTag, collected: IconReceive, stock: IconReceive, departed: IconTruck, out_for_delivery: IconDeliver, delivered: IconCheck,
    delivery_failed: IconAlert, vehicle_arrived: IconTruck, damage: IconAlert, missing: IconX, resolved: IconCheck, cancelled: IconX, note: IconTag,
};

const TONE = {
    ok: 'bg-emerald-600/10 text-emerald-800 dark:text-emerald-200',
    route: 'bg-brand-500/10 text-brand-800 dark:text-brand-100',
    attention: 'bg-brand-yellow-400/20 text-tower-900 dark:text-brand-yellow-400',
    bad: 'bg-brand-red-500/10 text-brand-red-700 dark:text-brand-red-400',
    none: 'bg-tower-100 text-tower-800 dark:bg-tower-800 dark:text-tower-100',
} as const;

const Event: React.FC<{ event: TimelineEvent }> = ({ event }) => {
    const Icon = ICONS[event.kind];
    return (
        <li className={clsx('flex gap-3 rounded-lg p-2.5', event.highlight && 'border-l-4 border-brand-red-500 bg-brand-red-500/8')}>
            <span className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', event.highlight ? 'bg-brand-red-500 text-white' : 'bg-tower-100 text-tower-600 dark:bg-tower-800 dark:text-tower-300')}>
                <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-snug text-tower-900 dark:text-white">{event.title}</p>
                {event.detail ? <p className="mt-0.5 text-[13px] leading-snug text-tower-600 dark:text-tower-300">{event.detail}</p> : null}
                <p className="mt-0.5 text-[12px] text-tower-500 dark:text-tower-400">
                    {formatDateTimeBR(event.at)}
                    {event.where ? ` · ${event.where}` : ''}
                    {event.actor ? ` · por ${event.actor}` : ''}
                </p>
                {event.photoUrl ? (
                    <a href={event.photoUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block min-h-8 text-[12px] font-bold text-brand-600 underline dark:text-brand-300">Ver foto</a>
                ) : null}
            </div>
        </li>
    );
};

/** Rastreio do pedido: onde está agora, próximos passos e a linha do tempo (mais recente primeiro). */
const OrderTimeline: React.FC<{ orderId: string }> = ({ orderId }) => {
    const [data, setData] = useState<OrderTimelineData | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = () => {
        setError(null);
        ordersApi
            .timeline(orderId)
            .then((body) => setData(body.data as OrderTimelineData))
            .catch((cause) => setError(apiErrorMessage(cause, 'Não foi possível carregar o rastreio.')));
    };
    useEffect(() => {
        setData(null);
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId]);

    if (error) return <OsErrorNotice message={error} onRetry={load} />;
    if (!data) return <OsSkeletonRows count={2} />;

    const now = whereNow(data);
    const next = nextSteps(data);
    const events = timelineEvents(data);
    return (
        <div>
            <div className={clsx('rounded-xl p-3.5', TONE[now.tone])} role="status">
                <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">Onde está agora</p>
                <p className="mt-0.5 text-[15px] font-bold leading-snug">{now.headline}</p>
                {now.detail ? <p className="mt-1 text-[13px] font-semibold">{now.detail}</p> : null}
            </div>
            {next.length > 0 ? (
                <OsCard className="mt-2.5 !p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-tower-500 dark:text-tower-400">Próximos passos</p>
                    <ul className="mt-1 space-y-1">
                        {next.map((step) => <li key={step} className="text-[13px] text-tower-700 dark:text-tower-200">{step}</li>)}
                    </ul>
                </OsCard>
            ) : null}
            {events.length === 0 ? (
                <p className="mt-3 text-[13px] text-tower-500">Ainda não há eventos registrados para este pedido.</p>
            ) : (
                <ol className="mt-2.5 flex flex-col gap-1" aria-label="Linha do tempo do pedido">
                    {events.map((event) => <Event key={event.id} event={event} />)}
                </ol>
            )}
        </div>
    );
};

export default OrderTimeline;
