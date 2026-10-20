import React, { useState } from 'react';
import clsx from 'clsx';
import { linksApi, manifestsApi } from '../../../../lib/api';
import { digits } from '../../lib/carrier';
import { OsButton } from '../../ui/kit';
import { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

/**
 * Cadastrar transportador pelo hub (NORTE #22): cria, aprova pelo próprio hub (fica
 * registrado quem aprovou), coloca na viagem e abre a ficha para completar CIOT/MDF-e.
 * CPF = autônomo (TAC): o motorista é criado junto, com os dados da mesma pessoa.
 */
const NewCarrierForm: React.FC<{ manifestId: string; onCreated: (linkId: string) => void; onCancel: () => void }> = ({
    manifestId,
    onCreated,
    onCancel,
}) => {
    const [doc, setDoc] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [carrierType, setCarrierType] = useState<'ETC' | 'CTC' | 'FROTA'>('ETC');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const d = digits(doc);
    const isCnpj = d.length === 14;
    const ready = (d.length === 11 || isCnpj) && name.trim().length > 1 && digits(phone).length >= 10;

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
                </label>
            ) : null}
            {error ? (
                <p className="mt-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
            ) : null}
            <OsButton full className="mt-4" disabled={!ready || busy} onClick={() => void create()}>
                {busy ? 'Cadastrando…' : 'Cadastrar e completar ficha'}
            </OsButton>
            <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={onCancel}>
                Voltar para a lista
            </OsButton>
        </div>
    );
};

export default NewCarrierForm;
