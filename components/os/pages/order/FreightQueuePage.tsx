import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { hubCargoApi } from '../../../../lib/api';
import type { FreightQueueItem } from '../../../../types/index';
import { useOs } from '../../OsContext';
import { emitFreightDocument, type EmitOutcome } from '../../freightActions';
import { DOC_TYPE_LABEL, formatBRL } from '../../lib/freight';
import { OsActionBar, OsButton, OsEmpty, OsErrorNotice, OsSectionTitle, OsSkeletonRows } from '../../ui/kit';
import { IconCheck } from '../../ui/icons';

/**
 * SEM CT-e/MINUTA — "que pedidos do estoque ainda não têm documento do frete?"
 * Os prontos (preço de tabela, sem pendência) saem em lote; os outros abrem o pedido para
 * resolver. Emitir de novo é seguro: o servidor não duplica (trava por pedido + CAS).
 */

function resultText(outcome: EmitOutcome): { ok: boolean; text: string } {
    switch (outcome.kind) {
        case 'authorized':
            return { ok: true, text: 'autorizado' };
        case 'sent':
            return { ok: true, text: 'enviado à SEFAZ' };
        case 'minuta':
            return { ok: true, text: `minuta nº ${outcome.calc.minutaNumber ?? ''} — imprima no pedido` };
        case 'already':
            return { ok: true, text: 'já tinha documento' };
        case 'rejected':
            return { ok: false, text: `rejeitado: ${outcome.reason}` };
        case 'blocked':
            return { ok: false, text: outcome.issues[0] ?? 'pendência fiscal' };
        default:
            return { ok: false, text: outcome.message };
    }
}

const FreightQueuePage: React.FC = () => {
    const navigate = useNavigate();
    const { hubId, refresh } = useOs();
    const [items, setItems] = useState<FreightQueueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});

    const load = useCallback(async () => {
        if (!hubId) return;
        setError(null);
        try {
            const rows = (await hubCargoApi.freightQueue(hubId)).data ?? [];
            setItems(rows);
            setSelected(new Set(rows.filter((r) => r.ready).map((r) => r.orderId)));
        } catch {
            setError('Não foi possível carregar os pedidos sem documento.');
        } finally {
            setLoading(false);
        }
    }, [hubId]);

    useEffect(() => {
        void load();
    }, [load]);

    const toggle = (orderId: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(orderId)) next.delete(orderId);
            else next.add(orderId);
            return next;
        });

    const emitSelected = async () => {
        const batch = items.filter((i) => i.ready && selected.has(i.orderId));
        if (batch.length === 0 || progress) return;
        setResults({});
        for (let index = 0; index < batch.length; index += 1) {
            setProgress({ done: index, total: batch.length });
            const item = batch[index];
            const outcome = await emitFreightDocument(item.orderId, { documentType: item.suggestion.docs.recommended });
            setResults((prev) => ({ ...prev, [item.orderId]: resultText(outcome) }));
        }
        setProgress(null);
        void refresh();
        void load();
    };

    const count = items.filter((i) => i.ready && selected.has(i.orderId)).length;

    return (
        <div className="pb-32">
            <OsSectionTitle>Sem CT-e/minuta</OsSectionTitle>
            {loading ? (
                <OsSkeletonRows count={3} />
            ) : error ? (
                <OsErrorNotice message={error} onRetry={() => void load()} />
            ) : items.length === 0 ? (
                <OsEmpty title="Todos os pedidos do estoque têm documento" detail="Pedido novo entra aqui logo depois da entrada." />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {items.map((item) => {
                        const result = results[item.orderId];
                        const isOn = selected.has(item.orderId);
                        return (
                            <div
                                key={item.orderId}
                                className={clsx(
                                    'flex items-stretch overflow-hidden rounded-xl border border-l-[6px] border-tower-200 bg-white dark:border-tower-700 dark:bg-tower-900',
                                    item.ready ? 'border-l-emerald-500' : 'border-l-brand-yellow-400',
                                )}
                            >
                                {item.ready ? (
                                    <button
                                        type="button"
                                        aria-pressed={isOn}
                                        aria-label={isOn ? 'Tirar do lote' : 'Pôr no lote'}
                                        onClick={() => toggle(item.orderId)}
                                        className="flex w-12 shrink-0 items-center justify-center active:bg-tower-100 dark:active:bg-tower-800"
                                    >
                                        <span
                                            className={clsx(
                                                'flex h-6 w-6 items-center justify-center rounded-md border-2',
                                                isOn ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-tower-300 dark:border-tower-600',
                                            )}
                                        >
                                            {isOn ? <IconCheck size={14} /> : null}
                                        </span>
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => navigate(`/hubs/pedidos/${item.orderId}`)}
                                    className="min-w-0 flex-1 px-3 py-2.5 text-left active:bg-tower-50 dark:active:bg-tower-800"
                                >
                                    <p className="truncate font-semibold text-tower-900 dark:text-white">
                                        Pedido {item.orderNumber ?? '—'}
                                        {item.nfNumber ? <span className="font-mono text-[13px] font-medium text-tower-500"> · NF {item.nfNumber}</span> : null}
                                    </p>
                                    <p className="truncate text-[13px] text-tower-500 dark:text-tower-400">
                                        {item.recipientName ?? 'destinatário a conferir'}
                                        {item.destination ? ` · ${item.destination}` : ''}
                                    </p>
                                    <p className={clsx('mt-0.5 truncate text-[12px] font-semibold', item.ready ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#8a6d00] dark:text-brand-yellow-400')}>
                                        {item.ready
                                            ? `${DOC_TYPE_LABEL[item.suggestion.docs.recommended]} · ${formatBRL(item.suggestion.total ?? 0)} · ${item.suggestion.payer?.name ?? ''}`
                                            : item.suggestion.blockers[0] ?? 'Abrir o pedido para emitir'}
                                    </p>
                                    {result ? (
                                        <p className={clsx('mt-0.5 text-[12px] font-bold', result.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-brand-red-600 dark:text-brand-red-400')}>
                                            {result.text}
                                        </p>
                                    ) : null}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
            {items.some((i) => i.ready) ? (
                <OsActionBar>
                    <OsButton full disabled={count === 0 || Boolean(progress)} onClick={() => void emitSelected()}>
                        {progress ? `Emitindo ${progress.done + 1} de ${progress.total}…` : `Emitir ${count} documento${count === 1 ? '' : 's'}`}
                    </OsButton>
                </OsActionBar>
            ) : null}
        </div>
    );
};

export default FreightQueuePage;
