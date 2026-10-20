import React, { useState } from 'react';
import clsx from 'clsx';
import { linksApi } from '../../../../lib/api';
import { digits, UFS, type RegistryDriver } from '../../lib/carrier';
import AddressFields, { addressFrom, addressReady, type AddressValue } from '../../ui/AddressFields';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

/**
 * Motorista com tudo que o e-Frete (Gravar Motorista) e o MDF-e (condutor) exigem:
 * CPF, nome, telefone, nascimento, CNH (número, categoria, validade, UF) e endereço com IBGE.
 */

const toDate = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

const DriverEditor: React.FC<{
    linkId: string;
    driver: RegistryDriver | null;
    onClose: () => void;
    onSaved: (driverId: string) => void;
}> = ({ linkId, driver, onClose, onSaved }) => {
    const [name, setName] = useState(driver?.name ?? '');
    const [cpf, setCpf] = useState(driver?.document ?? '');
    const [phone, setPhone] = useState(driver?.phone ?? '');
    const [birthDate, setBirthDate] = useState(toDate(driver?.birthDate));
    const [cnhNumber, setCnhNumber] = useState(driver?.cnhNumber ?? '');
    const [cnhCategory, setCnhCategory] = useState(driver?.cnhCategory ?? 'E');
    const [cnhExpiry, setCnhExpiry] = useState(toDate(driver?.cnhExpiry));
    const [cnhState, setCnhState] = useState(driver?.cnhState ?? driver?.person?.state ?? '');
    const [address, setAddress] = useState<AddressValue>(() => addressFrom(driver?.person));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const missing = [
        !name.trim() && 'nome',
        digits(cpf).length !== 11 && 'CPF',
        digits(phone).length < 10 && 'telefone com DDD',
        !birthDate && 'nascimento',
        !cnhNumber.trim() && 'CNH',
        !cnhExpiry && 'validade da CNH',
        !addressReady(address) && 'endereço completo',
    ].filter(Boolean) as string[];

    const save = async () => {
        setBusy(true);
        setError(null);
        const payload = {
            name: name.trim(),
            phone: digits(phone),
            birthDate,
            cnhNumber: cnhNumber.trim(),
            cnhCategory,
            cnhExpiry,
            ...(cnhState ? { cnhState } : {}),
            updatePersonAddress: true,
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
        };
        try {
            if (driver) {
                await linksApi.updateDriver(linkId, driver.id, payload);
                onSaved(driver.id);
            } else {
                const body = await linksApi.createDriver(linkId, { ...payload, document: digits(cpf) });
                onSaved((body.data as { id: string }).id);
            }
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar o motorista.'));
            setBusy(false);
        }
    };

    const label = 'mt-3 block text-[13px] font-bold text-tower-600 first:mt-0 dark:text-tower-300';
    const field = (text: string, value: string, set: (v: string) => void, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
        <label className={label}>
            {text}
            <input {...props} value={value} onChange={(e) => set(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
        </label>
    );

    return (
        <OsSheet
            title={driver ? 'Motorista' : 'Novo motorista'}
            subtitle="Dados exigidos pelo CIOT (e-Frete) e pelo MDF-e"
            onClose={onClose}
            footer={
                <>
                    {error ? (
                        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
                    ) : missing.length ? (
                        <p className="mb-2 text-center text-[12px] text-tower-500">Falta: {missing.join(', ')}</p>
                    ) : null}
                    <OsButton full disabled={missing.length > 0 || busy} onClick={() => void save()}>
                        {busy ? 'Salvando…' : 'Salvar motorista'}
                    </OsButton>
                </>
            }
        >
            {field('Nome completo', name, setName)}
            {driver ? (
                <p className="mt-3 text-[13px] text-tower-500">CPF {driver.document}</p>
            ) : (
                field('CPF', cpf, setCpf, { inputMode: 'numeric', placeholder: '000.000.000-00' })
            )}
            {field('Telefone com DDD', phone, setPhone, { inputMode: 'tel' })}
            {field('Data de nascimento', birthDate, setBirthDate, { type: 'date' })}
            {field('Número da CNH', cnhNumber, setCnhNumber, { inputMode: 'numeric' })}
            <div className="grid grid-cols-3 gap-2">
                <label className={label}>
                    Categoria
                    <select value={cnhCategory} onChange={(e) => setCnhCategory(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')}>
                        {['E', 'D', 'C', 'B', 'AE', 'AD', 'AC'].map((c) => (
                            <option key={c}>{c}</option>
                        ))}
                    </select>
                </label>
                <label className={clsx(label, 'col-span-2')}>
                    Validade da CNH
                    <input type="date" value={cnhExpiry} onChange={(e) => setCnhExpiry(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
                </label>
            </div>
            <label className={label}>
                UF da CNH
                <select value={cnhState} onChange={(e) => setCnhState(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')}>
                    <option value="">—</option>
                    {UFS.map((uf) => (
                        <option key={uf}>{uf}</option>
                    ))}
                </select>
            </label>
            <p className="mb-1 mt-5 font-display text-[15px] font-bold text-tower-900 dark:text-white">Endereço do motorista</p>
            <AddressFields value={address} onChange={setAddress} />
        </OsSheet>
    );
};

export default DriverEditor;
