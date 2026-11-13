import React, { useState } from 'react';
import { linksApi } from '../../../../../lib/api';
import type { Link } from '../../../../../types/index';
import type { CarrierRegistry } from '../../../../os/lib/carrier';
import { carrierTypeLabel } from '../../../lib/redeCarriers';
import { carrierKindOptions, type CarrierKind } from '../../../lib/redeFrota';
import { invalidate } from '../../../lib/resource';
import { Button, Field, SelectInput, TextInput } from '../../../ui/kit';
import { FormFooter, FormSection } from '../../../ui/form';
import { useAction } from '../../../ui/overlay';
import { VehicleTypeSelect } from '../../../ui/pickers';
import { AddressBlock, addressBody, addressFrom, addressReady, type AddressValue } from './AddressBlock';

/**
 * Editar transportador: tipo e tipo de veículo (PATCH /links/:id/fiscal) e razão social + endereço
 * do proprietário (PATCH /links/:id/owner-person). Nome, telefone e base só o próprio transportador altera no servidor.
 */
export const CarrierDataForm: React.FC<{ link: Link; registry: CarrierRegistry; onDone: () => void; onCancel: () => void }> = ({ link, registry, onDone, onCancel }) => {
    const { busy, run } = useAction();
    const person = registry.link.person;
    const kinds = carrierKindOptions(registry.link.document);
    const [legalName, setLegalName] = useState(person?.legalName ?? registry.link.name);
    const [carrierType, setCarrierType] = useState<string>(link.carrierType ?? registry.link.carrierType ?? '');
    const [vehicleTypeId, setVehicleTypeId] = useState<string>(link.vehicleTypeId ?? '');
    const [address, setAddress] = useState<AddressValue>(() => addressFrom(person));
    const [touched, setTouched] = useState(false);
    const addressTouched = Object.values(address).some(Boolean);
    const addressError = touched && addressTouched && !addressReady(address) ? 'Endereço incompleto: confirme o CEP e informe o número.' : null;
    const nameError = touched && !legalName.trim() ? 'Informe o nome.' : null;

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (!legalName.trim() || (addressTouched && !addressReady(address))) return;
        const ok = await run(
            'carrier:edit',
            async () => {
                const fiscal: { carrierType?: CarrierKind; vehicleTypeId?: string } = {};
                if (kinds.length > 1 && carrierType && carrierType !== (link.carrierType ?? '')) fiscal.carrierType = carrierType as CarrierKind;
                if (vehicleTypeId && vehicleTypeId !== (link.vehicleTypeId ?? '')) fiscal.vehicleTypeId = vehicleTypeId;
                if (Object.keys(fiscal).length) await linksApi.updateFiscal(link.id, fiscal);
                await linksApi.updateOwnerPerson(link.id, { legalName: legalName.trim(), ...(addressReady(address) ? { updatePersonAddress: true, address: addressBody(address) } : {}) });
            },
            { success: 'Transportador atualizado.', error: 'Não foi possível salvar o transportador.' },
        );
        if (ok) {
            invalidate('links:', 'vehicle-types');
            onDone();
        }
    };

    return (
        <form onSubmit={save} noValidate>
            <FormSection title="Transportador" hint={`Documento ${registry.link.document}. O telefone e a base só o próprio transportador altera.`}>
                <Field label="Nome / razão social" error={nameError} className="col-span-full">
                    <TextInput value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                </Field>
                <Field label="Tipo de transportador">
                    <SelectInput value={carrierType} disabled={kinds.length <= 1} onChange={(e) => setCarrierType(e.target.value)}>
                        {!carrierType ? <option value="">—</option> : null}
                        {(kinds.length ? kinds : (['TAC', 'ETC', 'CTC', 'FROTA'] as CarrierKind[])).map((k) => <option key={k} value={k}>{carrierTypeLabel(k)}</option>)}
                    </SelectInput>
                </Field>
                <Field label="Tipo de veículo">
                    <VehicleTypeSelect value={vehicleTypeId || null} onChange={(id) => setVehicleTypeId(id ?? '')} />
                </Field>
            </FormSection>
            <FormSection title="Endereço do proprietário" hint="Exigido pelo e-Frete (Gravar Proprietário).">
                <AddressBlock value={address} onChange={setAddress} error={addressError} />
            </FormSection>
            <FormFooter secondary={<Button onClick={onCancel} disabled={busy != null}>Voltar à ficha</Button>} primary={<Button type="submit" variant="primary" loading={busy === 'carrier:edit'}>Salvar transportador</Button>} />
        </form>
    );
};
