import React, { useState } from 'react';
import { ordersFreightApi } from '../../../../../lib/api';
import { ModeBadge, Button } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { refreshTrip, type StepProps } from './types';

/**
 * Seguro da carga com averbação eletrônica (AT&M): cada CT-e é averbado sozinho (Autopilot).
 * Aqui só o estado e, quando um pedido ficou pendente, "Tentar averbar agora". A digitação manual
 * (contingência) fica no campo de averbação da capa.
 */
export const AverbacaoPending: React.FC<Pick<StepProps, 'trip' | 'readiness'>> = ({ trip, readiness }) => {
    const { busy, run } = useAction();
    const [results, setResults] = useState<Record<string, string>>({});
    if (trip.fiscalEmitter?.averbacaoProvider !== 'ATM') return null;
    const orders = readiness?.issues.find((issue) => issue.code === 'MDFE_CARGO_AVERBACAO_PENDING')?.averbacaoOrders ?? [];

    const retry = async (orderId: string, calcId: string) => {
        const ok = await run(
            `averbar:${calcId}`,
            async () => {
                try {
                    const res = await ordersFreightApi.averbar(orderId, calcId);
                    const record = res.data.averbacao;
                    if (!res.success) throw new Error(res.data.outcome.message ?? record?.lastError ?? 'Averbação não concluída.');
                    setResults((prev) => ({ ...prev, [calcId]: `Averbado${record?.numeroAverbacao ? ` (${record.numeroAverbacao})` : ''}` }));
                } catch (cause) {
                    setResults((prev) => ({ ...prev, [calcId]: cause instanceof Error ? cause.message : 'Não foi possível averbar agora.' }));
                    throw cause;
                }
            },
            { success: 'CT-e averbado.', error: 'A averbação não foi concluída.' },
        );
        if (ok) refreshTrip();
    };

    return (
        <div className="gx-inset col-span-full flex flex-col gap-2 px-4 py-3.5" data-testid="averbacao">
            <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Seguro: averbado automaticamente a cada CT-e</p>
                <ModeBadge mode="auto" />
            </div>
            <p className={orders.length ? 'gx-red-text text-[13.5px] font-semibold' : 'gx-soft text-[13.5px]'}>
                {orders.length ? `Averbação pendente em ${orders.length} pedido(s).` : 'Nenhuma averbação pendente.'}
            </p>
            {orders.length ? (
                <ul className="flex flex-col">
                    {orders.map((item) => (
                        <li key={item.calcId} className="gx-hair-b flex flex-wrap items-center justify-between gap-3 py-2.5 last:border-b-0">
                            <span className="text-[14px]">
                                Pedido {item.orderNumber}
                                {results[item.calcId] ? <span className="gx-muted block text-[12.5px]">{results[item.calcId]}</span> : null}
                            </span>
                            <Button size="sm" loading={busy === `averbar:${item.calcId}`} onClick={() => void retry(item.orderId, item.calcId)}>
                                Tentar averbar agora
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : null}
            {orders.length ? <p className="gx-muted text-[12.5px]">Se a AT&amp;M estiver fora, informe o número da averbação manualmente na capa: ele prevalece e fica no histórico.</p> : null}
        </div>
    );
};
