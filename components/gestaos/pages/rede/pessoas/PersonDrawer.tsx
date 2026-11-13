import React from 'react';
import { personsApi } from '../../../../../lib/api';
import type { Person } from '../../../../../types/index';
import { useResource } from '../../../lib/resource';
import { ErrorState, Skeleton } from '../../../ui/kit';
import { Drawer } from '../../../ui/overlay';
import { PersonDetail, type PersonRole } from './PersonDetail';
import { PersonForm } from './PersonForm';
import { ClientAccountForm, EmitterRoleForm, HubOperatorRoleForm, LinkRoleForm } from './PersonRoleForms';

/** `null` = ficha; `editar` = formulário; ou o papel que está sendo criado. */
export type PersonMode = null | 'editar' | PersonRole;
export const PERSON_MODES: readonly string[] = ['editar', 'cliente', 'motorista', 'operador', 'emissor'];

const ROLE_TITLE: Record<PersonRole, string> = {
    cliente: 'Tornar cliente',
    motorista: 'Tornar motorista',
    operador: 'Login de operador de hub',
    emissor: 'Emissor de hub',
};

interface Props {
    /** Id da pessoa, ou `nova`. */
    id: string;
    mode: PersonMode;
    onMode: (mode: PersonMode) => void;
    onOpen: (id: string) => void;
    onClose: () => void;
}

/** Uma gaveta só para a pessoa: ficha, edição e cada papel. Nunca gaveta sobre gaveta. */
export const PersonDrawer: React.FC<Props> = ({ id, mode, onMode, onOpen, onClose }) => {
    const creating = id === 'nova';
    const person = useResource<Person>(creating ? null : `persons:one:${id}`, async () => (await personsApi.getById(id)).data, { staleMs: 5_000 });
    const back = () => onMode(null);
    const data = person.data;

    let body: React.ReactNode;
    if (creating) body = <PersonForm person={null} onOpenExisting={onOpen} onSaved={(saved) => onOpen(saved.id)} onCancel={onClose} />;
    else if (!data) body = person.error ? <ErrorState message={person.error} onRetry={() => void person.reload()} /> : <Skeleton rows={5} />;
    else if (mode === 'editar') body = <PersonForm key={data.updatedAt} person={data} onOpenExisting={onOpen} onSaved={back} onCancel={back} />;
    else if (mode === 'cliente') body = <ClientAccountForm person={data} onDone={back} />;
    else if (mode === 'motorista') body = <LinkRoleForm person={data} onDone={back} />;
    else if (mode === 'operador') body = <HubOperatorRoleForm person={data} onDone={back} />;
    else if (mode === 'emissor') body = <EmitterRoleForm person={data} onDone={back} />;
    else body = <PersonDetail person={data} onEdit={() => onMode('editar')} onRole={onMode} />;

    const title = creating ? 'Nova pessoa' : data?.legalName ?? 'Pessoa';
    const subtitle = creating ? 'Cadastro único de quem existe na operação.' : mode === 'editar' ? 'Editar dados' : mode ? ROLE_TITLE[mode] : undefined;

    return (
        <Drawer open onClose={onClose} width={780} title={title} subtitle={subtitle}>
            {body}
        </Drawer>
    );
};
