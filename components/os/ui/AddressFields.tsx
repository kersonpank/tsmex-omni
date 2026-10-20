import React, { useState } from 'react';
import clsx from 'clsx';
import { locationsApi } from '../../../lib/api';
import { osFieldClass } from './Sheet';

/**
 * Endereço por CEP: a consulta preenche rua, bairro, cidade, UF e o código IBGE (exigido
 * pelo e-Frete no Gravar Proprietário/Motorista). Cidade/UF/IBGE só vêm do CEP — nunca digitados.
 */

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

export const EMPTY_ADDRESS: AddressValue = {
    cep: '',
    address: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: '',
    cityIbgeCode: '',
};

export function addressFrom(p: Partial<Record<keyof AddressValue, string | null | undefined>> | null | undefined): AddressValue {
    const v = (k: keyof AddressValue) => (p?.[k] ?? '') as string;
    return {
        cep: v('cep'),
        address: v('address'),
        number: v('number'),
        complement: v('complement'),
        neighborhood: v('neighborhood'),
        city: v('city'),
        state: v('state'),
        cityIbgeCode: v('cityIbgeCode'),
    };
}

export function addressReady(a: AddressValue): boolean {
    return Boolean(a.cep.replace(/\D/g, '').length === 8 && a.address && a.number && a.neighborhood && a.city && a.state && a.cityIbgeCode);
}

const AddressFields: React.FC<{ value: AddressValue; onChange: (v: AddressValue) => void }> = ({ value, onChange }) => {
    const [looking, setLooking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const lookup = async (rawCep: string) => {
        const cep = rawCep.replace(/\D/g, '');
        if (cep.length !== 8) return;
        setLooking(true);
        setError(null);
        try {
            const body = await locationsApi.getCEP(cep);
            const d = body.data ?? {};
            if (!d.cityIbgeCode) throw new Error('sem IBGE');
            onChange({
                ...value,
                cep,
                address: d.logradouro || value.address,
                neighborhood: d.bairro || value.neighborhood,
                city: d.cidade ?? d.city?.name ?? '',
                state: d.uf ?? d.state?.code ?? '',
                cityIbgeCode: d.cityIbgeCode,
            });
        } catch {
            setError('CEP não encontrado. Confira os números.');
            onChange({ ...value, cep, city: '', state: '', cityIbgeCode: '' });
        } finally {
            setLooking(false);
        }
    };

    const set = (k: keyof AddressValue) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
    const label = 'mt-3 block text-[13px] font-bold text-tower-600 dark:text-tower-300';

    return (
        <div>
            <label className={label}>
                CEP
                <input
                    inputMode="numeric"
                    value={value.cep}
                    onChange={(e) => {
                        onChange({ ...value, cep: e.target.value });
                        if (e.target.value.replace(/\D/g, '').length === 8) void lookup(e.target.value);
                    }}
                    placeholder="00000-000"
                    className={clsx(osFieldClass, 'mt-1.5')}
                />
            </label>
            {looking ? <p className="mt-1 text-[12px] text-tower-400">Buscando CEP…</p> : null}
            {error ? <p className="mt-1 text-[12px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
            {value.city ? (
                <p className="mt-2 rounded-lg bg-tower-100 px-3 py-2 text-[13px] text-tower-700 dark:bg-tower-800 dark:text-tower-200">
                    {value.city}/{value.state} <span className="font-mono text-[11px] text-tower-400">IBGE {value.cityIbgeCode}</span>
                </p>
            ) : null}
            <label className={label}>
                Rua
                <input value={value.address} onChange={set('address')} className={clsx(osFieldClass, 'mt-1.5')} />
            </label>
            <div className="grid grid-cols-[110px_1fr] gap-2">
                <label className={label}>
                    Número
                    <input value={value.number} onChange={set('number')} className={clsx(osFieldClass, 'mt-1.5')} />
                </label>
                <label className={label}>
                    Bairro
                    <input value={value.neighborhood} onChange={set('neighborhood')} className={clsx(osFieldClass, 'mt-1.5')} />
                </label>
            </div>
            <label className={label}>
                Complemento (opcional)
                <input value={value.complement} onChange={set('complement')} className={clsx(osFieldClass, 'mt-1.5')} />
            </label>
        </div>
    );
};

export default AddressFields;
