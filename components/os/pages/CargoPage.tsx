import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { hubCargoApi } from '../../../lib/api';
import type { ConsolidationQueueGroup, HubCargoBucket, HubCargoItem } from '../../../types/index';
import { useOs } from '../OsContext';
import { CARGO_BUCKETS, cargoFacts } from '../lib/cargo';
import { addressLine, canRequestCollection, collectionBadge } from '../lib/collection';
import { buildStockTripSelection } from '../lib/cargoTripSelection';
import { looksLikeAccessKey } from '../lib/intake';
import { useScanController } from '../useScanController';
import { useLongPress } from '../useLongPress';
import { OsActionBar, OsBadge, OsButton, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../ui/kit';
import { apiErrorMessage } from '../ui/Sheet';
import { IconReceive } from '../ui/icons';
import QueueGroupSheet from './QueueGroupSheet';


/**
 * CARGAS — estação de estoque e entrada. Pergunta única: "o que tenho aqui e
 * o que está esperando entrada?" Scan e busca são a porta de tudo.
 */

const PAGE = 30;

const CargoRow: React.FC<React.ComponentProps<typeof OsRow> & { onLongPress?: () => void }> = ({ onLongPress, ...props }) => {
    const press = useLongPress(() => onLongPress?.(), Boolean(onLongPress));
    return <OsRow {...props} {...press} />;
};

const CargoPage: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const selectRequested = searchParams.get('select') === '1';
    const { hubId, capabilities, summary, refresh } = useOs();
    const [bucket, setBucket] = useState<HubCargoBucket>('stock');
    const [q, setQ] = useState('');
    const [items, setItems] = useState<HubCargoItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [preparing, setPreparing] = useState(false);
    const [tripError, setTripError] = useState<string | null>(null);
    const [tripGroup, setTripGroup] = useState<ConsolidationQueueGroup | null>(null);
    const [preparingTriage, setPreparingTriage] = useState(false);
    const [triageError, setTriageError] = useState<string | null>(null);
    const [triageResult, setTriageResult] = useState<{ converted: number; failed: Array<{ id: string; message: string }> } | null>(null);
    const debounceRef = useRef<number | undefined>(undefined);
    const selectionVersionRef = useRef(0);
    const triageVersionRef = useRef(0);

    const resetSelection = useCallback(() => {
        selectionVersionRef.current += 1;
        setSelecting(false);
        setPicked(new Set());
        setPreparing(false);
        setTripError(null);
        setTripGroup(null);
    }, []);

    useEffect(() => {
        resetSelection();
        if (selectRequested && capabilities.canCreateTrip) {
            setBucket('stock');
            setSelecting(true);
        }
    }, [hubId, selectRequested, capabilities.canCreateTrip, resetSelection]);

    useEffect(() => {
        triageVersionRef.current += 1;
        setPreparingTriage(false);
        setTriageError(null);
        setTriageResult(null);
        return () => { triageVersionRef.current += 1; };
    }, [hubId]);

    useEffect(() => {
        if (bucket === 'triage' && summary.triage.documents === 0) {
            setBucket(capabilities.canViewOrders ? 'stock' : 'awaiting');
        }
    }, [bucket, summary.triage.documents, capabilities.canViewOrders]);

    const load = useCallback(
        async (offset = 0) => {
            if (!hubId) return;
            setError(null);
            if (offset === 0) setLoading(true);
            try {
                const body = await hubCargoApi.list({ bucket, q: q.trim() || undefined, limit: PAGE, offset, hubId });
                const rows = Array.isArray(body.data) ? body.data : [];
                setItems((prev) => (offset === 0 ? rows : [...prev, ...rows]));
                setTotal(body.pagination?.total ?? rows.length);
            } catch {
                setError('Não foi possível carregar as cargas. Tente de novo.');
            } finally {
                setLoading(false);
            }
        },
        [hubId, bucket, q],
    );

    useEffect(() => {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => void load(0), q ? 350 : 0);
        return () => window.clearTimeout(debounceRef.current);
    }, [load, q]);

    const scan = useScanController(hubId, () => {
        void load(0);
        void refresh();
    });

    const toggleOrder = (orderId: string) => {
        if (preparing) return;
        setTripError(null);
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(orderId)) next.delete(orderId);
            else next.add(orderId);
            return next;
        });
    };

    const prepareTrip = async () => {
        if (!hubId || !capabilities.canCreateTrip || preparing || picked.size === 0) return;
        const version = selectionVersionRef.current;
        setPreparing(true);
        setTripError(null);
        try {
            const body = await hubCargoApi.queues(hubId);
            if (version !== selectionVersionRef.current) return;
            const { group, missingOrderIds } = buildStockTripSelection(Array.isArray(body.data) ? body.data : [], [...picked]);
            if (missingOrderIds.length > 0) {
                setTripError(`${missingOrderIds.length} pedido(s) saíram da fila de estoque. Revise a seleção e tente de novo.`);
                setPicked((prev) => new Set([...prev].filter((id) => !missingOrderIds.includes(id))));
                void load(0);
                return;
            }
            setTripGroup(group);
        } catch {
            if (version === selectionVersionRef.current) {
                setTripError('Não foi possível preparar a montagem da viagem. Tente de novo.');
            }
        } finally {
            if (version === selectionVersionRef.current) setPreparing(false);
        }
    };

    const prepareAllTriage = async () => {
        if (!hubId || !capabilities.canReceive || preparingTriage) return;
        const version = triageVersionRef.current;
        setPreparingTriage(true);
        setTriageError(null);
        setTriageResult(null);
        try {
            const body = await hubCargoApi.convertAllTriage(hubId);
            if (version !== triageVersionRef.current) return;
            setTriageResult(body.data);
            void load(0);
            void refresh();
        } catch (cause) {
            if (version === triageVersionRef.current) {
                setTriageError(apiErrorMessage(cause, 'Não foi possível preparar as notas. Tente de novo.'));
            }
        } finally {
            if (version === triageVersionRef.current) setPreparingTriage(false);
        }
    };

    const meta = CARGO_BUCKETS.find((b) => b.bucket === bucket)!;
    const visible = CARGO_BUCKETS.filter((b) =>
        b.bucket === 'stock' ? capabilities.canViewOrders
            : capabilities.canReceive && (b.bucket !== 'triage' || summary.triage.documents > 0),
    );

    return (
        <div className={selecting ? 'pb-28' : 'pb-6'}>
            <OsSectionTitle
                action={bucket === 'stock' && capabilities.canCreateTrip ? (
                    <button
                        type="button"
                        onClick={() => selecting ? resetSelection() : setSelecting(true)}
                        className="min-h-[40px] text-[13px] font-bold text-brand-600 dark:text-brand-300"
                    >
                        {selecting ? 'Cancelar seleção' : 'Selecionar para viagem'}
                    </button>
                ) : undefined}
            >
                Cargas
            </OsSectionTitle>

            <div className="flex gap-2">
                <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                        // Leitor USB/Bluetooth digita o código e manda Enter; chave de 44 dígitos ou nº do pedido.
                        if (e.key === 'Enter' && (looksLikeAccessKey(q) || /^\d+$/.test(q.trim()))) {
                            e.preventDefault();
                            void scan.handleCode(q);
                        }
                    }}
                    placeholder="Chave da NF-e, pedido, destinatário…"
                    className="h-[48px] min-w-0 flex-1 rounded-xl border-2 border-tower-200 bg-white px-3.5 text-[15px] text-tower-900 placeholder:text-tower-400 focus:border-brand-400 focus:outline-none dark:border-tower-600 dark:bg-tower-900 dark:text-white"
                />
                <button
                    type="button"
                    onClick={scan.openScanner}
                    disabled={scan.busy}
                    className="flex h-[48px] shrink-0 items-center gap-2 rounded-xl bg-brand-yellow-400 px-4 font-bold text-brand-950 shadow-[0_2px_0_0_var(--color-brand-yellow-500)] active:translate-y-[1px] active:shadow-none"
                >
                    <IconReceive size={20} />
                    {scan.busy ? 'Lendo…' : 'Escanear'}
                </button>
            </div>

            {scan.message ? (
                <p
                    className={clsx(
                        'mt-3 rounded-xl p-3 text-[13px] font-semibold',
                        scan.message.kind === 'error'
                            ? 'border-l-4 border-brand-red-500 bg-brand-red-500/8 text-brand-red-700 dark:text-brand-red-400'
                            : 'border-l-4 border-brand-500 bg-brand-500/8 text-brand-700 dark:text-brand-200',
                    )}
                >
                    {scan.message.text}
                </p>
            ) : null}

            <div
                className="mt-3 grid rounded-xl border border-tower-200 bg-tower-100/70 p-1 dark:border-tower-700 dark:bg-tower-900"
                style={{ gridTemplateColumns: `repeat(${Math.max(1, visible.length)}, minmax(0, 1fr))` }}
            >
                {visible.map((b) => (
                    <button
                        key={b.bucket}
                        type="button"
                        aria-pressed={bucket === b.bucket}
                        onClick={() => {
                            if (bucket !== b.bucket) resetSelection();
                            setBucket(b.bucket);
                        }}
                        className={clsx(
                            'min-h-[48px] rounded-lg px-2 text-[13px] font-bold leading-tight transition-colors',
                            bucket === b.bucket
                                ? 'bg-white text-tower-900 shadow-sm dark:bg-tower-800 dark:text-white'
                                : 'text-tower-500 dark:text-tower-400',
                        )}
                    >
                        {b.label}
                    </button>
                ))}
            </div>

            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-prose flex-1 text-[13px] text-tower-500 dark:text-tower-300">{meta.subtitle}</p>
                {bucket === 'triage' && capabilities.canReceive ? (
                    <OsButton variant="secondary" disabled={preparingTriage || loading} onClick={() => void prepareAllTriage()}>
                        {preparingTriage ? 'Preparando notas…' : 'Preparar todas'}
                    </OsButton>
                ) : null}
            </div>
            {triageError ? <div className="mt-3"><OsErrorNotice message={triageError} onRetry={() => void prepareAllTriage()} /></div> : null}
            {triageResult ? (
                <div role="status" className="mt-3 rounded-xl border border-tower-200 bg-tower-50 p-3 text-[13px] text-tower-700 dark:border-tower-700 dark:bg-tower-800 dark:text-tower-200">
                    <p>{triageResult.converted} {triageResult.converted === 1 ? 'nota preparada' : 'notas preparadas'}. {triageResult.failed.length} {triageResult.failed.length === 1 ? 'nota ainda precisa de conferência' : 'notas ainda precisam de conferência'}.</p>
                    {triageResult.failed.length > 0 ? (
                        <details className="mt-2">
                            <summary className="min-h-[44px] cursor-pointer py-2 font-semibold">Ver o que falta conferir</summary>
                            <ul className="space-y-2">
                                {triageResult.failed.map((failure) => <li key={failure.id}>Documento {failure.id}: {failure.message}</li>)}
                            </ul>
                        </details>
                    ) : null}
                </div>
            ) : null}

            {selecting ? (
                <p className="mt-3 text-[13px] text-tower-500 dark:text-tower-300">
                    Selecione os pedidos para montar a viagem. Na montagem, pedidos sem CT-e/minuta ficam desmarcados.
                </p>
            ) : null}
            {tripError ? (
                <div className="mt-3">
                    <OsErrorNotice message={tripError} />
                </div>
            ) : null}

            <div className="mt-3">
                {loading ? (
                    <OsSkeletonRows />
                ) : error ? (
                    <OsErrorNotice message={error} onRetry={() => void load(0)} />
                ) : items.length === 0 ? (
                    <OsEmpty title={q ? 'Nada responde por essa busca' : meta.emptyTitle} detail={q ? undefined : meta.emptyDetail} />
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {items.map((item) => {
                            const selectableId =
                                bucket === 'stock' && item.kind === 'order' && item.allowedActions.selectForTrip && !item.activeTrip
                                    ? item.orderId ?? item.id
                                    : null;
                            return (
                                <CargoRow
                                    key={`${item.kind}-${item.id}`}
                                    tone={meta.tone}
                                    onClick={() => selecting && selectableId ? toggleOrder(selectableId) : void scan.openItem(item)}
                                    onLongPress={selectableId && capabilities.canCreateTrip && !selecting ? () => {
                                        setTripError(null);
                                        setSelecting(true);
                                        setPicked(new Set([selectableId]));
                                    } : undefined}
                                    chevron={!selecting || !selectableId}
                                >
                                    <div className="flex items-center gap-3">
                                        {selecting && selectableId ? (
                                            <input
                                                type="checkbox"
                                                aria-label={`Selecionar pedido ${item.orderNumber ?? selectableId}`}
                                                checked={picked.has(selectableId)}
                                                disabled={preparing}
                                                onClick={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                onChange={() => toggleOrder(selectableId)}
                                                className="h-5 w-5 shrink-0 accent-[#2e3192]"
                                            />
                                        ) : null}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2 pr-1">
                                                <p className="truncate font-semibold text-tower-900 dark:text-white">
                                                    {item.orderNumber && !item.collectionRequest ? `Pedido ${item.orderNumber}` : item.collectionRequest?.senderName ?? item.statusLabel}
                                                    {item.nfNumber ? (
                                                        <span className="font-mono text-[13px] font-medium text-tower-500 dark:text-tower-300">
                                                            {' '}
                                                            · NF {item.nfNumber}
                                                        </span>
                                                    ) : null}
                                                </p>
                                                {item.collectionRequest ? (
                                                    <OsBadge tone="warn">{collectionBadge(item.collectionRequest)}</OsBadge>
                                                ) : item.activeTrip ? (
                                                    <OsBadge tone="route">em viagem</OsBadge>
                                                ) : item.kind === 'order' && item.freightDocState && !['emitted', 'in_flight'].includes(item.freightDocState) ? (
                                                    <OsBadge tone="warn">sem CT-e</OsBadge>
                                                ) : null}
                                            </div>
                                            <p className="mt-0.5 truncate text-[13px] text-tower-500 dark:text-tower-400">
                                                {item.collectionRequest ? addressLine(item.collectionRequest.address) || item.collectionRequest.senderName : cargoFacts(item) || item.statusLabel}
                                            </p>
                                            {!selecting && canRequestCollection(item) ? (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        scan.requestCollectionFor(item);
                                                    }}
                                                    className="mt-1 min-h-[40px] text-[13px] font-bold text-brand-600 dark:text-brand-300"
                                                >
                                                    Solicitar coleta desta NF
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                </CargoRow>
                            );
                        })}
                        {items.length < total ? (
                            <button
                                type="button"
                                onClick={() => void load(items.length)}
                                className="min-h-[48px] rounded-xl border-2 border-tower-200 text-[14px] font-bold text-tower-600 active:bg-tower-100 dark:border-tower-700 dark:text-tower-300"
                            >
                                Mostrar mais ({items.length} de {total})
                            </button>
                        ) : null}
                    </div>
                )}
            </div>

            {selecting && capabilities.canCreateTrip ? (
                <OsActionBar>
                    <OsButton full disabled={preparing || picked.size === 0} onClick={() => void prepareTrip()}>
                        {preparing ? 'Preparando montagem…' : `Montar viagem (${picked.size})`}
                    </OsButton>
                </OsActionBar>
            ) : null}

            {tripGroup && hubId ? (
                <QueueGroupSheet
                    group={tripGroup}
                    hubId={hubId}
                    canCreateTrip={capabilities.canCreateTrip}
                    onClose={() => setTripGroup(null)}
                    onCreated={(manifestId) => {
                        resetSelection();
                        void refresh();
                        navigate(`/hubs/viagens/${manifestId}`);
                    }}
                />
            ) : null}

            {scan.overlays}
        </div>
    );
};

export default CargoPage;
