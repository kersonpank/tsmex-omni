import React, { useEffect, useState } from 'react';
import { personsApi } from '../../../../lib/api';
import type { Person } from '../../../../types/index';
import { PersonFormModal } from '../../../ui/PersonFormModal';
import { osFieldClass } from '../../ui/Sheet';

/**
 * Remetente ou destinatário da entrada. Vem pronto da NF-e quando o XML já foi baixado;
 * senão, busca por nome/documento ou cadastra na hora (formulário de pessoa existente,
 * com as validações de endereço/IBGE). Nunca adivinha a pessoa.
 */
const PartyPicker: React.FC<{
    label: string;
    value: Person | null;
    suggestedName?: string | null;
    onChange: (person: Person | null) => void;
}> = ({ label, value, suggestedName, onChange }) => {
    const [q, setQ] = useState(suggestedName ?? '');
    const [hits, setHits] = useState<Person[]>([]);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (value) return;
        const term = q.trim();
        if (term.length < 2) {
            setHits([]);
            return;
        }
        const timer = window.setTimeout(() => {
            personsApi
                .search(term)
                .then((body) => setHits((body.data ?? []).slice(0, 6)))
                .catch(() => setHits([]));
        }, 250);
        return () => window.clearTimeout(timer);
    }, [q, value]);

    return (
        <div className="mt-4">
            <p className="mb-1.5 text-[13px] font-bold text-tower-600 dark:text-tower-300">{label}</p>
            {value ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-emerald-500/60 bg-emerald-500/5 p-3">
                    <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-tower-900 dark:text-white">{value.legalName}</p>
                        <p className="truncate text-[12px] text-tower-500 dark:text-tower-400">
                            {value.document}
                            {value.city ? ` · ${value.city}/${value.state}` : ''}
                        </p>
                    </div>
                    <button type="button" onClick={() => onChange(null)} className="shrink-0 text-[13px] font-bold text-brand-600 dark:text-brand-300">
                        Trocar
                    </button>
                </div>
            ) : (
                <>
                    <input
                        type="search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Nome, CNPJ ou CPF…"
                        className={osFieldClass}
                    />
                    <div className="mt-1.5 flex flex-col gap-1.5">
                        {hits.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => onChange(p)}
                                className="min-h-[48px] rounded-xl border border-tower-200 px-3 text-left active:bg-tower-50 dark:border-tower-700 dark:active:bg-tower-800"
                            >
                                <span className="block truncate text-[14px] font-semibold text-tower-900 dark:text-white">{p.legalName}</span>
                                <span className="block truncate text-[12px] text-tower-500">
                                    {p.document}
                                    {p.city ? ` · ${p.city}/${p.state}` : ''}
                                </span>
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => setCreating(true)}
                            className="min-h-[44px] rounded-xl border-2 border-dashed border-tower-300 text-[13px] font-bold text-tower-600 active:bg-tower-50 dark:border-tower-600 dark:text-tower-300"
                        >
                            Cadastrar {label.toLowerCase()}
                        </button>
                    </div>
                </>
            )}
            {creating ? (
                <PersonFormModal
                    mode="create"
                    title={`Cadastrar ${label.toLowerCase()}`}
                    initialValues={{ legalName: suggestedName ?? q }}
                    onClose={() => setCreating(false)}
                    onSuccess={(person) => {
                        setCreating(false);
                        onChange(person);
                    }}
                />
            ) : null}
        </div>
    );
};

export default PartyPicker;
