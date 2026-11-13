import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { hubExceptionsApi, manifestsApi, systemAlertsApi } from '../../../../lib/api';
import type { Hub, HubExceptionItem, HubExceptionList } from '../../../../types/index';
import { ageLabel, dueLabel, exceptionExplain, MIN_NOTE_LENGTH } from '../../../os/lib/exceptions';
import { KEYS } from '../../lib/data';
import { AREA_LABEL, exceptionArea, exceptionMode, exceptionTone, systemActionFor, type DecisionArea, type Pile, type SystemAction } from '../../lib/decisions';
import { invalidate, type UseResourceResult } from '../../lib/resource';
import type { Tone } from '../../lib/trips';
import { IconArrowRight, IconCompass } from '../../ui/icons';
import { Button, Chip, EmptyState, Loadable, ModeBadge, Panel, Pill, Skeleton, TextArea } from '../../ui/kit';
import { useAction } from '../../ui/overlay';

/**
 * Fila do Copilot: só o que precisa de uma pessoa. Cada item abre no lugar, com o porquê e a
 * ação que resolve ao lado — a pessoa decide sem trocar de tela.
 */

type Filter = 'all' | 'overdue' | DecisionArea;

const TONE_WEIGHT: Record<Tone, number> = { red: 2, yellow: 1, royal: 0, neutral: 0 };

type Entry = { kind: 'exception'; item: HubExceptionItem; tone: Tone; area: DecisionArea } | { kind: 'pile'; pile: Pile; tone: Tone; area: DecisionArea };

function runSystemAction(action: SystemAction, item: HubExceptionItem): Promise<unknown> {
    if (action.type === 'retryFiscalClosure') return manifestsApi.retryFiscalClosure(action.manifestId);
    if (action.type === 'resumeCteQueue') return systemAlertsApi.resumeCteQueue(item.id);
    return systemAlertsApi.resumeDistribuicaoNfeQueue(item.id);
}

const ExceptionBody: React.FC<{ item: HubExceptionItem }> = ({ item }) => {
    const { busy, run } = useAction();
    const [noteOpen, setNoteOpen] = useState(false);
    const [note, setNote] = useState('');
    const explain = exceptionExplain(item.category);
    const action = systemActionFor(item);
    const refresh = () => invalidate(KEYS.exceptions, KEYS.manifests, KEYS.resolvedAlerts);

    const resolve = async () => {
        const ok = await run('resolve', () => hubExceptionsApi.resolve(item.id, note.trim()), { success: 'Pendência resolvida e registrada no histórico.' });
        if (ok) refresh();
    };

    return (
        <div className="gx-fade flex flex-col gap-4 px-3.5 pb-4 pt-1">
            <p className="gx-soft max-w-[70ch] text-[14.5px]">{item.message}</p>

            {action ? (
                <div className="rounded-2xl px-4 py-3.5" style={{ background: 'var(--gx-royal-soft)', boxShadow: 'inset 0 0 0 1px var(--gx-royal-line)' }}>
                    <p className="gx-label gx-royal-text flex items-center gap-1.5">
                        <IconCompass size={14} /> Copilot sugere
                    </p>
                    <p className="mt-1.5 text-[16px] font-semibold leading-snug">{action.label}</p>
                    <p className="gx-soft mt-1 max-w-[68ch] text-[13.5px]">{action.why}</p>
                </div>
            ) : (
                <div className="gx-inset px-4 py-3">
                    <p className="gx-label">O que fazer</p>
                    <p className="mt-1 max-w-[68ch] text-[14px]">{explain.what}</p>
                </div>
            )}

            {noteOpen ? (
                <div className="flex flex-col gap-2.5">
                    <TextArea
                        autoFocus
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="Conte o que foi apurado e feito. Fica no histórico."
                        aria-label="Nota de resolução"
                    />
                    <div className="flex flex-wrap items-center gap-2.5">
                        <Button variant="primary" loading={busy === 'resolve'} disabled={note.trim().length < MIN_NOTE_LENGTH} onClick={resolve}>
                            Resolver com esta nota
                        </Button>
                        <Button onClick={() => setNoteOpen(false)}>Voltar</Button>
                        <span className="gx-muted text-[12.5px]">Mínimo de {MIN_NOTE_LENGTH} caracteres.</span>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-2.5">
                    {action ? (
                        <Button
                            variant="primary"
                            loading={busy === 'system'}
                            onClick={async () => {
                                const ok = await run('system', () => runSystemAction(action, item), { success: 'Feito. O sistema voltou a tocar sozinho.' });
                                if (ok) refresh();
                            }}
                        >
                            {action.label}
                        </Button>
                    ) : null}
                    {item.manifestId ? (
                        <Link to={`/gestaos/viagens?v=${item.manifestId}`} className={action ? 'gx-btn gx-btn-ghost' : 'gx-btn gx-btn-primary'}>
                            Abrir viagem
                        </Link>
                    ) : null}
                    {item.orderId ? (
                        <Link to={`/gestaos/pedidos?p=${item.orderId}`} className={action || item.manifestId ? 'gx-btn gx-btn-ghost' : 'gx-btn gx-btn-primary'}>
                            Abrir pedido
                        </Link>
                    ) : null}
                    <Button onClick={() => setNoteOpen(true)}>Resolver com nota</Button>
                    {item.status === 'OPEN' ? (
                        <Button
                            loading={busy === 'ack'}
                            onClick={async () => {
                                const ok = await run('ack', () => hubExceptionsApi.acknowledge(item.id), { success: 'Marcado como ciente. Continua na fila até ser resolvido.' });
                                if (ok) refresh();
                            }}
                        >
                            Estou ciente
                        </Button>
                    ) : (
                        <Pill>ciente</Pill>
                    )}
                </div>
            )}
        </div>
    );
};

