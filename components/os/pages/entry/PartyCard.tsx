import React, { useState } from 'react';
import type { Person } from '../../../../types/index';
import { PersonFormModal, type PersonFormModalInitialValues } from '../../../ui/PersonFormModal';
import { formatDocument, partyGaps } from '../../lib/entry';

/** De onde a pessoa veio — o operador vê a origem do dado antes de confirmar. */
export type PartySource = 'nfe_xml' | 'public_cnpj' | 'manual';

const SOURCE_LABEL: Record<PartySource, string | null> = {
    nfe_xml: 'da NF-e',
    public_cnpj: 'dados públicos da Receita',
    manual: null,
};

export function personFormValues(person: Person): PersonFormModalInitialValues {
    return {
        documentType: person.documentType,
        document: person.document,
        legalName: person.legalName,
        tradeName: person.tradeName ?? '',
        cep: person.cep ?? '',
        address: person.address ?? '',
        number: person.number ?? '',
        complement: person.complement ?? '',
        neighborhood: person.neighborhood ?? '',
        city: person.city ?? '',
        cityIbgeCode: person.cityIbgeCode ?? '',
        state: person.state ?? '',
        country: person.country ?? 'BRASIL',
        stateRegistration: person.stateRegistration ?? '',
        municipalRegistration: person.municipalRegistration ?? '',
    };
}

/**
 * Pessoa escolhida na entrada: nome, documento, cidade e de onde veio. O que falta para o
 * CT-e (cidade IBGE, IE) aparece aqui — divergência nunca silenciosa — e "Editar" resolve na hora.
 */
const PartyCard: React.FC<{
    person: Person;
    source: PartySource;
    onEdited: (person: Person) => void;
    onChange: () => void;
    stateRegistrationSuggestion?: { value: string; source: string };
}> = ({ person, source, onEdited, onChange, stateRegistrationSuggestion }) => {
    const [editing, setEditing] = useState(false);
    const gaps = partyGaps(person);
    const sourceLabel = SOURCE_LABEL[source];
    const ie = person.stateRegistration?.trim();
    const comparableIe = (value: string) => value.toUpperCase() === 'ISENTO' ? 'ISENTO' : value.replace(/\D/g, '');
    const differentIe = ie && stateRegistrationSuggestion && comparableIe(ie) !== comparableIe(stateRegistrationSuggestion.value);

    return (
        <div className="rounded-xl border-2 border-emerald-500/60 bg-emerald-500/5 p-3">
            <p className="truncate text-[15px] font-semibold text-tower-900 dark:text-white">{person.legalName}</p>
            <p className="mt-0.5 truncate font-mono text-[12px] text-tower-500 dark:text-tower-400">
                {formatDocument(person.document)}
                {person.city ? ` · ${person.city}/${person.state}` : ''}
            </p>
            {person.documentType === 'CNPJ' && ie ? <p className="mt-0.5 text-[12px] text-tower-600 dark:text-tower-300">IE: {ie}</p> : null}
            {differentIe ? <p className="mt-1 text-[12px] font-semibold text-[#8a6d00] dark:text-brand-yellow-400">A IE da NF-e é {stateRegistrationSuggestion.value}. Confira em Editar.</p> : null}
            {sourceLabel || gaps.length > 0 ? (
                <p className="mt-1 text-[12px]">
                    {sourceLabel ? <span className="text-emerald-700 dark:text-emerald-400">{sourceLabel}</span> : null}
                    {sourceLabel && gaps.length > 0 ? <span className="text-tower-400"> · </span> : null}
                    {gaps.length > 0 ? (
                        <span className="font-semibold text-[#8a6d00] dark:text-brand-yellow-400">
                            sem {gaps.join(' e ')} para o CT-e
                        </span>
                    ) : null}
                </p>
            ) : null}
            <div className="mt-2 flex gap-4">
                <button type="button" onClick={() => setEditing(true)} className="min-h-[36px] text-[13px] font-bold text-brand-600 dark:text-brand-300">
                    {gaps.length > 0 ? 'Completar cadastro' : 'Editar'}
                </button>
                <button type="button" onClick={onChange} className="min-h-[36px] text-[13px] font-bold text-tower-500 dark:text-tower-400">
                    Trocar
                </button>
            </div>
            {editing ? (
                <PersonFormModal
                    mode="edit"
                    personId={person.id}
                    initialValues={personFormValues(person)}
                    stateRegistrationSuggestion={stateRegistrationSuggestion}
                    onClose={() => setEditing(false)}
                    onSuccess={(updated) => {
                        setEditing(false);
                        onEdited(updated);
                    }}
                />
            ) : null}
        </div>
    );
};

export default PartyCard;
