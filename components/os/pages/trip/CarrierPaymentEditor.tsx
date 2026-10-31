import React, { useState } from 'react';
import { linksApi } from '../../../../lib/api';
import type { CarrierRegistry } from '../../lib/carrier';
import { ciotPaymentAccount, ciotPaymentFromAccount } from '../../lib/ciot';
import { OsButton, OsErrorNotice } from '../../ui/kit';
import { apiErrorMessage } from '../../ui/Sheet';
import PaymentAccountFields from './PaymentAccountFields';

const CarrierPaymentEditor: React.FC<{ registry: CarrierRegistry; onSaved: () => Promise<void> }> = ({ registry, onSaved }) => {
    const account = registry.link.person?.paymentAccounts?.[0];
    const [value, setValue] = useState(() => ciotPaymentFromAccount(account ?? {
        holderName: registry.link.person?.legalName ?? registry.link.name, holderDocument: registry.link.document,
    }));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            await linksApi.updateOwnerPerson(registry.link.id, { paymentAccount: ciotPaymentAccount(value) });
            await onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar os dados bancários. Complete também o endereço do transportador.'));
        } finally { setBusy(false); }
    };
    const ready = value.paymentMethod === 'PIX' ? Boolean(value.pixKey.trim() && value.pixKeyType)
        : Boolean(value.paymentBankCode.trim() && value.paymentAgency.trim() && value.paymentAccount.trim());
    return (
        <div className="flex flex-col gap-3">
            <PaymentAccountFields value={value} onChange={setValue} disabled={busy || !registry.canEdit} />
            {registry.canEdit ? <OsButton full variant="secondary" disabled={busy} onClick={() => setValue((current) => ({
                ...current, paymentMethod: 'PIX', pixKeyType: 'CpfOuCnpj', pixKey: registry.link.document.replace(/\D/g, ''),
            }))}>Sugerir CPF/CNPJ do transportador como chave PIX</OsButton> : null}
            <p className="text-[12px] text-tower-500">Confirme a chave ou a conta com o titular antes de salvar.</p>
            {error ? <OsErrorNotice message={error} /> : null}
            <OsButton full disabled={!registry.canEdit || busy || !ready} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar dados bancários'}</OsButton>
        </div>
    );
};

export default CarrierPaymentEditor;
