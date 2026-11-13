import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clientsApi } from '../../../../../lib/api';
import { num } from '../../../lib/format';
import { matchesClient } from '../../../lib/redeCadastro';
import { useResource } from '../../../lib/resource';
import { formatCnpjCpf, SearchInput } from '../../../ui/form';
import { Button, EmptyState, Loadable, Panel, Pill, Skeleton } from '../../../ui/kit';
import { ClientDrawer, type ClientRow } from './ClientDrawer';
import { NewClientDrawer } from './NewClientDrawer';

/** Clientes: contas dos embarcadores. Lista com busca, edição do contato e criação de conta. */
export const ClientesTab: React.FC = () => {
    const [params, setParams] = useSearchParams();
    const list = useResource<ClientRow[]>('clients:all', async () => ((await clientsApi.list()).data ?? []) as ClientRow[], { staleMs: 30_000 });
    const [query, setQuery] = useState('');
    const openId = params.get('cliente');
    const setDrawer = (id: string | null) => {
        const p = new URLSearchParams(params);
        if (id) p.set('cliente', id);
        else p.delete('cliente');
        setParams(p, { replace: true });
    };
    const openPerson = (personId: string) => setParams(new URLSearchParams({ aba: 'pessoas', pessoa: personId }), { replace: true });
    const rows = useMemo(() => (list.data ?? []).filter((c) => matchesClient(c, query)), [list.data, query]);
    const current = openId && openId !== 'novo' ? list.data?.find((c) => c.id === openId) ?? null : null;

    return (
        <>
            <Panel
                title="Clientes"
                hint="Contas dos embarcadores que pedem cotação e coleta."
                count={list.data ? num(list.data.length) : null}
                actions={<Button variant="primary" onClick={() => setDrawer('novo')}>Novo cliente</Button>}
                padded={false}
                bodyClassName="flex flex-col gap-4"
            >
                <div className="max-w-md px-5">
                    <SearchInput placeholder="Razão social, CNPJ, contato ou e-mail" aria-label="Buscar cliente" onChange={setQuery} />
                </div>
                <Loadable state={list} skeleton={<div className="px-5"><Skeleton rows={5} /></div>}>
                    {() =>
                        rows.length === 0 ? (
                            <div className="px-5 pb-5"><EmptyState title={query ? 'Nenhum cliente nesta busca' : 'Nenhum cliente cadastrado'} hint={query ? 'Confira o texto ou tire a busca.' : 'Use Novo cliente para criar a primeira conta.'} /></div>
                        ) : (
                            <div className="gx-scroll-x">
                                <table className="gx-table">
                                    <thead><tr><th>Razão social</th><th>CNPJ</th><th>Contato</th><th>E-mail de login</th><th /></tr></thead>
                                    <tbody>
                                        {rows.map((c) => (
                                            <tr key={c.id} data-clickable="true" onClick={() => setDrawer(c.id)}>
                                                <td className="font-semibold">{c.companyName}</td>
                                                <td className="gx-mono">{formatCnpjCpf(c.document)}</td>
                                                <td>{[c.contactName, c.phone].filter(Boolean).join(' · ') || '—'}</td>
                                                <td>{c.user?.email ?? '—'} {c.user && c.user.active === false ? <Pill tone="yellow">inativo</Pill> : null}</td>
                                                <td className="text-right"><Button size="sm" onClick={(e) => { e.stopPropagation(); setDrawer(c.id); }}>Editar</Button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    }
                </Loadable>
            </Panel>
            {openId === 'novo' ? <NewClientDrawer onClose={() => setDrawer(null)} /> : null}
            {current ? <ClientDrawer key={current.id} client={current} onOpenPerson={openPerson} onClose={() => setDrawer(null)} /> : null}
        </>
    );
};
