import React, { useState } from 'react';
import { manifestsApi } from '../../../../../lib/api';
import type { DeliveryProgress } from '../../../../../types/index';
import { concludePlan, legState, legStatusLine, tripSummary } from '../../../../os/lib/delivery';
import { docaErrorMessage, isConflict } from '../../../lib/docaWork';
import { KEYS } from '../../../lib/data';
import { plural } from '../../../lib/format';
import { invalidate } from '../../../lib/resource';
import { Button, EmptyState, ModeBadge, Pill, Progress } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { DeliveryDrawer, type AttemptMode } from './DeliveryDrawer';

interface Props {
    manifestId: string;
    items: DeliveryProgress[];
    canOperate: boolean;
    onChanged: () => void;
}

const refresh = () => invalidate(KEYS.manifests, 'manifest:', KEYS.exceptions, 'orders:');

/** Entrega: progresso por pedido, tentativa com comprovante e conclusão da parada ou da viagem. */
export const DeliverySection: React.FC<Props> = ({ manifestId, items, canOperate, onChanged }) => {
    const { busy, run } = useAction();
    const [sheet, setSheet] = useState<{ item: DeliveryProgress; mode: AttemptMode } | null>(null);
    const summary = tripSummary(items);
    const done = summary.delivered + summary.notDelivered;
    const pct = summary.total ? Math.round((done / summary.total) * 100) : 0;

    const afterWrite = () => {
        refresh();
        onChanged();
    };

    const conclude = async () => {
        const plan = concludePlan(items);
        const ok = await run(
            'conclude-delivery',
            async () => {
                try {
                    if (plan.kind === 'stops') for (const stopId of plan.stopIds) await manifestsApi.completeStop(manifestId, stopId);
                    else await manifestsApi.complete(manifestId);
                } catch (cause) {
                    if (isConflict(cause)) afterWrite();
                    throw new Error(docaErrorMessage(cause, 'Os registros foram mantidos, tente de novo.'));
                }
            },
            { success: 'Viagem concluída pela torre. O que não foi entregue volta ao estoque do hub.', error: 'Não foi possível concluir a viagem.' },
        );
        if (ok) afterWrite();
    };

    return (
        <section className="flex flex-col gap-4" aria-label="Entrega">
            <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="gx-h2">Entrega</h3>
                <ModeBadge mode="manual" />
                <Pill tone={summary.readyToConclude ? 'royal' : 'neutral'}>{done}/{summary.total} resolvidos</Pill>
            </div>
            <p className="gx-soft text-[13.5px]">Registrado pela torre, em nome do transportador: cada tentativa grava a sua conta como autora e o comprovante.</p>
            {summary.total > 0 ? <Progress value={pct} label="Entregas resolvidas" /> : null}
            {items.length === 0 ? (
                <EmptyState title="Nenhum pedido de entrega nesta viagem" hint="Quando houver pedidos para entregar, eles aparecem aqui para você comprovar." />
            ) : (
                <div className="flex flex-col gap-3">
                    {items.map((item) => {
                        const state = legState(item);
                        return (
                            <div key={item.legId} className="gx-inset flex flex-col gap-2 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-semibold">
                                        {item.recipientName ?? `Pedido ${item.orderNumber}`}
                                        {item.nfNumber ? <span className="gx-mono gx-muted ml-2 text-[13px]">NF {item.nfNumber}</span> : null}
                                    </p>
                                    <Pill tone={state === 'DELIVERED' ? 'neutral' : state === 'NOT_DELIVERED' ? 'yellow' : 'royal'}>
                                        {state === 'DELIVERED' ? 'Entregue' : state === 'NOT_DELIVERED' ? 'Não entregue' : 'Falta comprovar'}
                                    </Pill>
                                </div>
                                <p className="gx-muted text-[13px]">{item.destinationLabel ?? item.destinationCity ?? 'Destino não informado'} · pedido {item.orderNumber}</p>
                                <p className="gx-soft text-[13.5px]">{legStatusLine(item)}</p>
                                {state !== 'DELIVERED' ? (
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="primary" disabled={!canOperate} aria-label={`Registrar entrega do pedido ${item.orderNumber}`} onClick={() => setSheet({ item, mode: 'DELIVERED' })}>Registrar entrega</Button>
                                        <Button variant="soft" disabled={!canOperate} aria-label={`Pedido ${item.orderNumber} não entregue`} onClick={() => setSheet({ item, mode: 'FAILED' })}>Não entregue</Button>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}
            {summary.readyToConclude && canOperate ? (
                <div className="flex flex-col items-start gap-2">
                    <p className="gx-soft text-[13.5px]">{plural(summary.total, 'pedido resolvido', 'pedidos resolvidos')}. Concluir fecha a viagem e devolve ao estoque o que não foi entregue.</p>
                    <Button variant="primary" loading={busy === 'conclude-delivery'} onClick={() => void conclude()}>Concluir viagem</Button>
                </div>
            ) : null}
            {sheet ? (
                <DeliveryDrawer
                    key={`${sheet.item.orderId}:${sheet.mode}`}
                    manifestId={manifestId}
                    item={sheet.item}
                    mode={sheet.mode}
                    onClose={() => setSheet(null)}
                    onDone={() => {
                        setSheet(null);
                        afterWrite();
                    }}
                    onStale={afterWrite}
                />
            ) : null}
        </section>
    );
};
