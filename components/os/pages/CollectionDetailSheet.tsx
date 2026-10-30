import React, { useState } from 'react';
import clsx from 'clsx';
import { intakeDemandsApi } from '../../../lib/api';
import type { HubCargoItem } from '../../../types/index';
import { addressLine, collectionBadge, shortDate } from '../lib/collection';
import { OsBadge, OsButton } from '../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../ui/Sheet';

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="mt-2.5">
        <p className="text-[12px] font-bold uppercase tracking-wide text-tower-400">{label}</p>
        <div className="text-[14px] text-tower-800 dark:text-tower-100">{children}</div>
    </div>
);

/** Detalhe de uma coleta solicitada: dar entrada quando a carga chegar, ou cancelar a solicitação. */
const CollectionDetailSheet: React.FC<{
    item: HubCargoItem;
    onClose: () => void;
    onReceive: (item: HubCargoItem) => void;
    onCancelled: () => void;
}> = ({ item, onClose, onReceive, onCancelled }) => {
    const cr = item.collectionRequest;
    const [cancelling, setCancelling] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!cr) return null;

    const cancel = async () => {
        if (!item.demandId || reason.trim().length < 3 || busy) return;
        setBusy(true);
        setError(null);
        try {
            await intakeDemandsApi.cancelCollection(item.demandId, reason.trim());
            onCancelled();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível cancelar a solicitação. Tente de novo.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <OsSheet
            title={cr.senderName}
            subtitle="Coleta solicitada"
            onClose={onClose}
            footer={
                cancelling ? (
                    <>
                        {error ? <p role="alert" className="mb-2 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
                        <div className="flex gap-2">
                            <OsButton variant="secondary" className="flex-1" disabled={busy} onClick={() => setCancelling(false)}>
                                Voltar
                            </OsButton>
                            <OsButton variant="danger" className="flex-1" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()}>
                                {busy ? 'Cancelando…' : 'Cancelar solicitação'}
                            </OsButton>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col gap-2">
                        {item.allowedActions.confirmArrival ? (
                            <OsButton full onClick={() => onReceive(item)}>
                                Coleta realizada — dar entrada
                            </OsButton>
                        ) : null}
                        <OsButton full variant="secondary" onClick={() => setCancelling(true)}>
                            Cancelar solicitação
                        </OsButton>
                    </div>
                )
            }
        >
            <div className="flex flex-wrap gap-1.5">
                <OsBadge tone="warn">{collectionBadge(cr)}</OsBadge>
                {cr.windowLabel ? <OsBadge tone="neutral">{cr.windowLabel}</OsBadge> : null}
            </div>
            <Fact label="Endereço de coleta">{addressLine(cr.address) || 'Não informado'}</Fact>
            <Fact label="Data desejada">{shortDate(cr.requestedDate) || '—'}</Fact>
            {cr.approxWeightKg || cr.approxUnits ? (
                <Fact label="Carga aproximada">
                    {[cr.approxUnits ? `${cr.approxUnits} vol.` : null, cr.approxWeightKg ? `${cr.approxWeightKg} kg` : null].filter(Boolean).join(' · ')}
                </Fact>
            ) : null}
            {cr.contact ? <Fact label="Contato no local">{cr.contact}</Fact> : null}
            {cr.nfKeys.length > 0 ? (
                <Fact label={cr.nfKeys.length === 1 ? 'NF-e' : 'NF-e informadas'}>
                    {cr.nfKeys.map((k) => (
                        <p key={k} className="break-all font-mono text-[12px]">{k}</p>
                    ))}
                </Fact>
            ) : null}
            {cr.note ? <Fact label="Observação">{cr.note}</Fact> : null}
            {cancelling ? (
                <label className="mt-4 block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                    Motivo do cancelamento
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        maxLength={300}
                        autoFocus
                        className={clsx(osFieldClass, 'mt-1.5 h-auto py-2.5')}
                    />
                </label>
            ) : null}
        </OsSheet>
    );
};

export default CollectionDetailSheet;
