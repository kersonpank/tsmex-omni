import React, { useEffect, useRef, useState } from 'react';
import { ordersEntradaApi, personsApi } from '../../../../lib/api';
import type { Person } from '../../../../types/index';
import { orderPartiesApi, type PartyData } from '../../lib/orderPartiesApi';
import { partyLabels, type PartyRole } from '../../lib/partyFix';
import AddressFields, { EMPTY_ADDRESS, type AddressValue } from '../../ui/AddressFields';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';
import { OsButton } from '../../ui/kit';
import PartyPicker from '../entry/PartyPicker';

function addressOf(person: PartyData): AddressValue {
    return Object.fromEntries(Object.keys(EMPTY_ADDRESS).map((key) => [key, person[key as keyof PartyData] ?? ''])) as unknown as AddressValue;
}

const PartySheet: React.FC<{
    orderId: string;
    role: PartyRole;
    person: Person | null;
    autoLookup?: boolean;
    replacementRole?: PartyRole;
    onClose: () => void;
    onSaved: () => void | Promise<void>;
}> = ({ orderId, role, person, autoLookup = false, replacementRole = role, onClose, onSaved }) => {
    const [name, setName] = useState(person?.legalName ?? '');
    const [ie, setIe] = useState(person?.stateRegistration ?? '');
    const [exempt, setExempt] = useState(!person?.stateRegistration);
    const [address, setAddress] = useState(() => addressOf(person ?? {}));
    const [proposal, setProposal] = useState<{ data: PartyData; source: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [swapping, setSwapping] = useState(!person);
    const [replacement, setReplacement] = useState<Person | null>(null);
    const alive = useRef(true);
    const autoLookupStarted = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    const consult = async () => {
        if (!person || busy) return;
        setBusy(true); setError(null); setProposal(null);
        try {
            const result = await orderPartiesApi.registry(person.document);
            if (!alive.current) return;
            if (!result.suggestion) setError('Cadastro externo não disponível para este documento. Confira a IE no Sintegra/CCC e edite manualmente.');
            else setProposal({ data: result.suggestion, source: result.source === 'sintegra' ? 'Sintegra' : 'Receita (não confirma isenção de IE)' });
        } catch (cause) {
            if (alive.current) setError(apiErrorMessage(cause, 'Não foi possível consultar o cadastro. Tente novamente ou edite manualmente.'));
        } finally { if (alive.current) setBusy(false); }
    };
    useEffect(() => {
        if (autoLookup && !autoLookupStarted.current) {
            autoLookupStarted.current = true;
            void consult();
        }
    }, []);

    const fromNfe = async (xml?: string) => {
        setBusy(true); setError(null); setProposal(null);
        try {
            const data = await orderPartiesApi.refreshNfe(orderId, role, xml);
            if (alive.current) setProposal({ data, source: 'NF-e (a IE da nota pode estar desatualizada)' });
        } catch (cause) {
            if (alive.current) setError(apiErrorMessage(cause, 'Não foi possível ler a NF-e. Confira o XML e tente novamente.'));
        } finally { if (alive.current) setBusy(false); }
    };

    const apply = () => {
        if (!proposal) return;
        const data = proposal.data;
        if (data.legalName) setName(data.legalName);
        // Fonte sem IE não comprova que a pessoa deixou de ser contribuinte.
        if (data.stateRegistration != null) {
            setIe(data.stateRegistration); setExempt(!data.stateRegistration);
        }
        const proposedAddress = addressOf(data);
        // Não misturar rua de outra cidade com o município atual.
        if (proposedAddress.city && proposedAddress.state && proposedAddress.cityIbgeCode) setAddress(proposedAddress);
        setProposal(null);
    };

    const save = async () => {
        if (busy) return;
        setBusy(true); setError(null);
        try {
            if (swapping && replacement) {
                const key = replacementRole === 'remetente' ? 'remetentePersonId' : replacementRole === 'destinatario' || replacementRole === 'recebedor' ? 'destinatarioPersonId' : replacementRole === 'expedidor' ? 'expedidorPersonId' : 'consignatarioPersonId';
                await ordersEntradaApi.updatePeople(orderId, { [key]: replacement.id });
            } else if (person && !swapping) {
                const patch: PartyData = { legalName: name.trim(), stateRegistration: exempt ? '' : ie };
                for (const key of Object.keys(address) as (keyof AddressValue)[]) {
                    if (address[key] !== (person[key] ?? '')) patch[key] = address[key];
                }
                await personsApi.update(person.id, { ...patch, stateRegistration: patch.stateRegistration ?? '' });
            } else return;
            await onSaved();
            onClose();
        } catch (cause) { setError(apiErrorMessage(cause, 'Não foi possível salvar a pessoa.')); }
        finally { if (alive.current) setBusy(false); }
    };

    return (
        <OsSheet title={partyLabels[role]} subtitle={person?.document} onClose={() => { if (!busy) onClose(); }} footer={
            <OsButton className="w-full" disabled={busy || (swapping ? !replacement : !name.trim() || (!exempt && !ie.trim()))} onClick={() => void save()}>{busy ? 'Aguarde…' : 'Salvar'}</OsButton>
        }>
            <p className="mb-3 text-[12px] text-tower-500">Alteração vale para todos os pedidos desta pessoa</p>
            <div className="flex gap-2">
                <OsButton variant={swapping ? 'ghost' : 'secondary'} disabled={busy || !person} onClick={() => setSwapping(false)}>Editar dados</OsButton>
                <OsButton variant={swapping ? 'secondary' : 'ghost'} disabled={busy} onClick={() => { setSwapping(true); setProposal(null); }}>Trocar pessoa</OsButton>
            </div>
            <fieldset disabled={busy} className="mt-3 min-w-0 disabled:opacity-60">
                {swapping ? <PartyPicker label="Nova pessoa" value={replacement} source="manual" onChange={setReplacement} /> : <>
                    <label className="block text-[13px] font-semibold">Razão social<input className={`${osFieldClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} /></label>
                    <label className="mt-3 block text-[13px] font-semibold">IE<input className={`${osFieldClass} mt-1`} value={ie} disabled={exempt} onChange={(e) => setIe(e.target.value)} /></label>
                    <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[13px]"><input type="checkbox" checked={exempt} onChange={(e) => { setExempt(e.target.checked); if (e.target.checked) setIe(''); }} />Isento / não contribuinte (limpar IE)</label>
                    <p className="text-[12px] text-tower-500">Para contribuinte isento de inscrição, desmarque e informe ISENTO na IE.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <OsButton variant="secondary" onClick={() => void consult()}>Consultar cadastro (Sintegra/Receita)</OsButton>
                        <OsButton variant="ghost" onClick={() => void fromNfe()}>Atualizar pela NF-e</OsButton>
                        <label className="flex min-h-[44px] items-center text-[13px] font-bold">Enviar XML da NF-e
                            <input aria-label="Enviar XML da NF-e" type="file" accept=".xml,text/xml,application/xml" className="ml-2 w-40 text-[12px]" onChange={async (e) => {
                                const file = e.target.files?.[0]; e.target.value = '';
                                if (!file) return;
                                if (file.size > 5_000_000) { setError('XML deve ter até 5 MB.'); return; }
                                try { await fromNfe(await file.text()); } catch { setError('Não foi possível ler o arquivo XML.'); }
                            }} />
                        </label>
                    </div>
                    {proposal ? <div className="mt-3 rounded-xl bg-tower-100 p-3 text-[13px] dark:bg-tower-800">
                        <p className="font-semibold">{proposal.source}</p>
                        <p>IE no cadastro: {proposal.data.stateRegistration ?? 'não informada'} — atual no sistema: {person?.stateRegistration || 'não informada'}</p>
                        <p>{proposal.data.legalName} · {proposal.data.address} {proposal.data.number} · {proposal.data.city}/{proposal.data.state}</p>
                        {!proposal.data.cityIbgeCode ? <p>Para atualizar o endereço, consulte o CEP abaixo. O cadastro consultado não trouxe o município IBGE.</p> : null}
                        {!proposal.data.stateRegistration ? <p>Ausência de IE não comprova isenção. A IE atual será preservada; limpe apenas após conferir no Sintegra/CCC.</p> : null}
                        <OsButton className="mt-2" onClick={apply}>Usar estes dados</OsButton>
                    </div> : null}
                    <AddressFields value={address} onChange={setAddress} />
                </>}
            </fieldset>
            {error ? <p role="alert" className="mt-3 text-[13px] font-semibold text-brand-red-600">{error}</p> : null}
        </OsSheet>
    );
};

export default PartySheet;
