import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { manifestsApi, ordersApi } from '../../../../lib/api';
import type { ManifestReadiness, ResolvedOrderSummary } from '../../../../types/index';
import { useOs } from '../../OsContext';
import type { ManifestWithLegs } from '../../lib/arrival';
import { docBadge, legsWithoutDoc, orderLabel } from '../../lib/readiness';
import { tripNextStep, type TripNextStepAction } from '../../lib/nextStep';
import { GROUP_TITLES, groupIssues, occupancy, primaryAction, STATUS_LABEL, type TripGroupKey } from '../../lib/trip';
import { OsActionBar, OsBadge, OsButton, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';
import ResponsibleEditor from './ResponsibleEditor';
import { DepartureEditor, EmitterEditor, FreightEditor } from './TripEditors';
import TripDocumentsSheet, { type TripDocumentResolution, type TripDocumentStep } from './TripDocumentsSheet';
import TripInfoEditor from './TripInfoEditor';

/**
 * PREPARAR E DESPACHAR — pergunta: "o que falta para esta viagem sair?"
 * Fila de pendências vinda do motor (readiness), uma ação por grupo, e a ação primária
 * que muda com a situação: confirmar transportador → registrar saída (hub em nome do Link).
 */

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const Bar: React.FC<{ label: string; pct: number | null }> = ({ label, pct }) => (
    <div className="flex items-center gap-2 text-[12px]">
        <span className="w-14 shrink-0 text-brand-100">{label}</span>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/20">
            <span
                className={`block h-full rounded-full ${pct != null && pct > 100 ? 'bg-brand-red-400' : 'bg-brand-yellow-400'}`}
                style={{ width: `${Math.min(100, pct ?? 0)}%` }}
            />
        </span>
        <span className="w-10 shrink-0 text-right font-bold text-white">{pct == null ? '–' : `${pct}%`}</span>
    </div>
);

const TripPrepPage: React.FC = () => {
    const { manifestId = '' } = useParams<{ manifestId: string }>();
    const { hubId } = useOs();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const [manifest, setManifest] = useState<ManifestWithLegs | null>(null);
    const [readiness, setReadiness] = useState<ManifestReadiness | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<TripGroupKey | null>(null);
    const [docStep, setDocStep] = useState<TripDocumentStep>('cte');
    const [startOpen, setStartOpen] = useState(false);
    const [km, setKm] = useState('');
    const [acting, setActing] = useState(false);
    const [addCode, setAddCode] = useState('');
    const [candidates, setCandidates] = useState<ResolvedOrderSummary[]>([]);

    const load = useCallback(async () => {
        setError(null);
        try {
            const [m, r] = await Promise.all([
                manifestsApi.getById(manifestId),
                manifestsApi.readiness(manifestId).catch(() => null),
            ]);
            setManifest((m.data as ManifestWithLegs) ?? null);
            setReadiness(r?.data ?? null);
        } catch {
            setError('Não foi possível carregar a viagem.');
        } finally {
            setLoading(false);
        }
    }, [manifestId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (params.get('cadastro') === '1') setOpen('registry');
    }, [params]);

    if (loading) return <OsSkeletonRows count={4} />;
    if (!manifest) return <OsErrorNotice message={error ?? 'Viagem não encontrada.'} onRetry={() => void load()} />;

    const groups = groupIssues(readiness?.issues ?? []);
    const primary = primaryAction(manifest.status, readiness);
    const occ = occupancy(manifest.totalWeight, manifest.totalVolume, manifest.vehicleType?.maxWeight, manifest.vehicleType?.maxVolume);
    const openGroup = groups.find((g) => g.key === open)
        ?? (open === 'registry' ? { key: 'registry' as const, title: GROUP_TITLES.registry, blocking: [], warnings: [] } : null);
    const closeAndReload = () => {
        setOpen(null);
        if (params.has('cadastro')) {
            const nextParams = new URLSearchParams(params);
            nextParams.delete('cadastro');
            setParams(nextParams, { replace: true });
        }
        void load();
    };

    const run = async (fn: () => Promise<unknown>, fallback: string) => {
        setActing(true);
        setError(null);
        try {
            await fn();
            await load();
        } catch (cause) {
            setError(apiErrorMessage(cause, fallback));
            await load();
        } finally {
            setActing(false);
        }
    };

    const addOrder = (orderId: string) =>
        run(async () => {
            await manifestsApi.addDemand(manifest.id, { orderId });
            setAddCode('');
            setCandidates([]);
        }, 'Não foi possível adicionar o pedido.');

    const resolveAndAdd = async () => {
        const code = addCode.trim();
        if (!code || acting) return;
        setActing(true);
        setError(null);
        try {
            const found = await ordersApi.resolve(code, manifest.id);
            if (found.match === 'single') {
                await manifestsApi.addDemand(manifest.id, { orderId: found.order.id });
                setAddCode('');
                setCandidates([]);
                await load();
            } else if (found.match === 'multiple') {
                setCandidates(found.candidates);
            } else {
                setError('Nenhum pedido encontrado para este número ou chave.');
            }
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível adicionar o pedido.'));
        } finally {
            setActing(false);
        }
    };

    const removeOrder = (demandId: string | undefined, label: string) => {
        if (!demandId || !window.confirm(`Remover ${label} da viagem?`)) return;
        void run(() => manifestsApi.removeDemand(manifest.id, demandId), 'Não foi possível remover o pedido.');
    };

    const onPrimary = () => {
        if (primary.kind === 'confirm') {
            void run(async () => {
                await manifestsApi.offer(manifest.id);
                await manifestsApi.accept(manifest.id);
            }, 'Não foi possível confirmar o transportador.');
        } else if (primary.kind === 'accept') {
            void run(() => manifestsApi.accept(manifest.id), 'Não foi possível confirmar pelo transportador.');
        } else if (primary.kind === 'start') {
            setStartOpen(true);
        }
    };

    const next = tripNextStep(manifest, readiness);
    const openNext = (action: TripNextStepAction = next.action) => {
        if (action === 'responsible' || action === 'freight' || action === 'departure' || action === 'emitter' || action === 'registry') {
            setOpen(action);
        } else if (action === 'documents_cte' || action === 'documents_ciot' || action === 'documents_mdfe') {
            setDocStep(action === 'documents_ciot' ? 'ciot' : action === 'documents_mdfe' ? 'mdfe' : 'cte');
            setOpen('documents');
        } else if (action === 'confirm' || action === 'start') {
            onPrimary();
        } else {
            void load();
        }
    };
    const resolveFromDocuments = (group: TripDocumentResolution) => {
        if (group === 'confirm') {
            setOpen(null);
            onPrimary();
        } else {
            setOpen(group);
        }
    };

    const confirmStart = () => {
        const kmSaida = km.trim() ? Number(km.replace(/\D/g, '')) : undefined;
        setStartOpen(false);
        void run(() => manifestsApi.start(manifest.id, kmSaida ? { kmSaida } : undefined), 'Não foi possível registrar a saída.');
    };

    const legs = manifest.legs ?? [];
    const editable = manifest.status === 'DRAFT';
    const noDocLegs = legsWithoutDoc(legs);
    const orderLabels = Object.fromEntries(legs.map((l) => [l.orderId, orderLabel(l.order, l.orderId)]));

    return (
        <div className="pb-44">
            <div className="mb-4 rounded-xl bg-brand-500 p-4 text-white dark:bg-brand-600">
                <p className="font-display text-[17px] font-bold leading-snug">
                    {manifest.origin} → {manifest.destination}
                </p>
                <p className="mt-0.5 text-[13px] text-brand-100">
                    {STATUS_LABEL[manifest.status]} · {manifest.vehicleType?.name ?? 'veículo'}
                    {manifest.link?.name ? ` · ${manifest.link.name}` : ''}
                </p>
                <div className="mt-3 flex flex-col gap-1.5">
                    <Bar label="Peso" pct={occ.weightPct} />
                    <Bar label="Volume" pct={occ.volumePct} />
                </div>
            </div>

            {error ? (
                <div className="mb-3">
                    <OsErrorNotice message={error} />
                </div>
            ) : null}

            {['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED'].includes(manifest.status) ? (
                <div className="mb-4 rounded-xl border-2 border-brand-400 bg-brand-50 p-3.5 dark:border-brand-500 dark:bg-tower-800" aria-label="Próximo passo">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">Próximo passo</p>
                    <p className="mt-0.5 font-display text-[16px] font-bold text-tower-900 dark:text-white">{next.label}</p>
                    <p className="mt-0.5 text-[13px] text-tower-600 dark:text-tower-300">{next.hint}</p>
                    <div className="mt-2.5">
                        <OsButton full disabled={acting} onClick={() => openNext()}>
                            {next.action === 'none' ? 'Atualizar' : next.label}
                        </OsButton>
                    </div>
                </div>
            ) : null}

            {['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED'].includes(manifest.status) ? (
                <>
                    <OsSectionTitle>Falta para sair</OsSectionTitle>
                    {groups.length === 0 ? (
                        <OsEmpty title="Nada pendente" detail="Use o botão abaixo para seguir." />
                    ) : (
                        <div className="flex flex-col gap-2.5">
                            {groups.map((g) => (
                                <OsRow key={g.key} tone={g.blocking.length ? 'bad' : 'attention'} onClick={() => setOpen(g.key)}>
                                    <div className="flex items-center justify-between gap-2 pr-1">
                                        <p className="truncate font-semibold text-tower-900 dark:text-white">{g.title}</p>
                                        <OsBadge tone={g.blocking.length ? 'bad' : 'warn'}>
                                            {g.blocking.length ? `${g.blocking.length} bloqueio(s)` : 'aviso'}
                                        </OsBadge>
                                    </div>
                                    <p className="mt-0.5 line-clamp-2 text-[13px] text-tower-500 dark:text-tower-400">
                                        {(g.blocking[0] ?? g.warnings[0]).message}
                                    </p>
                                    {g.key === 'documents' && noDocLegs.length > 0 ? (
                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                            {noDocLegs.map((leg) => (
                                                <button
                                                    key={leg.orderId}
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate(`/hubs/pedidos/${leg.orderId}`);
                                                    }}
                                                    className="min-h-[32px] rounded-md bg-brand-red-500/10 px-2 text-[12px] font-bold text-brand-red-600 dark:text-brand-red-400"
                                                >
                                                    {orderLabels[leg.orderId]}
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </OsRow>
                            ))}
                        </div>
                    )}
                </>
            ) : null}

            {['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED'].includes(manifest.status) && manifest.fiscalEmitterId ? (
                <p className="mb-3 flex flex-wrap items-center gap-x-2 text-[13px] text-tower-600 dark:text-tower-300">
                    <span>
                        Emitente: <strong className="text-tower-900 dark:text-white">{manifest.fiscalEmitter?.displayName ?? manifest.fiscalEmitter?.tradeName ?? 'definido'}</strong> · automático
                    </span>
                    <button type="button" onClick={() => setOpen('emitter')} className="font-bold text-brand-700 underline dark:text-brand-300">
                        Trocar
                    </button>
                </p>
            ) : null}

            <OsSectionTitle>Carga ({legs.length})</OsSectionTitle>
            {legs.length === 0 ? (
                <OsEmpty title="Sem pedidos" detail="Monte a viagem a partir da fila em Viagens." />
            ) : (
                <div className="flex flex-col gap-2">
                    {legs.map((leg) => {
                        const doc = docBadge(leg.order?.freightDocState);
                        return (
                            <OsRow key={leg.id} tone={doc.tone === 'ok' ? 'ok' : 'attention'} onClick={() => navigate(`/hubs/pedidos/${leg.orderId}`)}>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-[14px] font-semibold text-tower-900 dark:text-white">
                                        {leg.order?.demand?.orderNumber ? `Pedido ${leg.order.demand.orderNumber}` : 'Pedido'}
                                        {leg.order?.nfNumber ? <span className="font-mono text-[13px] font-medium text-tower-500"> · NF {leg.order.nfNumber}</span> : null}
                                    </p>
                                    <OsBadge tone={doc.tone}>{doc.label}</OsBadge>
                                </div>
                                {leg.order?.demand?.destination ? (
                                    <p className="truncate text-[12px] text-tower-500 dark:text-tower-400">{leg.order.demand.destination}</p>
                                ) : null}
                                {editable ? (
                                    <button
                                        type="button"
                                        disabled={acting}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeOrder(leg.order?.demand?.id, orderLabels[leg.orderId]);
                                        }}
                                        className="mt-1 min-h-[36px] text-[13px] font-bold text-brand-red-600 disabled:opacity-50 dark:text-brand-red-400"
                                    >
                                        Remover
                                    </button>
                                ) : null}
                            </OsRow>
                        );
                    })}
                </div>
            )}
            <p className="mt-2 text-[12px] text-tower-400">
                {nf0.format(manifest.totalWeight)} kg · {nf0.format(manifest.totalVolume)} m³
            </p>

            {editable ? (
                <div className="mt-3">
                    <label className="block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                        Adicionar pedido
                        <div className="mt-1.5 flex gap-2">
                            <input
                                value={addCode}
                                onChange={(e) => setAddCode(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && void resolveAndAdd()}
                                placeholder="Número do pedido ou chave da NF-e"
                                inputMode="search"
                                className={osFieldClass}
                            />
                            <OsButton disabled={acting || !addCode.trim()} onClick={() => void resolveAndAdd()}>
                                Adicionar
                            </OsButton>
                        </div>
                    </label>
                    {candidates.length > 0 ? (
                        <div className="mt-2 flex flex-col gap-2">
                            <p className="text-[12px] text-tower-500">Mais de um pedido encontrado. Toque no correto:</p>
                            {candidates.map((c) => (
                                <OsRow key={c.id} onClick={() => void addOrder(c.id)}>
                                    <p className="truncate text-[14px] font-semibold text-tower-900 dark:text-white">
                                        {orderLabel({ nfNumber: c.nfNumber, demand: { orderNumber: c.orderNumber } }, c.id)}
                                    </p>
                                    {c.destination ? <p className="truncate text-[12px] text-tower-500">{c.destination}</p> : null}
                                </OsRow>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}

            <OsActionBar>
                {primary.hint ? <p className="mb-2 text-center text-[12px] font-semibold text-tower-500 dark:text-tower-300">{primary.hint}</p> : null}
                <OsButton full disabled={!primary.enabled || acting} onClick={onPrimary}>
                    {acting ? 'Processando…' : primary.label}
                </OsButton>
            </OsActionBar>

            {open === 'responsible' && editable ? (
                <ResponsibleEditor manifestId={manifest.id} currentLinkId={manifest.linkId} onClose={() => setOpen(null)} onSaved={closeAndReload} />
            ) : open === 'departure' ? (
                <DepartureEditor
                    manifestId={manifest.id}
                    departure={manifest.plannedDepartureAt}
                    arrival={manifest.plannedArrivalAt}
                    onClose={() => setOpen(null)}
                    onSaved={closeAndReload}
                />
            ) : open === 'freight' ? (
                <FreightEditor manifestId={manifest.id} onClose={() => setOpen(null)} onSaved={closeAndReload} />
            ) : open === 'emitter' ? (
                <EmitterEditor
                    manifestId={manifest.id}
                    hubId={manifest.hubId ?? hubId ?? ''}
                    current={manifest.fiscalEmitterId}
                    onClose={() => setOpen(null)}
                    onSaved={closeAndReload}
                />
            ) : open === 'documents' ? (
                <TripDocumentsSheet
                    manifest={manifest}
                    readiness={readiness}
                    initialStep={docStep}
                    onClose={closeAndReload}
                    onUpdated={load}
                    onResolve={resolveFromDocuments}
                />
            ) : openGroup ? (
                <TripInfoEditor manifestId={manifest.id} group={openGroup} onClose={closeAndReload} onUpdated={load} />
            ) : null}

            {startOpen ? (
                <OsSheet
                    title="Registrar saída"
                    subtitle="O hub registra a saída em nome do transportador"
                    onClose={() => setStartOpen(false)}
                    footer={
                        <OsButton full onClick={confirmStart}>
                            Confirmar saída
                        </OsButton>
                    }
                >
                    <label className="block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                        Km de saída (opcional)
                        <input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} className={`${osFieldClass} mt-1.5`} />
                    </label>
                </OsSheet>
            ) : null}
        </div>
    );
};

export default TripPrepPage;
