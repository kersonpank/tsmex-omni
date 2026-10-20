import React, { useEffect, useState } from 'react';
import { personsApi } from '../../../../lib/api';
import type { Person } from '../../../../types/index';
import { PersonFormModal, type PersonFormModalInitialValues } from '../../../ui/PersonFormModal';
import { classifyPartyQuery, formatDocument } from '../../lib/entry';
import { apiErrorMessage, osFieldClass } from '../../ui/Sheet';
import PartyCard, { type PartySource } from './PartyCard';

/**
 * Remetente ou destinatário da entrada. Pronto quando a NF-e (ou o cadastro público do CNPJ)
 * já resolveu; senão, o campo começa VAZIO — o operador toca e digita, sem apagar nada.
 * O que ele digita decide o cadastro oferecido: CNPJ → um toque, pelos dados da Receita;
 * CPF ou nome → formulário já com o que foi digitado. Nunca adivinha a pessoa.
 */
const PartyPicker: React.FC<{
    label: string;
    value: Person | null;
    source: PartySource;
    onChange: (person: Person | null, source: PartySource) => void;
}> = ({ label, value, source, onChange }) => {
    const [q, setQ] = useState('');
    const [hits, setHits] = useState<Person[]>([]);
    const [searched, setSearched] = useState('');
    const [creating, setCreating] = useState<PersonFormModalInitialValues | null>(null);
    const [publicBusy, setPublicBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const query = classifyPartyQuery(q);
    const noun = label.toLowerCase();

    useEffect(() => {
        if (value) return;
        const term = q.trim();
        if (term.length < 2) {
            setHits([]);
            setSearched('');
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            personsApi
                .search(term)
                .then((body) => !cancelled && setHits((body.data ?? []).slice(0, 6)))
                .catch(() => !cancelled && setHits([]))
                .finally(() => !cancelled && setSearched(term));
        }, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [q, value]);

    if (value) {
        return (
            <Section label={label}>
                <PartyCard
                    person={value}
                    source={source}
                    onEdited={(person) => onChange(person, source)}
                    onChange={() => {
                        setQ('');
                        onChange(null, 'manual');
                    }}
                />
            </Section>
        );
    }

    const exactDocumentHit =
        (query.kind === 'cnpj' || query.kind === 'cpf') && hits.some((p) => p.document.replace(/\D/g, '') === query.digits);

    const createFromPublicCnpj = async (cnpj: string) => {
        setPublicBusy(true);
        setError(null);
        try {
            const person = (await personsApi.fromPublicCnpj(cnpj)).data;
            if (person) onChange(person, 'public_cnpj');
        } catch (cause) {
            // Sem dados públicos agora: o formulário abre com o CNPJ, o operador completa.
            setError(apiErrorMessage(cause, 'Não foi possível consultar a Receita agora.'));
            setCreating({ documentType: 'CNPJ', document: cnpj });
        } finally {
            setPublicBusy(false);
        }
    };

    const createAction = (() => {
        if (query.kind === 'cnpj') {
            return {
                text: publicBusy ? 'Consultando a Receita…' : `Cadastrar ${formatDocument(query.digits)} pela Receita`,
                run: () => void createFromPublicCnpj(query.digits),
                strong: true,
            };
        }
        if (query.kind === 'cpf') {
            return { text: `Cadastrar CPF ${formatDocument(query.digits)}`, run: () => setCreating({ documentType: 'CPF', document: query.digits }), strong: true };
        }
        if (query.kind === 'name') {
            return { text: `Cadastrar “${query.text}”`, run: () => setCreating({ legalName: query.text }), strong: searched === q.trim() && hits.length === 0 };
        }
        return { text: `Cadastrar ${noun}`, run: () => setCreating({}), strong: false };
    })();

    return (
        <Section label={label}>
            <input
                type="search"
                value={q}
                onChange={(e) => {
                    setQ(e.target.value);
                    setError(null);
                }}
                placeholder="Nome, CNPJ ou CPF"
                autoComplete="off"
                enterKeyHint="search"
                className={osFieldClass}
            />
            {error ? <p className="mt-1.5 text-[12px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
            <div className="mt-1.5 flex flex-col gap-1.5">
                {hits.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => onChange(p, 'manual')}
                        className="min-h-[52px] rounded-xl border border-tower-200 px-3 py-1.5 text-left active:bg-tower-50 dark:border-tower-700 dark:active:bg-tower-800"
                    >
                        <span className="block truncate text-[14px] font-semibold text-tower-900 dark:text-white">{p.legalName}</span>
                        <span className="block truncate font-mono text-[12px] text-tower-500">
                            {formatDocument(p.document)}
                            {p.city ? ` · ${p.city}/${p.state}` : ''}
                        </span>
                    </button>
                ))}
                {searched && searched === q.trim() && hits.length === 0 ? (
                    <p className="px-1 text-[12px] text-tower-400">Nenhum cadastro com “{searched}”.</p>
                ) : null}
                {exactDocumentHit ? null : (
                    <button
                        type="button"
                        onClick={createAction.run}
                        disabled={publicBusy}
                        className={
                            createAction.strong
                                ? 'min-h-[48px] rounded-xl bg-brand-600 px-3 text-[14px] font-bold text-white active:bg-brand-700 disabled:opacity-60'
                                : 'min-h-[44px] rounded-xl border-2 border-dashed border-tower-300 text-[13px] font-bold text-tower-600 active:bg-tower-50 dark:border-tower-600 dark:text-tower-300'
                        }
                    >
                        {createAction.text}
                    </button>
                )}
            </div>
            {creating ? (
                <PersonFormModal
                    mode="create"
                    title={`Cadastrar ${noun}`}
                    initialValues={creating}
                    onClose={() => setCreating(null)}
                    onSuccess={(person) => {
                        setCreating(null);
                        onChange(person, 'manual');
                    }}
                />
            ) : null}
        </Section>
    );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="mt-4">
        <p className="mb-1.5 text-[13px] font-bold text-tower-600 dark:text-tower-300">{label}</p>
        {children}
    </div>
);

export default PartyPicker;
