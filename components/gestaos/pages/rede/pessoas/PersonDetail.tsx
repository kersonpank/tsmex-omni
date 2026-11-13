import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { Person } from '../../../../../types/index';
import { personRoleLabels } from '../../../lib/redeCadastro';
import { formatCnpjCpf, formatCep } from '../../../ui/form';
import { Button, Kv, Pill } from '../../../ui/kit';
import { PersonContacts } from './PersonContacts';

export type PersonRole = 'cliente' | 'motorista' | 'operador' | 'emissor';

/** Ficha da pessoa: dados, papéis (com a ação de virar cada papel) e contatos. */
export const PersonDetail: React.FC<{ person: Person; onEdit: () => void; onRole: (role: PersonRole) => void }> = ({ person, onEdit, onRole }) => {
    const roles = personRoleLabels(person);
    const place = [person.city, person.state].filter(Boolean).join('/');
    const street = [person.address, person.number, person.complement].filter(Boolean).join(', ');
    const operators = (person.users ?? []).filter((u) => u.roles?.includes('HUB'));
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
                <Pill>{person.documentType}</Pill>
                {roles.map((role) => <Pill key={role} tone="royal">{role}</Pill>)}
                {roles.length === 0 ? <span className="gx-muted text-[13px]">Sem papel na rede ainda.</span> : null}
                <Button size="sm" className="ml-auto" onClick={onEdit}>Editar dados</Button>
            </div>
            <div className="gx-inset flex flex-col gap-2 p-4">
                <Kv label="Documento" mono value={formatCnpjCpf(person.document)} />
                {person.tradeName ? <Kv label="Fantasia" value={person.tradeName} /> : null}
                {street ? <Kv label="Endereço" value={street} /> : null}
                {person.neighborhood ? <Kv label="Bairro" value={person.neighborhood} /> : null}
                {place ? <Kv label="Cidade" value={place} /> : null}
                {person.cep ? <Kv label="CEP" mono value={formatCep(person.cep)} /> : null}
                <Kv label="Inscrição Estadual" mono value={person.stateRegistration || '—'} />
                {person.municipalRegistration ? <Kv label="Inscrição Municipal" mono value={person.municipalRegistration} /> : null}
                {(person as Person & { rntrc?: string | null }).rntrc ? <Kv label="RNTRC" mono value={(person as Person & { rntrc?: string | null }).rntrc} /> : null}
            </div>

            <section className="flex flex-col gap-3">
                <h3 className="gx-h2">Papéis</h3>
                {person.clients?.length ? <p className="text-[14px]">Cliente: <strong>{person.clients[0].companyName}</strong> · <RouterLink className="gx-royal-text underline" to="/gestaos/rede?aba=clientes">ver em Clientes</RouterLink></p> : null}
                {person.links?.length ? <p className="text-[14px]">Motorista / transportador: <strong>{person.links[0].name}</strong> · <RouterLink className="gx-royal-text underline" to={`/hubs/transportadores/${person.links[0].id}`}>abrir ficha</RouterLink></p> : null}
                {person.hubs?.length ? <p className="text-[14px]">Emissor fiscal (CNPJ) em: {person.hubs.map((h) => `${h.name}${h.code ? ` (${h.code})` : ''}`).join(', ')}</p> : null}
                {operators.length ? (
                    <div>
                        <p className="gx-label mb-1">Logins de operador de hub</p>
                        <ul className="text-[14px]">
                            {operators.map((u) => <li key={u.id}>{u.email}{u.hub ? ` · ${u.hub.name} (${u.hub.code})` : ''}{!u.active ? ' · inativo' : ''}</li>)}
                        </ul>
                    </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                    {person.documentType === 'CNPJ' && !person.clients?.length ? <Button size="sm" variant="soft" onClick={() => onRole('cliente')}>Tornar cliente</Button> : null}
                    {!person.links?.length ? <Button size="sm" variant="soft" onClick={() => onRole('motorista')}>Tornar motorista</Button> : null}
                    <Button size="sm" variant="soft" onClick={() => onRole('operador')}>Criar login de operador de hub</Button>
                    {person.documentType === 'CNPJ' ? <Button size="sm" variant="soft" onClick={() => onRole('emissor')}>Vincular como emissor de hub</Button> : null}
                </div>
            </section>

            <PersonContacts personId={person.id} />
        </div>
    );
};
