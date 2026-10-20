import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { hubCargoApi } from '../../../lib/api';
import type { HubCargoBucket, HubCargoItem } from '../../../types/index';
import { useOs } from '../OsContext';
import { CARGO_BUCKETS, cargoFacts, scanOutcome } from '../lib/cargo';
import { OsBadge, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../ui/kit';
import { IconReceive } from '../ui/icons';
import CargoItemSheet from './CargoItemSheet';

const Scanner = React.lazy(() => import('../ui/Scanner'));

/**
 * CARGAS — estação de estoque e entrada. Pergunta única: "o que tenho aqui e
 * o que está esperando entrada?" Scan e busca são a porta de tudo.
 */

const PAGE = 30;

const CargoPage: React.FC = () => {
    const { hubId, capabilities, refresh } = useOs();
    const [bucket, setBucket] = useState<HubCargoBucket>('stock');
    const [q, setQ] = useState('');
    const [items, setItems] = useState<HubCargoItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [scanOpen, setScanOpen] = useState(false);
    const [scanMsg, setScanMsg] = useState<{ kind: 'info' | 'error'; message: string } | null>(null);
    const [selected, setSelected] = useState<{ item: HubCargoItem; note?: string } | null>(null);
    const debounceRef = useRef<number | undefined>(undefined);

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

    const handleCode = useCallback(
        async (code: string) => {
            setScanOpen(false);
            setScanMsg(null);
            if (!hubId) return;
            try {
                const body = await hubCargoApi.resolve(code, hubId);
                const out = scanOutcome(body.data);
                if (out.kind === 'item') setSelected({ item: out.item, note: out.note });
                else setScanMsg(out);
            } catch {
                setScanMsg({ kind: 'error', message: 'Falha ao consultar o código. Verifique a conexão.' });
            }
        },
        [hubId],
    );

    const meta = CARGO_BUCKETS.find((b) => b.bucket === bucket)!;
    const visible = capabilities.canViewOrders
        ? CARGO_BUCKETS
        : CARGO_BUCKETS.filter((b) => b.bucket !== 'stock');

    return (
        <div className="pb-6">
            <OsSectionTitle>Cargas</OsSectionTitle>

            <div className="flex gap-2">
                <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Pedido, NF, destinatário…"
                    className="h-[48px] min-w-0 flex-1 rounded-xl border-2 border-tower-200 bg-white px-3.5 text-[15px] text-tower-900 placeholder:text-tower-400 focus:border-brand-400 focus:outline-none dark:border-tower-600 dark:bg-tower-900 dark:text-white"
                />
                <button
                    type="button"
                    onClick={() => setScanOpen(true)}
                    className="flex h-[48px] shrink-0 items-center gap-2 rounded-xl bg-brand-yellow-400 px-4 font-bold text-brand-950 shadow-[0_2px_0_0_var(--color-brand-yellow-500)] active:translate-y-[1px] active:shadow-none"
                >
                    <IconReceive size={20} />
                    Escanear
                </button>
            </div>

            {scanMsg ? (
                <div className="mt-3">
                    <OsErrorNotice message={scanMsg.message} />
                </div>
            ) : null}

            <div className="mt-3 grid grid-cols-3 rounded-xl border border-tower-200 bg-tower-100/70 p-1 dark:border-tower-700 dark:bg-tower-900">
                {visible.map((b) => (
                    <button
                        key={b.bucket}
                        type="button"
                        onClick={() => setBucket(b.bucket)}
                        className={clsx(
                            'min-h-[40px] rounded-lg text-[13px] font-bold transition-colors',
                            bucket === b.bucket
                                ? 'bg-white text-tower-900 shadow-sm dark:bg-tower-800 dark:text-white'
                                : 'text-tower-500 dark:text-tower-400',
                        )}
                    >
                        {b.label}
                    </button>
                ))}
            </div>

            <div className="mt-3">
                {loading ? (
                    <OsSkeletonRows />
                ) : error ? (
                    <OsErrorNotice message={error} onRetry={() => void load(0)} />
                ) : items.length === 0 ? (
                    <OsEmpty title={q ? 'Nada responde por essa busca' : meta.emptyTitle} detail={q ? undefined : meta.emptyDetail} />
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {items.map((item) => (
                            <OsRow key={`${item.kind}-${item.id}`} tone={meta.tone} onClick={() => setSelected({ item })}>
                                <div className="flex items-center justify-between gap-2 pr-1">
                                    <p className="truncate font-semibold text-tower-900 dark:text-white">
                                        {item.orderNumber ? `Pedido ${item.orderNumber}` : item.statusLabel}
                                        {item.nfNumber ? (
                                            <span className="font-mono text-[13px] font-medium text-tower-500 dark:text-tower-300">
                                                {' '}
                                                · NF {item.nfNumber}
                                            </span>
                                        ) : null}
                                    </p>
                                    {item.activeTrip ? <OsBadge tone="route">em viagem</OsBadge> : null}
                                </div>
                                <p className="mt-0.5 truncate text-[13px] text-tower-500 dark:text-tower-400">
                                    {cargoFacts(item) || item.statusLabel}
                                </p>
                            </OsRow>
                        ))}
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

            {scanOpen ? (
                <React.Suspense fallback={null}>
                    <Scanner onCode={(code) => void handleCode(code)} onClose={() => setScanOpen(false)} />
                </React.Suspense>
            ) : null}

            {selected ? (
                <CargoItemSheet
                    item={selected.item}
                    note={selected.note}
                    onClose={() => setSelected(null)}
                    onChanged={() => {
                        setSelected(null);
                        void load(0);
                        void refresh();
                    }}
                />
            ) : null}
        </div>
    );
};

export default CargoPage;
