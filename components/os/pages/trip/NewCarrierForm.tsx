import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { linksApi, personsApi, type DocumentLookupResult } from '../../../../lib/api';
import { classifyDocument, digits, formatPersonAddress } from '../../lib/carrier';
import { assignCarrier } from './assignCarrier';
import { OsBadge, OsButton } from '../../ui/kit';
import AddressFields, { EMPTY_ADDRESS, addressFrom, addressReady, type AddressValue } from '../../ui/AddressFields';
import { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

/**
 * Cadastrar transportador pelo hub (NORTE #22): cria, aprova pelo próprio hub (fica
 * registrado quem aprovou), coloca na viagem e abre a ficha para completar CIOT/MDF-e.
 * CPF = autônomo (TAC): o motorista é criado junto, com os dados da mesma pessoa.
 *
 * Ao completar o documento, consulta o nosso cadastro (transportador ou pessoa já existente)
 * e, para CNPJ novo, o Sintegra (IE + endereço) ou a Receita — tudo ANTES de salvar, só como
 * preenchimento: nada é criado pela consulta.
 */
const NewCarrierForm: React.FC<{
    manifestId: string;
    onCreated: (linkId: string) => void;
    /** Transportador que já existia e foi só colocado na viagem. */
    onUsed?: () => void;
    /** Motoristas já escolhidos na viagem: continuam depois de trocar o transportador. */
    keepDriverIds?: string[];
    onCancel: () => void;
}> = ({ manifestId, onCreated, onUsed, keepDriverIds, onCancel }) => {
    const [doc, setDoc] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [stateRegistration, setStateRegistration] = useState('');
    const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
    const [editAddress, setEditAddress] = useState(false);
    const [carrierType, setCarrierType] = useState<'ETC' | 'CTC' | 'FROTA'>('ETC');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lookup, setLookup] = useState<DocumentLookupResult | null>(null);
    const [looking, setLooking] = useState(false);
    const [lookupFailed, setLookupFailed] = useState(false);
    const d = digits(doc);
    const kind = classifyDocument(doc);
    const isCnpj = kind === 'CNPJ';
    const ready = kind !== null && name.trim().length > 1 && digits(phone).length >= 10;
    const existingLink = lookup?.person?.links?.[0] ?? null;
    const knownPerson = lookup?.person && !existingLink ? lookup.person : null;
    const suggestion = lookup?.suggestion ?? null;

    useEffect(() => {
        setLookup(null);
        setLookupFailed(false);
        if (!classifyDocument(d)) {
            setLooking(false);
            return;
        }
        let cancelled = false;
        setLooking(true);
        const timer = setTimeout(() => {
            personsApi
                .lookupDocument(d)
                .then((body) => {
                    if (cancelled) return;
                    const result = body.data;
                    setLookup(result);
                    const person = result.person;
                    const hint = result.suggestion;
                    if (person) {
                        setName((current) => current || person.legalName);
                        setPhone((current) => current || digits(person.drivers?.find((x) => x.phone)?.phone));
                        setStateRegistration((current) => current || person.stateRegistration || '');
                        setAddress((current) => (current.cep || current.address ? current : addressFrom(person)));
                    } else if (hint) {
                        setName((current) => current || hint.legalName);
                        setPhone((current) => current || hint.phone || '');
                        setStateRegistration((current) => current || hint.stateRegistration || '');
                        setAddress((current) => (current.cep || current.address ? current : addressFrom(hint)));
                    } else if (d.length === 14) {
                        setLookupFailed(true);
                    }
                })
                .catch(() => {
                    // Sem consulta, o cadastro manual continua valendo.
                    if (!cancelled) setLookupFailed(true);
                })
                .finally(() => {
                    if (!cancelled) setLooking(false);
                });
        }, 400);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [d]);

    const useExisting = async (linkId: string) => {
        setBusy(true);
        setError(null);
        try {
            const link = (await linksApi.getById(linkId)).data;
            if (link.approvalStatus === 'PENDING') await linksApi.approve(linkId);
            await assignCarrier(manifestId, linkId, keepDriverIds);
            if (onUsed) onUsed();
            else onCreated(linkId);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível usar este transportador.'));
            setBusy(false);
        }
    };

    const create = async () => {
        setBusy(true);
        setError(null);
        try {
            const created = await linksApi.create({
                document: d,
                name: name.trim(),
                phone: digits(phone),
                ...(isCnpj ? { carrierType } : {}),
            });
            const linkId = created.data.id;
            // IE e endereço vão para a Pessoa do transportador (o cadastro do transportador não os recebe).
            // Se falhar, o cadastro já existe: a ficha permite completar depois.
            const ie = stateRegistration.trim();
            if (ie || addressReady(address)) {
                try {
                    await linksApi.updateOwnerPerson(linkId, {
                        ...(ie ? { stateRegistration: ie } : {}),
                        ...(addressReady(address)
                            ? {
                                  address: {
                                      cep: digits(address.cep),
                                      address: address.address,
                                      number: address.number,
                                      ...(address.complement ? { complement: address.complement } : {}),
                                      neighborhood: address.neighborhood,
                                      city: address.city,
                                      state: address.state,
                                      cityIbgeCode: address.cityIbgeCode,
                                  },
                              }
                            : {}),
                    });
                } catch {
                    // Segue para a ficha.
                }
            }
            await linksApi.approve(linkId);
            await assignCarrier(manifestId, linkId, keepDriverIds);
            onCreated(linkId);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível cadastrar o transportador.'));
            setBusy(false);
        }
    };

    const label = 'mt-3 block text-[13px] font-bold text-tower-600 first:mt-0 dark:text-tower-300';
    const note = 'mt-2 rounded-lg bg-tower-100 p-2.5 text-[12px] text-tower-600 dark:bg-tower-800 dark:text-tower-300';
    const addressLine = formatPersonAddress(address.address ? address : null);
    return (
        <div>
            <label className={label}>
                CPF (autônomo) ou CNPJ (empresa)
                <input inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
            </label>
            {looking ? <p className="mt-2 text-[12px] text-tower-500 dark:text-tower-400">Consultando cadastro…</p> : null}

            {existingLink ? (
                <div className="mt-3 rounded-xl border-2 border-brand-500 bg-brand-500/8 p-3.5">
                    <p className="text-[15px] font-semibold text-tower-900 dark:text-white">Já cadastrado: {existingLink.name}</p>
                    <OsButton full className="mt-3" disabled={busy} onClick={() => void useExisting(existingLink.id)}>
                        {busy ? 'Usando…' : 'Usar este transportador'}
                    </OsButton>
                </div>
            ) : (
                <>
                    {knownPerson ? (
                        <p className={note}>
                            Pessoa já cadastrada no sistema{knownPerson.roles?.length ? ` (${knownPerson.roles.join(', ')})` : ''} — dados reaproveitados.
                        </p>
                    ) : null}
                    {suggestion ? (
                        <p className={clsx(note, 'flex flex-wrap items-center gap-2')}>
                            <OsBadge tone="route">{lookup?.source === 'sintegra' ? 'Sintegra' : 'Receita'}</OsBadge>
                            <span>
                                {lookup?.source === 'sintegra'
                                    ? 'Razão social, inscrição estadual e endereço preenchidos. Confira antes de salvar.'
                                    : 'Razão social e endereço preenchidos. Confira antes de salvar.'}
                            </span>
                        </p>
                    ) : null}
                    {lookupFailed && !suggestion && !knownPerson ? (
                        <p className="mt-2 text-[12px] text-tower-500 dark:text-tower-400">
                            Não encontramos este documento nas consultas agora. Preencha manualmente.
                        </p>
                    ) : null}
                    <label className={label}>
                        {isCnpj ? 'Razão social' : 'Nome completo'}
                        <input value={name} onChange={(e) => setName(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
                    </label>
                    <label className={label}>
                        Telefone com DDD
                        <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
                    </label>
                    {isCnpj ? (
                        <label className={label}>
                            Inscrição estadual (opcional)
                            <input value={stateRegistration} onChange={(e) => setStateRegistration(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
                        </label>
                    ) : null}
                    {kind ? (
                        <div className="mt-3">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-[13px] font-bold text-tower-600 dark:text-tower-300">Endereço</p>
                                <button
                                    type="button"
                                    onClick={() => setEditAddress((open) => !open)}
                                    className="min-h-[44px] text-[13px] font-bold text-brand-600 dark:text-brand-300"
                                >
                                    {editAddress ? 'Fechar' : addressLine ? 'Editar' : 'Informar'}
                                </button>
                            </div>
                            {!editAddress ? (
                                <p className="text-[13px] text-tower-600 dark:text-tower-300">
                                    {addressLine || 'Não informado — pode completar depois na ficha.'}
                                </p>
                            ) : (
                                <AddressFields value={address} onChange={setAddress} />
                            )}
                        </div>
                    ) : null}
                    {isCnpj ? (
                        <label className={label}>
                            Tipo de empresa na ANTT
                            <select value={carrierType} onChange={(e) => setCarrierType(e.target.value as 'ETC' | 'CTC' | 'FROTA')} className={clsx(osFieldClass, 'mt-1.5')}>
                                <option value="ETC">ETC — empresa de transporte</option>
                                <option value="CTC">CTC — cooperativa</option>
                                <option value="FROTA">Frota própria</option>
                            </select>
                            <span className="mt-1 block text-[12px] font-normal text-tower-500 dark:text-tower-400">
                                ETC: empresa com RNTRC · CTC: cooperativa · Frota: veículos próprios. CPF é sempre TAC (autônomo).
                            </span>
                        </label>
                    ) : kind === 'CPF' ? (
                        <p className="mt-2 text-[12px] text-tower-500 dark:text-tower-400">CPF é sempre TAC (autônomo).</p>
                    ) : null}
                    {error ? (
                        <p className="mt-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
                    ) : null}
                    <OsButton full className="mt-4" disabled={!ready || busy || looking} onClick={() => void create()}>
                        {busy ? 'Cadastrando…' : knownPerson ? 'Cadastrar transportador e completar ficha' : 'Cadastrar e completar ficha'}
                    </OsButton>
                </>
            )}
            {existingLink && error ? (
                <p className="mt-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
            ) : null}
            <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={onCancel}>
                Voltar para a lista
            </OsButton>
        </div>
    );
};

export default NewCarrierForm;
