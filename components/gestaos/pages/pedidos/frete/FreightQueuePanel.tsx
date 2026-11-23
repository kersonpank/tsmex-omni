import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { hubCargoApi, hubsApi } from '../../../../../lib/api';
import { useAuthStore } from '../../../../../store/authStore';
import type { FreightQueueItem, Hub } from '../../../../../types/index';
import { emitFreightDocument } from '../../../../os/freightActions';
import { dateShort, kg, money } from '../../../lib/format';
import { DOC_TYPE_LABEL, queueBatch, queueEmitOptions, queueResultText, readyIds } from '../../../lib/freteDoc';
import { invalidate, useResource } from '../../../lib/resource';
import { Button, EmptyState, Field, Loadable, Pill, SelectInput, Skeleton } from '../../../ui/kit';
import { Checkbox } from '../../../ui/form';
import { useAction } from '../../../ui/overlay';

type Results = Record<string, { ok: boolean; text: string }>;

/**
 * SEM CT-e/MINUTA — "que pedidos do estoque ainda não têm documento do frete?"
 * Os prontos (preço de tabela, sem pendência) saem em lote com o documento que o sistema recomendou;
 * os outros abrem o pedido para resolver. Emitir de novo é seguro: o servidor não duplica
 * (trava por pedido + compare-and-swap) e a fila só tem pedido sem documento ativo.
 */
export const FreightQueuePanel = () => {
    const ownHubId = useAuthStore((state) => state.user?.hubId) ?? '';
    const [pickedHub, setPickedHub] = useState('');
    const hubId = ownHubId || pickedHub;
    const { busy, run } = useAction();
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [results, setResults] = useState<Results>({});
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const lock = useRef(false);

    // Operador de hub só vê o próprio hub; a torre escolhe qual fila abrir.
    const hubs = useResource<Hub[]>(ownHubId ? null : 'hubs', async () => (await hubsApi.list()).data ?? [], { staleMs: 300_000 });
    const queue = useResource<FreightQueueItem[]>(hubId ? `frete:fila:${hubId}` : null, async () => (await hubCargoApi.freightQueue(hubId)).data ?? [], { staleMs: 0 });

    const rows = queue.data;
    useEffect(() => {
        if (rows) setSelected(readyIds(rows));
    }, [rows]);

    const toggle = (orderId: string) =>
        setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(orderId)) next.delete(orderId);
            else next.add(orderId);
            return next;
        });

    const batch = rows ? queueBatch(rows, selected) : [];

    const emitSelected = async () => {
        if (batch.length === 0 || lock.current) return;
        lock.current = true;
        setResults({});
        try {
            await run(
                'batch',
                async () => {
                    for (let index = 0; index < batch.length; index += 1) {
                        setProgress({ done: index, total: batch.length });
                        const item = batch[index];
                        const outcome = await emitFreightDocument(item.orderId, queueEmitOptions(item));
                        setResults((previous) => ({ ...previous, [item.orderId]: queueResultText(outcome) }));
                    }
                },
                { success: 'Lote processado. Confira o resultado de cada pedido.', error: 'O lote parou no meio.' },
            );
        } finally {
            setProgress(null);
            lock.current = false;
            invalidate('frete:', 'orders:');
        }
    };

    return (
        <section className="flex flex-col gap-4" aria-label="Pedidos sem CT-e ou minuta">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="gx-h2">Sem CT-e/minuta</h3>
                    <p className="gx-muted text-[13px]">Pedidos no estoque do hub que ainda não têm documento do frete.</p>
                </div>
                {!ownHubId ? (
                    <Field label="Hub" className="min-w-[220px]">
                        <SelectInput value={pickedHub} onChange={(event) => setPickedHub(event.target.value)} disabled={!hubs.data}>
                            <option value="">Escolha o hub</option>
                            {(hubs.data ?? []).map((hub) => (
                                <option key={hub.id} value={hub.id}>
                                    {hub.name}
                                </option>
                            ))}
                        </SelectInput>
                    </Field>
                ) : null}
            </header>

            {!hubId ? (
                <EmptyState title="Escolha um hub" hint="A fila é do estoque de cada hub." />
            ) : (
                <Loadable
                    state={queue}
                    skeleton={<Skeleton rows={3} />}
                    isEmpty={(data) => data.length === 0}
                    empty={<EmptyState title="Todos os pedidos do estoque têm documento" hint="Pedido novo entra aqui logo depois da entrada." />}
                >
                    {(data) =>
                        data.length === 0 ? (
                            <EmptyState title="Todos os pedidos do estoque têm documento" hint="Pedido novo entra aqui logo depois da entrada." />
                        ) : (
                            <div className="flex flex-col gap-3">
                                <ul className="flex flex-col gap-2.5">
                                    {data.map((item) => {
                                        const result = results[item.orderId];
                                        return (
                                            <li key={item.orderId} className="gx-inset flex items-start gap-3 px-4 py-3">
                                                {item.ready ? (
                                                    <Checkbox
                                                        checked={selected.has(item.orderId)}
                                                        disabled={busy !== null}
                                                        onChange={() => toggle(item.orderId)}
                                                        label={<span className="sr-only">{`Pôr o pedido ${item.orderNumber ?? ''} no lote`}</span>}
                                                    />
                                                ) : null}
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-semibold">
                                                        Pedido {item.orderNumber ?? '—'}
                                                        {item.nfNumber ? <span className="gx-mono gx-soft text-[13px] font-medium"> · NF {item.nfNumber}</span> : null}
                                                    </p>
                                                    <p className="gx-soft text-[13px]">
                                                        {item.recipientName ?? 'destinatário a conferir'}
                                                        {item.destination ? ` · ${item.destination}` : ''} · {kg(item.weightKg)} · no hub desde {dateShort(item.sinceAt)}
                                                    </p>
                                                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
                                                        {item.ready ? (
                                                            <Pill tone="royal" dot>
                                                                {`${DOC_TYPE_LABEL[item.suggestion.docs.recommended]} · ${money(item.suggestion.total ?? 0)}${item.suggestion.payer ? ` · ${item.suggestion.payer.name}` : ''}`}
                                                            </Pill>
                                                        ) : (
                                                            <Pill tone="yellow" dot>
                                                                {item.suggestion.blockers[0] ?? 'Abrir o pedido para emitir'}
                                                            </Pill>
                                                        )}
                                                        {!item.ready ? (
                                                            <Link to={`/gestaos/pedidos?p=${item.orderId}`} className="gx-royal-text font-semibold underline">
                                                                Abrir o pedido
                                                            </Link>
                                                        ) : null}
                                                    </p>
                                                    {result ? (
                                                        <p role={result.ok ? 'status' : 'alert'} className={`mt-1 text-[13px] font-semibold ${result.ok ? 'gx-royal-text' : 'gx-red-text'}`}>
                                                            {result.ok ? 'Feito: ' : 'Não emitido: '}
                                                            {result.text}
                                                        </p>
                                                    ) : null}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                                {data.some((item) => item.ready) ? (
                                    <div>
                                        <Button variant="primary" loading={busy === 'batch'} disabled={batch.length === 0 || busy !== null} onClick={() => void emitSelected()}>
                                            {progress ? `Emitindo ${progress.done + 1} de ${progress.total}…` : `Emitir ${batch.length} documento${batch.length === 1 ? '' : 's'}`}
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        )
                    }
                </Loadable>
            )}
        </section>
    );
};
