import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { intakeDemandsApi } from '../../../lib/api';
import type { HubCargoItem, Person } from '../../../types/index';
import { addressLine, collectionFormError, parseNfKeys, todayIso } from '../lib/collection';
import AddressFields, { addressFrom, EMPTY_ADDRESS, type AddressValue } from '../ui/AddressFields';
import { OsButton } from '../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../ui/Sheet';
import PartyPicker from './entry/PartyPicker';

const WINDOWS = ['', 'Manhã', 'Tarde', 'Dia todo'];
const LABEL = 'mt-3 block text-[13px] font-bold text-tower-600 dark:text-tower-300';

/**
 * Solicitar coleta: o hub pede ao remetente que a carga seja coletada. Cria uma entrada esperada
 * (Aguardando chegada) marcada como coleta; ao dar entrada, o serviço parte da cidade do remetente.
 */
const CollectionRequestSheet: React.FC<{
    hubId: string;
    /** Modo NF: anexa a coleta a esta entrada que já aguarda (remetente vem da NF/XML). */
    attachTo?: HubCargoItem;
    onClose: () => void;
    onDone: () => void;
}> = ({ hubId, attachTo, onClose, onDone }) => {
    const [sender, setSender] = useState<Person | null>(null);
    const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
    const [editingAddress, setEditingAddress] = useState(false);
    const [date, setDate] = useState(todayIso());
    const [windowLabel, setWindowLabel] = useState('');
    const [weightKg, setWeightKg] = useState('');
    const [units, setUnits] = useState('');
    const [keysText, setKeysText] = useState('');
    const [contact, setContact] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [linked, setLinked] = useState<string | null>(null);

    // NF que já aguarda: o remetente e o endereço vêm da própria nota (XML ou CNPJ da chave).
    useEffect(() => {
        if (!attachTo?.demandId) return;
        let cancelled = false;
        intakeDemandsApi
            .getLocalNfeData(attachTo.demandId)
            .then((body) => {
                const p = body.data?.parties?.remetente;
                if (!cancelled && p) {
                    setSender(p);
                    setAddress(addressFrom(p));
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [attachTo?.demandId]);

    const pickSender = (person: Person | null) => {
        setSender(person);
        setAddress(person ? addressFrom(person) : EMPTY_ADDRESS);
        setEditingAddress(false);
        setError(null);
    };

    const keys = attachTo ? [] : parseNfKeys(keysText);
    const problem = collectionFormError({ senderId: sender?.id ?? null, address, requestedDate: date, weightKg: attachTo ? '' : weightKg, units: attachTo ? '' : units, keysText: attachTo ? '' : keysText });

    const submit = async () => {
        if (problem || !sender || busy) return;
        setBusy(true);
        setError(null);
        try {
            const payload = {
                expectedHubId: hubId,
                senderPersonId: sender.id,
                address: {
                    cep: address.cep.replace(/\D/g, '') || undefined,
                    address: address.address || undefined,
                    number: address.number || undefined,
                    complement: address.complement || undefined,
                    neighborhood: address.neighborhood || undefined,
                    city: address.city || undefined,
                    state: address.state || undefined,
                    cityIbgeCode: address.cityIbgeCode || undefined,
                },
                requestedDate: date,
                windowLabel: windowLabel || undefined,
                contact: contact.trim() || undefined,
                approxWeightKg: weightKg.trim() ? Number(weightKg.replace(',', '.')) : undefined,
                approxUnits: units.trim() ? Number(units) : undefined,
                nfKeys: keys.length > 0 ? keys : undefined,
                note: note.trim() || undefined,
            };
            if (attachTo?.demandId) {
                await intakeDemandsApi.attachCollection(attachTo.demandId, payload);
                onDone();
                return;
            }
            const body = await intakeDemandsApi.requestCollection(payload);
            if (body.attached > 0) setLinked(body.message ?? 'NF já estava aguardando — coleta vinculada.');
            else onDone();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível solicitar a coleta. Tente de novo.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <OsSheet
            title={attachTo ? "Solicitar coleta desta NF" : "Solicitar coleta"}
            subtitle={attachTo?.nfNumber ? `NF ${attachTo.nfNumber} — sem coleta, a carga é entregue direto no hub` : "A carga será coletada no remetente e esperada neste hub"}
            onClose={onClose}
            footer={
                linked ? (
                    <OsButton full onClick={onDone}>
                        Fechar
                    </OsButton>
                ) : (
                <>
                    {error ? <p role="alert" className="mb-2 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
                    <OsButton full disabled={Boolean(problem) || busy} onClick={() => void submit()}>
                        {busy ? 'Solicitando…' : 'Solicitar coleta'}
                    </OsButton>
                    {problem && sender ? <p className="mt-2 text-center text-[12px] text-tower-500">{problem}</p> : null}
                </>
                )
            }
        >
            {linked ? (
                <p role="status" className="rounded-xl border-l-4 border-brand-500 bg-brand-500/8 p-3 text-[14px] font-semibold text-brand-700 dark:text-brand-200">{linked}</p>
            ) : null}
            <PartyPicker label="Remetente" value={sender} source="manual" onChange={(person) => pickSender(person)} />

            {sender ? (
                <div className="mt-3">
                    <p className="text-[13px] font-bold text-tower-600 dark:text-tower-300">Endereço de coleta</p>
                    {editingAddress || !addressLine(address) ? (
                        <AddressFields value={address} onChange={setAddress} />
                    ) : (
                        <div className="mt-1.5 flex items-start justify-between gap-3 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                            <p className="text-[14px] text-tower-800 dark:text-tower-100">{addressLine(address)}</p>
                            <button type="button" onClick={() => setEditingAddress(true)} className="min-h-[40px] shrink-0 text-[13px] font-bold text-brand-600 dark:text-brand-300">
                                Alterar
                            </button>
                        </div>
                    )}
                </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
                <label className={LABEL}>
                    Data desejada
                    <input type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
                </label>
                <label className={LABEL}>
                    Janela
                    <select value={windowLabel} onChange={(e) => setWindowLabel(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')}>
                        {WINDOWS.map((w) => (
                            <option key={w} value={w}>{w || 'Qualquer horário'}</option>
                        ))}
                    </select>
                </label>
            </div>
            {attachTo ? null : (
            <div className="grid grid-cols-2 gap-2">
                <label className={LABEL}>
                    Peso aprox. (kg)
                    <input inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="opcional" className={clsx(osFieldClass, 'mt-1.5')} />
                </label>
                <label className={LABEL}>
                    Volumes
                    <input inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="opcional" className={clsx(osFieldClass, 'mt-1.5')} />
                </label>
            </div>
            )}
            {attachTo ? null : (
            <label className={LABEL}>
                Chaves das NF-e (opcional)
                <textarea
                    value={keysText}
                    onChange={(e) => setKeysText(e.target.value)}
                    rows={2}
                    placeholder="Cole uma ou mais chaves de 44 dígitos"
                    className={clsx(osFieldClass, 'mt-1.5 h-auto py-2.5 font-mono text-[13px]')}
                />
            </label>
            )}
            {keys.length > 0 ? <p className="mt-1 text-[12px] text-tower-500">{keys.length} {keys.length === 1 ? 'chave reconhecida' : 'chaves reconhecidas'}</p> : null}
            <label className={LABEL}>
                Contato no local (opcional)
                <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Nome e telefone" className={clsx(osFieldClass, 'mt-1.5')} />
            </label>
            <label className={LABEL}>
                Observação (opcional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className={clsx(osFieldClass, 'mt-1.5 h-auto py-2.5')} />
            </label>
        </OsSheet>
    );
};

export default CollectionRequestSheet;
