import React, { useEffect, useState } from 'react';
import { ordersApi } from '../../../../lib/api';
import { apiErrorMessage } from '../../ui/Sheet';
import { OsButton } from '../../ui/kit';

const ServiceStartRow: React.FC<{ orderId: string; onChanged: () => Promise<void> }> = ({ orderId, onChanged }) => {
    const [value, setValue] = useState<{ city: string | null; mode: 'HUB' | 'REMETENTE'; allowed: boolean } | null>(null);
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        ordersApi.getServiceStart(orderId).then((body) => { if (!cancelled) setValue(body.data ?? null); })
            .catch((cause) => { if (!cancelled) setError(apiErrorMessage(cause, 'Não foi possível conferir o início do serviço.')); });
        return () => { cancelled = true; };
    }, [orderId]);
    const save = async (mode: 'HUB' | 'REMETENTE') => {
        setBusy(true);
        setError(null);
        try {
            const body = await ordersApi.setServiceStart(orderId, mode);
            setValue(body.data ?? null);
            setEditing(false);
            await onChanged();
        } catch (cause) { setError(apiErrorMessage(cause, 'Não foi possível alterar o início do serviço.')); }
        finally { setBusy(false); }
    };
    return <div className="mt-3 text-[13px] text-tower-600 dark:text-tower-300">
        {value ? <div className="flex flex-wrap items-center gap-x-2">
            <p>Início do serviço: {value.city?.replace(/,\s*/, '/') || 'cidade pendente'} · {value.mode === 'HUB' ? 'entrada direta no hub' : 'coletado no remetente'}</p>
            {value.allowed ? <button type="button" disabled={busy} onClick={() => setEditing(!editing)} className="min-h-[44px] font-bold text-brand-600 dark:text-brand-300">{editing ? 'Cancelar' : 'Alterar'}</button> : null}
        </div> : null}
        {editing && value?.allowed ? <fieldset disabled={busy} className="flex flex-col items-start gap-2 py-2">
            <legend className="mb-2 font-semibold">Onde começou o serviço?</legend>
            <OsButton onClick={() => void save('HUB')} aria-busy={busy}>Neste hub (chegou direto)</OsButton>
            <OsButton onClick={() => void save('REMETENTE')} aria-busy={busy}>Na cidade do remetente (houve coleta)</OsButton>
        </fieldset> : null}
        {error ? <p role="alert" className="mt-1 text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
    </div>;
};
export default ServiceStartRow;
