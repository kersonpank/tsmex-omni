import React, { useMemo, useState } from 'react';
import { clientsApi } from '../../../../lib/api';
import { accountOptionsFromClients, filterAccountOptions, type AccountOption, type ClientWithAccount } from '../../lib/comercialForms';
import { formatCnpjCpf, SearchInput } from '../../ui/form';
import { useResource } from '../../lib/resource';
import { Button } from '../../ui/kit';

/** Escolhe a conta por busca (nome ou CNPJ). Nunca pede o código interno da conta. */
export const AccountPicker: React.FC<{ value: AccountOption | null; onChange: (value: AccountOption | null) => void; invalid?: boolean }> = ({ value, onChange, invalid }) => {
    const state = useResource<ClientWithAccount[]>('clients:all', async () => ((await clientsApi.list()).data ?? []) as ClientWithAccount[], { staleMs: 120_000 });
    const [query, setQuery] = useState('');
    const options = useMemo(() => accountOptionsFromClients(state.data ?? []), [state.data]);
    const found = useMemo(() => filterAccountOptions(options, query), [options, query]);

    if (value) {
        return (
            <div className="gx-inset flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                    <p className="truncate font-semibold">{value.label}</p>
                    {value.document ? <p className="gx-mono gx-muted text-[12.5px]">{formatCnpjCpf(value.document)}</p> : null}
                </div>
                <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
                    Trocar
                </Button>
            </div>
        );
    }
    return (
        <div aria-invalid={invalid || undefined}>
            <SearchInput value={query} onChange={setQuery} placeholder="Buscar conta por nome ou CNPJ" aria-label="Conta" delay={150} />
            {state.error && !state.data ? <p className="gx-red-text mt-2 text-[12.5px]">{state.error}</p> : null}
            <ul className="mt-2 flex flex-col" role="listbox" aria-label="Contas encontradas">
                {found.map((option) => (
                    <li key={option.accountId} role="option" aria-selected={false}>
                        <button type="button" className="gx-row flex w-full items-center justify-between gap-3 text-left" onClick={() => onChange(option)}>
                            <span className="truncate font-semibold">{option.label}</span>
                            <span className="gx-mono gx-muted flex-none text-[12.5px]">{option.document ? formatCnpjCpf(option.document) : ''}</span>
                        </button>
                    </li>
                ))}
                {state.data && found.length === 0 ? <li className="gx-muted px-2 py-3 text-[13px]">Nenhuma conta encontrada. A conta nasce quando o cliente é cadastrado.</li> : null}
            </ul>
        </div>
    );
};
