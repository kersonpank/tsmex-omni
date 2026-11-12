import React, { useState } from 'react';
import { ordersFreightApi } from '../../../../lib/api';
import { OsButton } from '../../ui/kit';
import { apiErrorMessage } from '../../ui/Sheet';

/**
 * "Conferir agora" do CT-e em conciliação: o servidor procura o documento no emissor fiscal e
 * só reenvia com prova de que ele não existe. O hub dono do pedido pode acionar sozinho.
 */
const CteConferir: React.FC<{ orderId: string; calcId: string; onDone: () => void | Promise<void> }> = ({ orderId, calcId, onDone }) => {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        if (busy) return;
        setBusy(true);
        setMessage(null);
        setError(null);
        try {
            const body = await ordersFreightApi.reconcileCte(orderId, calcId);
            setMessage(body.data?.message ?? null);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível conferir agora. Tentaremos de novo sozinhos.'));
        } finally {
            try {
                await onDone();
            } finally {
                setBusy(false);
            }
        }
    };

    return (
        <div className="mt-2">
            <OsButton type="button" variant="secondary" disabled={busy} aria-busy={busy} onClick={() => void run()} className="min-h-[44px]">
                {busy ? 'Conferindo…' : 'Conferir agora'}
            </OsButton>
            {message ? <p role="status" className="mt-1 text-[12px] text-tower-500 dark:text-tower-400">{message}</p> : null}
            {error ? <p role="alert" className="mt-1 text-[12px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
        </div>
    );
};

export default CteConferir;
