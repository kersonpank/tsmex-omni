import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { intakeDemandsApi } from '../../../lib/api';
import type { HubCargoItem, Person } from '../../../types/index';
import { buildVolumeLabels, cargoFacts } from '../lib/cargo';
import { OsBadge, OsButton } from '../ui/kit';
import { IconTag, IconX } from '../ui/icons';

/**
 * Folha do item de carga: fatos + a ação da vez.
 * Estoque → imprimir etiquetas. Aguardando → confirmar entrada em um toque
 * quando a NF-e já resolveu as partes; senão, orienta o painel atual.
 */

const CargoItemSheet: React.FC<{
    item: HubCargoItem;
    note?: string;
    onClose: () => void;
    onChanged: () => void;
}> = ({ item, note, onClose, onChanged }) => {
    const navigate = useNavigate();
    const labels = buildVolumeLabels(item);
    const isAwaitingIntake = item.bucket === 'awaiting' && item.kind === 'intake' && Boolean(item.demandId);

    const [parties, setParties] = useState<{ remetente: Person | null; destinatario: Person | null } | null>(null);
    const [partiesLoading, setPartiesLoading] = useState(isAwaitingIntake);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isAwaitingIntake || !item.demandId) return;
        let cancelled = false;
        intakeDemandsApi
            .getLocalNfeData(item.demandId)
            .then((body) => {
                if (!cancelled) setParties(body.data?.parties ?? { remetente: null, destinatario: null });
            })
            .catch(() => {
                if (!cancelled) setParties({ remetente: null, destinatario: null });
            })
            .finally(() => {
                if (!cancelled) setPartiesLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isAwaitingIntake, item.demandId]);

    const confirmArrival = async () => {
        if (!item.demandId || !parties?.destinatario || busy) return;
        setBusy(true);
        setError(null);
        try {
            await intakeDemandsApi.confirmArrival(item.demandId, {
                destinatarioPersonId: parties.destinatario.id,
                ...(parties.remetente ? { remetentePersonId: parties.remetente.id } : {}),
            });
            onChanged();
        } catch {
            setError('Não foi possível confirmar a entrada. Tente de novo.');
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
            <div
                className="w-full max-w-xl rounded-t-2xl bg-white p-4 pb-[max(env(safe-area-inset-bottom),16px)] dark:bg-tower-900"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="font-display text-[17px] font-bold text-tower-900 dark:text-white">
                            {item.orderNumber ? `Pedido ${item.orderNumber}` : item.statusLabel}
                        </p>
                        {item.nfNumber ? (
                            <p className="font-mono text-[13px] text-tower-500 dark:text-tower-300">NF {item.nfNumber}</p>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fechar"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tower-100 text-tower-600 active:bg-tower-200 dark:bg-tower-800 dark:text-tower-300"
                    >
                        <IconX size={18} />
                    </button>
                </div>

                <p className="mt-2 text-[14px] text-tower-600 dark:text-tower-300">{cargoFacts(item) || item.statusLabel}</p>
                {item.destination ? (
                    <p className="mt-1 text-[13px] text-tower-400">Destino: {item.destination}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                    <OsBadge tone={item.bucket === 'stock' ? 'ok' : item.bucket === 'awaiting' ? 'warn' : 'route'}>
                        {item.statusLabel}
                    </OsBadge>
                    {item.activeTrip ? (
                        <OsBadge tone="route">
                            em viagem · {item.activeTrip.origin} → {item.activeTrip.destination}
                        </OsBadge>
                    ) : null}
                </div>
                {note ? <p className="mt-3 rounded-lg bg-brand-yellow-400/20 p-3 text-[13px] font-semibold text-[#6b5900] dark:text-brand-yellow-400">{note}</p> : null}
                {error ? <p className="mt-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}

                <div className="mt-4 flex flex-col gap-2">
                    {labels.length > 0 ? (
                        <OsButton
                            full
                            variant={item.bucket === 'stock' ? 'primary' : 'secondary'}
                            onClick={() => navigate(`/hubs/etiquetas/${item.orderId ?? item.id}`, { state: { item } })}
                        >
                            <IconTag size={18} />
                            Imprimir etiquetas ({labels.length})
                        </OsButton>
                    ) : null}

                    {isAwaitingIntake ? (
                        partiesLoading ? (
                            <OsButton full variant="secondary" disabled>
                                Lendo dados da NF-e…
                            </OsButton>
                        ) : parties?.destinatario ? (
                            <OsButton full onClick={() => void confirmArrival()} disabled={busy}>
                                {busy ? 'Confirmando…' : `Confirmar entrada — ${parties.destinatario.legalName}`}
                            </OsButton>
                        ) : (
                            <p className="rounded-lg bg-tower-100 p-3 text-[13px] text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                                A NF-e ainda não resolveu o destinatário. Complete a entrada pelo painel atual do hub
                                (menu Entrada) — esta tela assume o fluxo completo na próxima fatia.
                            </p>
                        )
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default CargoItemSheet;
