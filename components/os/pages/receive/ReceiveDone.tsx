import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hubCargoApi } from '../../../../lib/api';
import { closingSummary, type ClosingSummary } from '../../lib/conference';
import { OsActionBar, OsButton, OsCard } from '../../ui/kit';

/**
 * Fechamento do recebimento: diz o próximo passo da carga que acabou de entrar no estoque —
 * entrega desta unidade (monta a entrega) e/ou o que segue para outro hub.
 */
const ReceiveDone: React.FC<{ hubId: string | null; message: string; receivedOrderIds: string[]; photoFailures: number }> = ({
    hubId,
    message,
    receivedOrderIds,
    photoFailures,
}) => {
    const navigate = useNavigate();
    const [summary, setSummary] = useState<ClosingSummary | null>(null);

    useEffect(() => {
        if (!hubId || receivedOrderIds.length === 0) return;
        let active = true;
        void hubCargoApi
            .queues(hubId)
            .then((body) => {
                if (active) setSummary(closingSummary(Array.isArray(body.data) ? body.data : [], receivedOrderIds));
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [hubId, receivedOrderIds]);

    return (
        <div className="pb-40 pt-2">
            <OsCard className="!p-4">
                <p className="font-display text-[17px] font-bold text-tower-900 dark:text-white">Recebimento registrado</p>
                <p className="mt-1.5 text-[14px] text-tower-600 dark:text-tower-300" role="status">{message}</p>
                {photoFailures > 0 ? (
                    <p className="mt-2 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">
                        {photoFailures} foto(s) de avaria não puderam ser anexadas. A avaria foi registrada; anexe a foto na página do pedido.
                    </p>
                ) : null}
            </OsCard>
            {summary && (summary.local > 0 || summary.onward.length > 0) ? (
                <OsCard className="mt-3 !p-4">
                    <p className="font-display text-[15px] font-bold text-tower-900 dark:text-white">Próximo passo</p>
                    {summary.local > 0 ? (
                        <p className="mt-2 text-[14px] text-tower-700 dark:text-tower-200">{summary.local} pedido(s) são entrega desta unidade.</p>
                    ) : null}
                    {summary.onward.map((item) => (
                        <p key={item.hubName} className="mt-1 text-[14px] text-tower-700 dark:text-tower-200">
                            {item.count} seguem para {item.hubName}.
                        </p>
                    ))}
                </OsCard>
            ) : null}
            <OsActionBar>
                <div className="flex flex-col gap-2">
                    {summary && summary.local > 0 ? (
                        <OsButton full onClick={() => navigate('/hubs/viagens?grupo=local', { replace: true })}>
                            Montar entrega ({summary.local})
                        </OsButton>
                    ) : null}
                    {summary && summary.onward.length > 0 ? (
                        <OsButton full variant={summary.local > 0 ? 'secondary' : 'primary'} onClick={() => navigate('/hubs/viagens', { replace: true })}>
                            Ver o que segue viagem
                        </OsButton>
                    ) : null}
                    <OsButton full variant="secondary" onClick={() => navigate('/hubs/receber', { replace: true })}>Voltar às chegadas</OsButton>
                </div>
            </OsActionBar>
        </div>
    );
};

export default ReceiveDone;
