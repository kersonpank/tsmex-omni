import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { linksApi, manifestsApi, personsApi } from '../../../../lib/api';
import {
    classifyDocument,
    digits,
    formatPersonAddress,
    resolveCarrierLookup,
    type CarrierLookup,
    type SearchedPerson,
} from '../../lib/carrier';
import { OsButton } from '../../ui/kit';
import { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

/**
 * Cadastrar transportador pelo hub (NORTE #22): cria, aprova pelo próprio hub (fica
 * registrado quem aprovou), coloca na viagem e abre a ficha para completar CIOT/MDF-e.
 * CPF = autônomo (TAC): o motorista é criado junto, com os dados da mesma pessoa.
 *
 * Ao completar o documento, consulta primeiro o nosso cadastro (transportador ou pessoa já
 * existente) e, para CNPJ novo, os dados públicos da Receita — sem redigitar razão social/endereço.
 */
const NewCarrierForm: React.FC<{
    manifestId: string;
    onCreated: (linkId: string) => void;
    /** Transportador que já existia e foi só colocado na viagem. */
    onUsed?: () => void;
    onCancel: () => void;
}> = ({ manifestId, onCreated, onUsed, onCancel }) => {
    const [doc, setDoc] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [carrierType, setCarrierType] = useState<'ETC' | 'CTC' | 'FROTA'>('ETC');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lookup, setLookup] = useState<CarrierLookup | null>(null);
    const [looking, setLooking] = useState(false);
    const [publicPerson, setPublicPerson] = useState<SearchedPerson | null>(null);
    const [publicFailed, setPublicFailed] = useState(false);
    const d = digits(doc);
    const kind = classifyDocument(doc);
    const isCnpj = kind === 'CNPJ';
    const ready = kind !== null && name.trim().length > 1 && digits(phone).length >= 10;
    const knownPerson = lookup?.kind === 'PERSON' ? lookup.person : publicPerson;

    useEffect(() => {
        setLookup(null);
        setPublicPerson(null);
        setPublicFailed(false);
        if (!classifyDocument(d)) return;
        let cancelled = false;
        setLooking(true);
        (async () => {
            try {
                const found = resolveCarrierLookup(((await personsApi.search(d)).data ?? []) as SearchedPerson[], d);
                if (cancelled) return;
                setLookup(found);
                if (found.kind === 'PERSON') {
                    setName((current) => current || found.person.legalName);
                } else if (found.kind === 'NONE' && d.length === 14) {
                    try {
                        const body = await personsApi.fromPublicCnpj(d);
                        if (cancelled) return;
                        const person = body.data as unknown as SearchedPerson;
                        setPublicPerson(person);
                        setName((current) => current || person.legalName);
                    } catch {
                        if (!cancelled) setPublicFailed(true);
                    }
                }
            } catch {
                // Sem consulta, o cadastro manual continua valendo.
            } finally {
                if (!cancelled) setLooking(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [d]);

    const useExisting = async (linkId: string) => {
        setBusy(true);
        setError(null);
        try {
            const link = (await linksApi.getById(linkId)).data;
            if (link.approvalStatus === 'PENDING') await linksApi.approve(linkId);
            await manifestsApi.setResponsible(manifestId, linkId);
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
            await linksApi.approve(linkId);
            await manifestsApi.setResponsible(manifestId, linkId);
            onCreated(linkId);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível cadastrar o transportador.'));
            setBusy(false);
        }
    };

    const label = 'mt-3 block text-[13px] font-bold text-tower-600 first:mt-0 dark:text-tower-300';
    return (
        <div>
            <label className={label}>
                CPF (autônomo) ou CNPJ (empresa)
                <input inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
            </label>
            {looking ? <p className="mt-2 text-[12px] text-tower-500 dark:text-tower-400">Consultando cadastro…</p> : null}

            {lookup?.kind === 'LINK' ? (
                <div className="mt-3 rounded-xl border-2 border-brand-500 bg-brand-500/8 p-3.5">
                    <p className="text-[12px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-300">Já cadastrado</p>
                    <p className="mt-0.5 text-[15px] font-semibold text-tower-900 dark:text-white">{lookup.name}</p>
                    <OsButton full className="mt-3" disabled={busy} onClick={() => void useExisting(lookup.linkId)}>
                        {busy ? 'Usando…' : 'Usar este transportador'}
                    </OsButton>
                </div>
            ) : (
                <>
                    {lookup?.kind === 'PERSON' ? (
                        <p className="mt-2 rounded-lg bg-tower-100 p-2.5 text-[12px] text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                            Pessoa já cadastrada no sistema — dados reaproveitados.
                            {formatPersonAddress(lookup.person) ? ` ${formatPersonAddress(lookup.person)}` : ''}
                        </p>
                    ) : null}
                    {publicPerson ? (
                        <p className="mt-2 rounded-lg bg-tower-100 p-2.5 text-[12px] text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                            Dados públicos da Receita aplicados (razão social e endereço).
                            {formatPersonAddress(publicPerson) ? ` ${formatPersonAddress(publicPerson)}` : ''}
                        </p>
                    ) : null}
                    {publicFailed ? (
                        <p className="mt-2 text-[12px] text-tower-500 dark:text-tower-400">
                            Não encontramos este CNPJ nos dados públicos agora. Preencha manualmente.
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
            {lookup?.kind === 'LINK' && error ? (
                <p className="mt-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
            ) : null}
            <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={onCancel}>
                Voltar para a lista
            </OsButton>
        </div>
    );
};

export default NewCarrierForm;
