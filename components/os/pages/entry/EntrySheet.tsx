import React, { useEffect, useState } from 'react';
import { hubCargoApi, intakeDemandsApi } from '../../../../lib/api';
import type { HubCargoItem, Person } from '../../../../types/index';
import { cargoFacts } from '../../lib/cargo';
import {
    EMPTY_CARGO_FORM,
    entryMissing,
    missingSentence,
    parseCargoForm,
    xmlCargoSummary,
    type CargoForm,
    type XmlCargo,
} from '../../lib/entry';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage } from '../../ui/Sheet';
import CargoFields from './CargoFields';
import type { PartySource } from './PartyCard';
import PartyPicker from './PartyPicker';

/**
 * ENTRADA NO BALCÃO — "esta mercadoria chegou; quem envia, para quem vai e quanto é?"
 * Com o XML da NF-e no sistema, tudo vem pronto. Sem XML: o remetente vem do CNPJ da chave
 * pelo cadastro público (Receita), o destinatário o operador busca ou cadastra, e volumes,
 * peso e valor são copiados da DANFE impressa. Confirmar cria o pedido em posse deste hub e
 * devolve o item pronto para etiquetar (próxima ação da roda).
 */

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

type Party = { person: Person | null; source: PartySource };
const NO_PARTY: Party = { person: null, source: 'manual' };

const EntrySheet: React.FC<{
    item: HubCargoItem;
    hubId: string;
    onClose: () => void;
    onDone: (order: HubCargoItem | null) => void;
}> = ({ item, hubId, onClose, onDone }) => {
    const [remetente, setRemetente] = useState<Party>(NO_PARTY);
    const [destinatario, setDestinatario] = useState<Party>(NO_PARTY);
    const [xmlCargo, setXmlCargo] = useState<XmlCargo | null>(null);
    const [cargoForm, setCargoForm] = useState<CargoForm>(EMPTY_CARGO_FORM);
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
                const data = body.data;
                const source: PartySource = data?.partiesSource ?? 'manual';
                if (data?.parties?.remetente) setRemetente({ person: data.parties.remetente, source });
                if (data?.parties?.destinatario) setDestinatario({ person: data.parties.destinatario, source });
                if (data?.status === 'available') setXmlCargo(xmlCargoSummary(data.cargo));
                else setNotice('O XML desta NF-e ainda não chegou ao sistema. Confira com a DANFE impressa.');
            })
            .catch(() => !cancelled && setNotice('Não foi possível ler os dados da NF-e. Confira com a DANFE impressa.'))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [item.demandId]);

    const counter = xmlCargo ? { cargo: null, missing: [] } : parseCargoForm(cargoForm);
    const missing = entryMissing({
        hasRemetente: Boolean(remetente.person),
        hasDestinatario: Boolean(destinatario.person),
        cargoMissing: counter.missing,
    });

    const confirm = async () => {
        if (!item.demandId || !remetente.person || !destinatario.person || missing.length > 0 || busy) return;
        setBusy(true);
        setError(null);
        try {
            const body = await intakeDemandsApi.confirmArrival(item.demandId, {
                destinatarioPersonId: destinatario.person.id,
                remetentePersonId: remetente.person.id,
                ...(counter.cargo ? { cargo: counter.cargo } : {}),
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
            subtitle={item.nfKeySuffix ? `chave …${item.nfKeySuffix}` : cargoFacts(item) || item.statusLabel}
            onClose={onClose}
            footer={
                <>
                    {error ? (
                        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
                    ) : null}
                    {!loading && missing.length > 0 ? (
                        <p className="mb-2 text-center text-[12px] font-semibold text-tower-500 dark:text-tower-400">{missingSentence(missing)}</p>
                    ) : null}
                    <OsButton full disabled={loading || missing.length > 0 || busy} onClick={() => void confirm()}>
                        {busy ? 'Confirmando…' : 'Confirmar entrada'}
                    </OsButton>
                </>
            }
        >
            {notice ? (
                <p className="rounded-lg bg-brand-yellow-400/20 p-3 text-[13px] text-[#6b5900] dark:text-brand-yellow-400">{notice}</p>
            ) : null}
            {loading ? (
                <p className="mt-4 text-[13px] text-tower-400">Lendo a NF-e e o cadastro do emitente…</p>
            ) : (
                <>
                    <PartyPicker
                        label="Remetente"
                        value={remetente.person}
                        source={remetente.source}
                        onChange={(person, source) => setRemetente({ person, source })}
                    />
                    <PartyPicker
                        label="Destinatário"
                        value={destinatario.person}
                        source={destinatario.source}
                        onChange={(person, source) => setDestinatario({ person, source })}
                    />
                    {xmlCargo ? (
                        <div className="mt-4">
                            <p className="mb-1.5 text-[13px] font-bold text-tower-600 dark:text-tower-300">Carga</p>
                            <p className="rounded-xl bg-tower-100/70 p-3 text-[14px] font-semibold text-tower-800 dark:bg-tower-800 dark:text-tower-100">
                                {xmlCargo.units > 0 ? `${xmlCargo.units} vol. · ` : ''}
                                {nf.format(xmlCargo.weightKg)} kg · {brl.format(xmlCargo.nfValue)}
                                <span className="ml-1 text-[12px] font-normal text-emerald-700 dark:text-emerald-400">da NF-e</span>
                            </p>
                        </div>
                    ) : (
                        <CargoFields value={cargoForm} onChange={setCargoForm} />
                    )}
                </>
            )}
        </OsSheet>
    );
};

export default EntrySheet;
