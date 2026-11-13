import React from 'react';
import { Field, TextInput } from '../../../ui/kit';
import { CepField } from '../../../ui/pickers';

export interface AddressValue {
    cep: string;
    address: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    cityIbgeCode: string;
}

type Source = Partial<Record<keyof AddressValue, string | null | undefined>> | null | undefined;

export const addressFrom = (p: Source): AddressValue => {
    const v = (k: keyof AddressValue) => p?.[k] ?? '';
    return { cep: v('cep'), address: v('address'), number: v('number'), complement: v('complement'), neighborhood: v('neighborhood'), city: v('city'), state: v('state'), cityIbgeCode: v('cityIbgeCode') };
};

export const addressReady = (a: AddressValue): boolean => a.cep.replace(/\D/g, '').length === 8 && Boolean(a.address && a.number && a.neighborhood && a.city && a.state && a.cityIbgeCode);

/** Corpo `address` do servidor (e-Frete exige município com código IBGE). */
export const addressBody = (a: AddressValue) => ({
    cep: a.cep.replace(/\D/g, ''),
    address: a.address,
    number: a.number,
    ...(a.complement ? { complement: a.complement } : {}),
    neighborhood: a.neighborhood,
    city: a.city,
    state: a.state,
    cityIbgeCode: a.cityIbgeCode,
});

/** CEP consulta rua, bairro, cidade, UF e IBGE sozinho (Copilot); número e complemento são digitados. */
export const AddressBlock: React.FC<{ value: AddressValue; onChange: (next: AddressValue) => void; error?: string | null }> = ({ value, onChange, error }) => (
    <>
        <Field label="CEP" error={error} hint="Rua, bairro e cidade vêm do CEP.">
            <CepField
                value={value.cep}
                onChange={(cep) => onChange({ ...value, cep })}
                onResolve={(r) => onChange({ ...value, cep: r.cep, address: r.street || value.address, neighborhood: r.neighborhood || value.neighborhood, city: r.city, state: r.state, cityIbgeCode: r.ibgeCode })}
            />
        </Field>
        <Field label="Cidade/UF">
            <TextInput readOnly value={value.city ? `${value.city}/${value.state}` : ''} placeholder="Preenchido pelo CEP" />
        </Field>
        <Field label="Rua">
            <TextInput value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} />
        </Field>
        <Field label="Número">
            <TextInput value={value.number} onChange={(e) => onChange({ ...value, number: e.target.value })} />
        </Field>
        <Field label="Bairro">
            <TextInput value={value.neighborhood} onChange={(e) => onChange({ ...value, neighborhood: e.target.value })} />
        </Field>
        <Field label="Complemento">
            <TextInput value={value.complement} onChange={(e) => onChange({ ...value, complement: e.target.value })} />
        </Field>
    </>
);
