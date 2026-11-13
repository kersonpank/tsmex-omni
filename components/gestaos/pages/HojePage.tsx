import React, { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../../store/authStore';
import { buildAutopilotFeed } from '../lib/autopilot';
import { useExceptions, useHubs, useManifests, useOperationsSummary, usePayables, usePendingCarriers, useResolvedAlerts, useUnbilledFreight } from '../lib/data';
import { buildPiles } from '../lib/decisions';
import { greeting, longDate, plural, relative } from '../lib/format';
import { Glass, ModeBadge } from '../ui/kit';
import { AutopilotFeed } from './hoje/AutopilotFeed';
import { DecisionQueue } from './hoje/DecisionQueue';
import { NetworkPulse } from './hoje/NetworkPulse';
import { TripBoard } from './hoje/TripBoard';

/**
 * Hoje — a tela de abertura da torre.
 * Pergunta: "o que precisa de mim agora, e o que o sistema já resolveu sozinho?"
 * Esquerda: fila do Copilot (decisão). Direita: feed do Autopilot (trabalho pronto).
 */

function useNow(everyMs = 60_000): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), everyMs);
        return () => window.clearInterval(timer);
    }, [everyMs]);
    return now;
}

const HojePage: React.FC = () => {
    const now = useNow();
    const user = useAuthStore((state) => state.user);
    const firstName = (user?.profile?.admin?.name as string | undefined)?.trim().split(/\s+/)[0];

    const exceptions = useExceptions();
    const manifests = useManifests();
    const payables = usePayables();
    const resolvedAlerts = useResolvedAlerts();
    const summary = useOperationsSummary();
    const unbilled = useUnbilledFreight();
    const carriers = usePendingCarriers();
    const hubs = useHubs();

    const feed = useMemo(
        () => buildAutopilotFeed({ manifests: manifests.data, payables: payables.data, resolvedAlerts: resolvedAlerts.data }, now),
        [manifests.data, payables.data, resolvedAlerts.data, now],
    );

    const piles = useMemo(
        () =>
            buildPiles(
                {
                    pendingCarriers: carriers.data?.length ?? null,
                    invoiceable: unbilled.data ?? null,
                    payables: payables.data ?? null,
                    quotesPending: summary.data?.cenario.aguardandoCotacao ?? null,
                },
                now,
            ),
        [carriers.data, unbilled.data, payables.data, summary.data, now],
    );

    const exceptionCount = exceptions.data?.counts.total ?? 0;
    const overdue = exceptions.data?.counts.overdue ?? 0;
    const decisions = exceptionCount + piles.length;
    const nextDue = (exceptions.data?.items ?? []).find((item) => !item.overdue && item.dueAt)?.dueAt ?? null;

    const feedLoading = manifests.loading || payables.loading || resolvedAlerts.loading;
    const feedError = manifests.error ?? payables.error ?? resolvedAlerts.error;
    const retryFeed = () => {
        void manifests.reload();
        void payables.reload();
        void resolvedAlerts.reload();
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="gx-rise">
                <p className="gx-label">{longDate(now)}</p>
                <h1 className="gx-h1 mt-2">
                    {greeting(now)}
                    {firstName ? `, ${firstName}` : ''}.
                </h1>
                <p className="gx-question mt-2">O que seguiu o padrão, o sistema tocou. Aqui fica só o que depende de você.</p>
            </header>

            <Glass className="gx-rise grid grid-cols-1 overflow-hidden md:grid-cols-2">
                <div className="gx-tint-auto px-6 py-5" style={{ border: 0, borderRadius: 0 }}>
                    <ModeBadge mode="auto" />
                    <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="gx-num gx-royal-text text-[44px] leading-none">{feedLoading ? '—' : feed.length}</span>
                        <span className="text-[15.5px] font-semibold">{feed.length === 1 ? 'execução do sistema' : 'execuções do sistema'} em 7 dias</span>
                    </p>
                    <p className="gx-soft mt-2 text-[13.5px]">Documentos encerrados, títulos gerados e alertas fechados sem ninguém tocar.</p>
                </div>
                <div className="gx-hair-t px-6 py-5 md:border-t-0" style={{ borderLeft: '1px solid var(--gx-hair)' }}>
                    <ModeBadge mode="copilot" />
                    <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={`gx-num text-[44px] leading-none ${overdue > 0 ? 'gx-red-text' : ''}`}>{exceptions.loading ? '—' : decisions}</span>
                        <span className="text-[15.5px] font-semibold">{decisions === 1 ? 'decisão esperando você' : 'decisões esperando você'}</span>
                    </p>
                    <p className="gx-soft mt-2 text-[13.5px]">
                        {overdue > 0 ? <span className="gx-red-text font-semibold">{plural(overdue, 'vencida', 'vencidas')}. </span> : null}
                        {nextDue ? `A próxima vence ${relative(nextDue, now)}.` : decisions > 0 ? 'Nenhuma com prazo próximo.' : 'A rede está seguindo o padrão.'}
                    </p>
                </div>
            </Glass>

            <div className="gx-stagger grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                    <DecisionQueue exceptions={exceptions} piles={piles} hubs={hubs.data} now={now} />
                </div>
                <div className="lg:col-span-5">
                    <AutopilotFeed events={feed} loading={feedLoading} error={feedError} onRetry={retryFeed} now={now} />
                </div>
            </div>

            <div className="gx-stagger flex flex-col gap-6">
                <NetworkPulse summary={summary} manifests={manifests.data} />
                <TripBoard manifests={manifests} now={now} />
            </div>
        </div>
    );
};

export default HojePage;
