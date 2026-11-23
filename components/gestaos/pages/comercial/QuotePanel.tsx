import React, { useState } from 'react';
import { demandsApi } from '../../../../lib/api';
import type { Demand } from '../../../../types/index';
import { demandStep } from '../../lib/comercialFunnel';
import { demandClientName, demandStatusLabel, quoteViewStatus, type QuoteView } from '../../lib/comercial';
import { cityOnly, kg, money, relative } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { KEYS } from '../../lib/data';
import { Button, Chip, EmptyState, Loadable, Panel, Pill, Skeleton } from '../../ui/kit';
import { useAction } from '../../ui/overlay';
import { QuoteDrawer } from './QuoteDrawer';

const VIEWS: Array<{ id: QuoteView; label: string }> = [
    { id: 'PENDING', label: 'Aguardando cotação' },
    { id: 'QUOTED', label: 'Cotadas' },
    { id: 'APPROVED', label: 'Aprovadas' },
    { id: 'ALL', label: 'Todas' },
];

const HINT: Record<QuoteView, string> = {
    PENDING: 'Clientes esperando um preço. Mais antigas primeiro.',
    QUOTED: 'Já têm preço. Aguardam a resposta do cliente.',
    APPROVED: 'O cliente aceitou o preço. Falta consolidar em viagem.',
    ALL: 'Todas as demandas, da mais recente para a mais antiga.',
};

const PAGE = 50;

/** Mais antigas primeiro na fila de cotação; nas demais visões, as mais recentes. */
function ordered(rows: Demand[], view: QuoteView): Demand[] {
    const time = (d: Demand) => new Date(d.createdAt).getTime() || 0;
    return [...rows].sort((a, b) => (view === 'PENDING' ? time(a) - time(b) : time(b) - time(a)));
}

const Row: React.FC<{ demand: Demand; onQuote: () => void; busy: string | null; onAdvance: (demand: Demand) => Promise<boolean> }> = ({ demand, onQuote, busy, onAdvance }) => {
    const step = demandStep(demand.status);
    const [confirming, setConfirming] = useState(false);
    const key = `advance:${demand.id}`;
    return (
    <li className="gx-hair-b flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 last:border-b-0">
        <div className="min-w-0 flex-1 basis-64">
            <p className="truncate font-semibold">{demandClientName(demand)}</p>
            <p className="gx-soft mt-0.5 truncate text-[13.5px]">
                {cityOnly(demand.origin)} → {cityOnly(demand.destination)} · {demand.commodity || 'Mercadoria não informada'}
            </p>
            <p className="gx-muted mt-0.5 text-[12.5px]">
                {kg(demand.weight)} · {demand.volume != null ? `${demand.volume} m³` : '—'} · nota {money(demand.nfValue)}
            </p>
        </div>
        <div className="flex flex-none flex-col items-start gap-1.5 sm:items-end">
            {demand.status === 'PENDING' ? (
                <span className="gx-yellow-text text-[13px] font-semibold">Espera {relative(demand.createdAt).replace('há ', '')}</span>
            ) : (
                <Pill tone={demand.status === 'APPROVED' ? 'royal' : 'neutral'}>{demandStatusLabel(demand.status)}</Pill>
            )}
            {demand.quotedPrice != null ? <span className="gx-num text-[14px]">{money(demand.quotedPrice)}</span> : null}
        </div>
        {demand.status === 'PENDING' ? (
            <Button variant="primary" size="sm" onClick={onQuote} aria-label={`Cotar demanda de ${demandClientName(demand)}`}>
                Cotar
            </Button>
        ) : null}
        {step ? (
            <div className="flex flex-none flex-wrap items-center gap-2">
                {confirming ? (
                    <>
                        <span className="gx-soft text-[13px]">Isto gera o pedido da coleta.</span>
                        <Button size="sm" variant="primary" loading={busy === key} disabled={busy != null && busy !== key} onClick={() => void onAdvance(demand).then((ok) => ok && setConfirming(false))}>
                            Confirmar
                        </Button>
                        <Button size="sm" disabled={busy != null} onClick={() => setConfirming(false)}>
                            Voltar
                        </Button>
                    </>
                ) : (
                    <Button
                        size="sm"
                        variant="soft"
                        loading={busy === key}
                        disabled={busy != null && busy !== key}
                        aria-label={`${step.action}: demanda de ${demandClientName(demand)}`}
                        onClick={() => (step.needsConfirm ? setConfirming(true) : void onAdvance(demand))}
                    >
                        {step.action}
                    </Button>
                )}
            </div>
        ) : null}
    </li>
    );
};

export const QuotePanel: React.FC = () => {
    const [view, setView] = useState<QuoteView>('PENDING');
    const [limit, setLimit] = useState(PAGE);
    const [quoting, setQuoting] = useState<Demand | null>(null);
    const { busy, run } = useAction();

    const advance = async (demand: Demand) => {
        const step = demandStep(demand.status);
        if (!step) return false;
        const ok = await run(`advance:${demand.id}`, () => demandsApi.updateStatus(demand.id, { status: step.next, description: step.description }), {
            success: `${step.action}: registrado.`,
            error: 'O status não foi atualizado.',
        });
        // Mesmo com erro o servidor pode ter criado o pedido: renova para a lista dizer a verdade.
        invalidate('demands:', KEYS.summary);
        return ok;
    };

    const state = useResource(
        `demands:${view}:${limit}`,
        async () => {
            const response = await demandsApi.list({ status: quoteViewStatus(view), limit, offset: 0 });
            return { rows: response.data ?? [], total: response.pagination?.total ?? response.data?.length ?? 0 };
        },
        { refreshMs: 60_000 },
    );

    return (
        <Panel
            title="Aguardando cotação"
            hint={HINT[view]}
            mode="manual"
            count={view === 'PENDING' ? state.data?.total ?? null : null}
            countTone="yellow"
            padded={false}
        >
            <div className="flex flex-wrap gap-2 px-5 pb-3" role="group" aria-label="Ver demandas">
                {VIEWS.map((item) => (
                    <Chip
                        key={item.id}
                        active={view === item.id}
                        onClick={() => {
                            setView(item.id);
                            setLimit(PAGE);
                        }}
                    >
                        {item.label}
                    </Chip>
                ))}
            </div>
            <Loadable
                state={state}
                skeleton={<Skeleton className="px-5" rows={5} height={64} />}
                isEmpty={(data) => data.rows.length === 0}
                empty={
                    <div className="px-5 pb-3">
                        <EmptyState
                            title={view === 'PENDING' ? 'Ninguém esperando preço.' : 'Nenhuma demanda nesta visão.'}
                            hint={view === 'PENDING' ? 'Quando um cliente pedir cotação, ela aparece aqui.' : undefined}
                        />
                    </div>
                }
            >
                {(data) => (
                    <>
                        <ul>
                            {ordered(data.rows, view).map((demand) => (
                                <Row key={demand.id} demand={demand} onQuote={() => setQuoting(demand)} busy={busy} onAdvance={advance} />
                            ))}
                        </ul>
                        {data.total > data.rows.length ? (
                            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                                <span className="gx-muted text-[13px]">
                                    Mostrando {data.rows.length} de {data.total}
                                </span>
                                <Button size="sm" variant="soft" onClick={() => setLimit((current) => current + PAGE)}>
                                    Ver mais
                                </Button>
                            </div>
                        ) : null}
                    </>
                )}
            </Loadable>
            <QuoteDrawer demand={quoting} onClose={() => setQuoting(null)} />
        </Panel>
    );
};
