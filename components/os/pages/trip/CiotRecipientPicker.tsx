import React, { useEffect, useRef, useState } from 'react';
import { personsApi } from '../../../../lib/api';
import type { Hub, Person } from '../../../../types/index';
import type { ManifestWithLegs } from '../../lib/arrival';
import { ciotRecipientFromHub, ciotRecipientFromPerson } from '../../lib/ciot';
import { OsButton, OsErrorNotice } from '../../ui/kit';
import { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

const CiotRecipientPicker: React.FC<{
    manifest: ManifestWithLegs;
    hubs: Hub[];
    onChange: (recipient: ReturnType<typeof ciotRecipientFromPerson>) => void;
}> = ({ manifest, hubs, onChange }) => {
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState<Person[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const version = useRef(0);
    const select = (recipient: ReturnType<typeof ciotRecipientFromPerson>) => {
        version.current++;
        setBusy(false);
        setQuery('');
        setHits([]);
        setError(null);
        onChange(recipient);
    };
    useEffect(() => {
        setHits([]);
        if (query.trim().length < 2) return;
        let active = true;
        const timer = window.setTimeout(() => {
            void personsApi.search(query.trim()).then((response) => { if (active) setHits((response.data ?? []).slice(0, 6)); })
                .catch((cause) => { if (active) setError(apiErrorMessage(cause, 'Não foi possível buscar pessoas.')); });
        }, 250);
        return () => { active = false; window.clearTimeout(timer); };
    }, [query]);
    const lookup = async () => {
        const requestVersion = ++version.current;
        setBusy(true);
        setError(null);
        try {
            const data = (await personsApi.lookupDocument(query)).data;
            if (requestVersion !== version.current) return;
            const person = data?.person ?? (data?.suggestion ? { ...data.suggestion, document: query.replace(/\D/g, '') } : null);
            if (person) select(ciotRecipientFromPerson(person));
            else setError('Documento não encontrado. Confira o CPF/CNPJ ou preencha os dados abaixo.');
        } catch (cause) { if (requestVersion === version.current) setError(apiErrorMessage(cause, 'Não foi possível consultar o documento.')); }
        finally { if (requestVersion === version.current) setBusy(false); }
    };
    const recipients = [...(manifest.demands ?? []).map((demand) => demand.order?.destinatarioPerson),
        ...(manifest.legs ?? []).map((leg) => leg.order?.destinatarioPerson)]
        .filter((person, index, all) => person?.document && all.findIndex((other) => other?.document === person.document) === index);
    return (
        <div className="mb-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
                {manifest.destHub ? <OsButton variant="secondary" onClick={() => select(ciotRecipientFromHub(manifest.destHub!))}>Hub destino: {manifest.destHub.name}</OsButton> : null}
                {hubs.filter((hub) => hub.active && hub.id !== manifest.destHubId && hub.id !== manifest.hubId).map((hub) => (
                    <OsButton key={hub.id} variant="secondary" onClick={() => select(ciotRecipientFromHub(hub))}>{hub.name}</OsButton>
                ))}
                {recipients.map((person) => person ? <OsButton key={person.document} variant="secondary" onClick={() => select(ciotRecipientFromPerson(person))}>{person.legalName}</OsButton> : null)}
            </div>
            <label className="text-[13px] font-bold text-tower-600 dark:text-tower-300">Buscar pessoa
                <input type="search" value={query} onChange={(event) => { version.current++; setBusy(false); setQuery(event.target.value); setError(null); }} placeholder="Nome, CPF ou CNPJ" className={`${osFieldClass} mt-1.5`} />
            </label>
            {hits.map((person) => <OsButton key={person.id} variant="secondary" onClick={() => select(ciotRecipientFromPerson(person))}>{person.legalName} · {person.document}</OsButton>)}
            {[11, 14].includes(query.replace(/\D/g, '').length) ? <OsButton full variant="secondary" disabled={busy} onClick={() => void lookup()}>{busy ? 'Consultando…' : 'Consultar CPF/CNPJ'}</OsButton> : null}
            {error ? <OsErrorNotice message={error} /> : null}
        </div>
    );
};

export default CiotRecipientPicker;
