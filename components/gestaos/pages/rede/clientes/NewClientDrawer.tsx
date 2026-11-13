import React, { useState } from 'react';
import type { Person } from '../../../../../types/index';
import { Drawer } from '../../../ui/overlay';
import { PersonPicker, type PersonSummary } from '../../../ui/pickers';
import { ModeBadge } from '../../../ui/kit';
import { ClientAccountForm } from '../pessoas/PersonRoleForms';

/**
 * Nova conta de cliente: o caminho da gestão clássica é escolher (ou cadastrar) a pessoa CNPJ e criar a conta
 * dela (login + contato). Não existe rota de "criar cliente" solta no servidor.
 */
export const NewClientDrawer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [summary, setSummary] = useState<PersonSummary | null>(null);
    const [person, setPerson] = useState<Person | null>(null);
    const already = person?.clients && person.clients.length > 0;

    return (
        <Drawer open onClose={onClose} width={680} title="Novo cliente" subtitle="Conta de embarcador: pessoa jurídica com login próprio.">
            <div className="flex flex-col gap-5">
                <div>
                    <div className="mb-1.5 flex items-center gap-2"><span className="gx-label">Empresa (CNPJ)</span><ModeBadge mode="copilot" /></div>
                    <PersonPicker
                        documentType="CNPJ"
                        ariaLabel="Empresa do cliente"
                        placeholder="Nome ou CNPJ; digite o CNPJ para cadastrar"
                        value={summary}
                        onChange={(next, full) => {
                            setSummary(next);
                            setPerson(next ? full ?? ({ ...next, createdAt: '', updatedAt: '' } as unknown as Person) : null);
                        }}
                    />
                </div>
                {person && already ? <p className="gx-yellow-text text-[13.5px] font-semibold" role="status">Esta empresa já é cliente ({person.clients?.[0]?.companyName}). Edite pela lista de Clientes.</p> : null}
                {person && !already ? <ClientAccountForm key={person.id} person={person} onDone={onClose} /> : null}
            </div>
        </Drawer>
    );
};
