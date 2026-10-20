import React, { useState } from 'react';
import clsx from 'clsx';
import { linksApi } from '../../../../lib/api';
import { digits, type CarrierRegistry } from '../../lib/carrier';
import AddressFields, { addressFrom, addressReady, type AddressValue } from '../../ui/AddressFields';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

/** Transportador: razão social/nome e endereço do proprietário (Gravar Proprietário no e-Frete). */
const CarrierInfoEditor: React.FC<{ registry: CarrierRegistry; onClose: () => void; onSaved: () => void }> = ({
    registry,
    onClose,
    onSaved,
}) => {
    const [legalName, setLegalName] = useState(registry.link.person?.legalName ?? registry.link.name);
    const [address, setAddress] = useState<AddressValue>(() => addressFrom(registry.link.person));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ready = Boolean(legalName.trim()) && addressReady(address);

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            await linksApi.updateOwnerPerson(registry.link.id, {
                legalName: legalName.trim(),
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
            });
            onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar o transportador.'));
            setBusy(false);
        }
    };

    return (
        <OsSheet
            title="Transportador"
            subtitle={`${digits(registry.link.document).length === 11 ? 'CPF' : 'CNPJ'} ${registry.link.document}`}
            onClose={onClose}
            footer={
                <>
                    {error ? (
                        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
                    ) : null}
                    <OsButton full disabled={!ready || busy} onClick={() => void save()}>
                        {busy ? 'Salvando…' : 'Salvar transportador'}
                    </OsButton>
                </>
            }
        >
            <label className="block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                Nome / razão social
                <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
            </label>
            <p className="mb-1 mt-5 font-display text-[15px] font-bold text-tower-900 dark:text-white">Endereço</p>
            <AddressFields value={address} onChange={setAddress} />
        </OsSheet>
    );
};

export default CarrierInfoEditor;
