import React, { useEffect, useState } from 'react';
import { hubCargoApi, intakeDemandsApi } from '../../../../lib/api';
import type { HubCargoItem, Person } from '../../../../types/index';
import { cargoFacts } from '../../lib/cargo';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage } from '../../ui/Sheet';
import PartyPicker from './PartyPicker';

/**
 * ENTRADA NO BALCÃO — "esta mercadoria chegou; quem envia e para quem vai?"
 * Remetente e destinatário vêm da NF-e quando o XML já está no sistema; senão o operador
 * escolhe ou cadastra. Confirmar cria o pedido em posse deste hub e devolve o item pronto
 * para etiquetar (próxima ação da roda).
 */
const EntrySheet: React.FC<{
    item: HubCargoItem;
    hubId: string;
    onClose: () => void;
    onDone: (order: HubCargoItem | null) => void;
}> = ({ item, hubId, onClose, onDone }) => {
    const [remetente, setRemetente] = useState<Person | null>(null);
    const [destinatario, setDestinatario] = useState<Person | null>(null);
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!item.demandId) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        intakeDemandsApi
            .getLocalNfeData(item.demandId)
            .then((body) => {
                if (cancelled) return;
                const parties = body.data?.parties;
                if (parties?.remetente) setRemetente(parties.remetente);
                if (parties?.destinatario) setDestinatario(parties.destinatario);
                if (body.data?.status !== 'available') {
                    setNotice('O XML desta NF-e ainda não está no sistema: confira remetente e destinatário.');
                }
            })
            .catch(() => !cancelled && setNotice('Não foi possível ler os dados da NF-e: escolha remetente e destinatário.'))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [item.demandId]);

    const confirm = async () => {
        if (!item.demandId || !destinatario || !remetente || busy) return;
        setBusy(true);
        setError(null);
        try {
            const body = await intakeDemandsApi.confirmArrival(item.demandId, {
                destinatarioPersonId: destinatario.id,
                remetentePersonId: remetente.id,
            });
            const orderId = (body.data?.order as { id?: string } | null)?.id;
            let order: HubCargoItem | null = null;
            if (orderId) {
                const resolved = (await hubCargoApi.resolve(orderId, hubId)).data;
                if ('item' in resolved && resolved.item) order = resolved.item;
            }
            onDone(order);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível confirmar a entrada. Tente de novo.'));
            setBusy(false);
        }
    };

    return (
        <OsSheet
            title={item.nfNumber ? `Entrada da NF ${item.nfNumber}` : 'Entrada no balcão'}
            subtitle={cargoFacts(item) || item.statusLabel}
            onClose={onClose}
            footer={
                <>
                    {error ? (
                        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
                    ) : null}
                    <OsButton full disabled={loading || !remetente || !destinatario || busy} onClick={() => void confirm()}>
                        {busy ? 'Confirmando…' : 'Confirmar entrada'}
                    </OsButton>
                </>
            }
        >
            {item.nfKeySuffix ? <p className="font-mono text-[12px] text-tower-400">chave …{item.nfKeySuffix}</p> : null}
            {notice ? (
                <p className="mt-2 rounded-lg bg-brand-yellow-400/20 p-3 text-[13px] text-[#6b5900] dark:text-brand-yellow-400">{notice}</p>
            ) : null}
            {loading ? (
                <p className="mt-4 text-[13px] text-tower-400">Lendo os dados da NF-e…</p>
            ) : (
                <>
                    <PartyPicker label="Remetente" value={remetente} suggestedName={item.senderName} onChange={setRemetente} />
                    <PartyPicker label="Destinatário" value={destinatario} suggestedName={item.recipientName} onChange={setDestinatario} />
                </>
            )}
        </OsSheet>
    );
};

export default EntrySheet;