export const DecisionQueue: React.FC<{
    exceptions: UseResourceResult<HubExceptionList>;
    piles: Pile[];
    hubs: Hub[] | null;
    now: Date;
}> = ({ exceptions, piles, hubs, now }) => {
    const [filter, setFilter] = useState<Filter>('all');
    const [openId, setOpenId] = useState<string | null>(null);

    const hubCode = useMemo(() => new Map((hubs ?? []).map((hub) => [hub.id, hub.code])), [hubs]);

    const entries = useMemo<Entry[]>(() => {
        const fromExceptions: Entry[] = (exceptions.data?.items ?? []).map((item) => ({ kind: 'exception', item, tone: exceptionTone(item), area: exceptionArea(item.category) }));
        const fromPiles: Entry[] = piles.map((pile) => ({ kind: 'pile', pile, tone: pile.tone, area: pile.area }));
        // Ordenação estável: travado, atenção, o resto. Dentro de cada faixa vale a ordem de prazo do servidor.
        return [...fromExceptions, ...fromPiles].sort((a, b) => TONE_WEIGHT[b.tone] - TONE_WEIGHT[a.tone]);
    }, [exceptions.data, piles]);

    const counts = useMemo(() => {
        const base = { all: entries.length, overdue: 0, fiscal: 0, operacao: 0, financeiro: 0, comercial: 0, rede: 0 } as Record<Filter, number>;
        for (const entry of entries) {
            base[entry.area] += 1;
            if (entry.kind === 'exception' ? entry.item.overdue : entry.tone === 'red') base.overdue += 1;
        }
        return base;
    }, [entries]);

    const visible = entries.filter((entry) => {
        if (filter === 'all') return true;
        if (filter === 'overdue') return entry.kind === 'exception' ? entry.item.overdue : entry.tone === 'red';
        return entry.area === filter;
    });

    const areas = (Object.keys(AREA_LABEL) as DecisionArea[]).filter((area) => counts[area] > 0);

    return (
        <Panel
            title="Precisa de você"
            mode="copilot"
            count={exceptions.data ? entries.length : null}
            countTone={counts.overdue > 0 ? 'red' : 'neutral'}
            hint="Só exceção e decisão. O que seguiu o padrão, o sistema tocou."
            padded={false}
        >
            <div className="flex flex-wrap gap-2 px-5 pb-3">
                <Chip active={filter === 'all'} count={counts.all} onClick={() => setFilter('all')}>
                    Todas
                </Chip>
                {counts.overdue > 0 ? (
                    <Chip active={filter === 'overdue'} count={counts.overdue} onClick={() => setFilter('overdue')}>
                        Vencidas
                    </Chip>
                ) : null}
                {areas.map((area) => (
                    <Chip key={area} active={filter === area} count={counts[area]} onClick={() => setFilter(area)}>
                        {AREA_LABEL[area]}
                    </Chip>
                ))}
            </div>

            <div className="px-2 pb-2">
                <Loadable state={exceptions} skeleton={<Skeleton rows={5} height={58} className="px-3 pb-3" />}>
                    {() =>
                        visible.length === 0 ? (
                            <EmptyState
                                className="mx-3 mb-3"
                                title={entries.length === 0 ? 'Nada esperando você.' : 'Nada neste filtro.'}
                                hint={entries.length === 0 ? 'A rede está seguindo o padrão. O que o sistema resolveu aparece ao lado.' : undefined}
                            />
                        ) : (
                            <ul className="flex flex-col gap-0.5">
                                {visible.map((entry) =>
                                    entry.kind === 'pile' ? (
                                        <li key={entry.pile.id}>
                                            <Link to={entry.pile.to} className="gx-row flex flex-wrap items-center gap-x-4 gap-y-2">
                                                <span className="min-w-0 flex-1">
                                                    <span className="block font-semibold leading-snug">{entry.pile.title}</span>
                                                    <span className="gx-muted block text-[13px]">
                                                        {AREA_LABEL[entry.pile.area]} · {entry.pile.detail}
                                                    </span>
                                                </span>
                                                {entry.tone !== 'neutral' ? <Pill tone={entry.tone}>{entry.tone === 'red' ? 'vencido' : 'atenção'}</Pill> : null}
                                                <ModeBadge mode="manual" />
                                                <span className="gx-royal-text inline-flex items-center gap-1.5 text-[13.5px] font-semibold">
                                                    {entry.pile.cta} <IconArrowRight size={15} />
                                                </span>
                                            </Link>
                                        </li>
                                    ) : (
                                        <li key={entry.item.id}>
                                            <button
                                                type="button"
                                                className="gx-row flex flex-wrap items-center gap-x-4 gap-y-2"
                                                aria-expanded={openId === entry.item.id}
                                                onClick={() => setOpenId((current) => (current === entry.item.id ? null : entry.item.id))}
                                            >
                                                <span className="min-w-0 flex-1">
                                                    <span className="block font-semibold leading-snug">{entry.item.title}</span>
                                                    <span className="gx-muted block text-[13px]">
                                                        {entry.item.hubId ? <span className="gx-mono">{hubCode.get(entry.item.hubId) ?? 'hub'}</span> : 'Torre'} ·{' '}
                                                        {exceptionExplain(entry.item.category).group} · {ageLabel(entry.item, now)}
                                                    </span>
                                                </span>
                                                <Pill tone={entry.item.overdue ? 'red' : entry.tone === 'yellow' ? 'yellow' : 'neutral'} dot={entry.item.overdue}>
                                                    {dueLabel(entry.item, now)}
                                                </Pill>
                                                <ModeBadge mode={exceptionMode(entry.item)} />
                                            </button>
                                            {openId === entry.item.id ? <ExceptionBody item={entry.item} /> : null}
                                        </li>
                                    ),
                                )}
                            </ul>
                        )
                    }
                </Loadable>
            </div>
        </Panel>
    );
};
