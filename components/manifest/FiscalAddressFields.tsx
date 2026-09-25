import React, { useEffect, useId, useState } from 'react';
import { locationsApi, formatApiError } from '../../lib/api';
import { CityAutocomplete } from '../ui/CityAutocomplete';

export interface FiscalAddress {
  cep: string; address: string; number: string; complement: string;
  neighborhood: string; city: string; state: string; cityIbgeCode: string;
}
export function fiscalAddressFromPerson(person?: Partial<Record<keyof FiscalAddress, string | null>> | null): FiscalAddress {
  return { cep: person?.cep ?? '', address: person?.address ?? '', number: person?.number ?? '',
    complement: person?.complement ?? '', neighborhood: person?.neighborhood ?? '',
    city: person?.city ?? '', state: person?.state ?? '', cityIbgeCode: person?.cityIbgeCode ?? '' };
}
export function FiscalAddressFields<T extends FiscalAddress>({ value, onChange, readOnly, fieldClass, required = true }: {
  value: T; onChange: React.Dispatch<React.SetStateAction<T>>; readOnly: boolean; fieldClass: string; required?: boolean;
}) {
  const id = useId();
  const [status, setStatus] = useState<'idle' | 'loading' | 'resolved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    const cep = value.cep.replace(/\D/g, '');
    if (readOnly || cep.length !== 8) { setStatus('idle'); return; }
    setStatus('loading'); setError('');
    onChange(form => ({ ...form, city: '', state: '', cityIbgeCode: '' }));
    const timer = setTimeout(async () => {
      try {
        const response = await locationsApi.getCEP(cep);
        if (!current) return;
        const data = response.data;
        if (!data?.cityIbgeCode || !data.cidade || !data.uf) throw new Error('CEP sem município confirmado. Selecione a cidade na busca.');
        onChange(form => form.cep.replace(/\D/g, '') !== cep ? form : ({
          ...form, address: data.logradouro || form.address, neighborhood: data.bairro || form.neighborhood,
          city: data.cidade, state: data.uf, cityIbgeCode: data.cityIbgeCode,
        }));
        setStatus('resolved');
      } catch (cause) { if (current) { setError(formatApiError(cause)); setStatus('error'); } }
    }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [value.cep, readOnly, retry, onChange]);
  const locked = readOnly || status === 'resolved' || status === 'loading';
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${id}-cep`} className="mb-2 block text-sm font-bold">CEP{required && '*'}</label>
        <input id={`${id}-cep`} inputMode="numeric" maxLength={9} value={value.cep} disabled={readOnly} className={fieldClass} placeholder="00000000"
          onChange={event => { setStatus('idle'); onChange(form => ({ ...form, cep: event.target.value.replace(/\D/g, ''), city: '', state: '', cityIbgeCode: '' })); }} />
        {status === 'loading' && <p role="status" className="mt-1 text-xs">Consultando CEP…</p>}
        {status === 'resolved' && <p role="status" className="mt-1 text-xs text-tower-600 dark:text-tower-300">Cidade confirmada pelo CEP. Altere o CEP para mudar o município.</p>}
        {error && status === 'error' && <div role="alert" className="mt-1 text-sm text-red-600">{error} <button type="button" onClick={() => setRetry(i => i + 1)} className="underline">Tentar novamente</button><p>Você também pode selecionar a cidade na busca abaixo.</p></div>}
      </div>
      {([['address', 'Logradouro*'], ['number', 'Número*'], ['complement', 'Complemento'], ['neighborhood', 'Bairro*']] as const).map(([key, label]) => (
        <div key={key}><label htmlFor={`${id}-${key}`} className="mb-2 block text-sm font-bold">{required ? label : label.replace('*', '')}</label>
          <input id={`${id}-${key}`} value={value[key]} disabled={readOnly} onChange={event => onChange(form => ({ ...form, [key]: event.target.value }))} className={fieldClass} />
        </div>
      ))}
      <div><label htmlFor={`${id}-city`} className="mb-2 block text-sm font-bold">Cidade{required && '*'}</label>
        <CityAutocomplete id={`${id}-city`} value={value.city} selectedIbgeCode={value.cityIbgeCode} disabled={locked} required={required} className={fieldClass}
          onChange={city => onChange(form => ({ ...form, city, state: '', cityIbgeCode: '' }))}
          onSelect={(city, state, cityIbgeCode) => onChange(form => ({ ...form, city, state, cityIbgeCode }))} />
      </div>
      <div><label htmlFor={`${id}-state`} className="mb-2 block text-sm font-bold">Estado (UF){required && '*'}</label>
        <input id={`${id}-state`} value={value.state} readOnly className={fieldClass} placeholder="Preenchido pela cidade" />
      </div>
    </div>
  );
}
