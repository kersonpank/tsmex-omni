import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { personsApi } from '../../../../../lib/api';
import type { Person } from '../../../../../types/index';
import { num } from '../../../lib/format';
import { paginate, personListParams, personRoleLabels, type PersonFilters } from '../../../lib/redeCadastro';
import { useResource } from '../../../lib/resource';
import { Button, EmptyState, Field, Loadable, Panel, Pill, SelectInput, Skeleton } from '../../../ui/kit';
import { formatCnpjCpf, SearchInput } from '../../../ui/form';
import { PersonDrawer, PERSON_MODES, type PersonMode } from './PersonDrawer';

const PAGE_SIZE = 25;
const YES_NO = [['', 'Todos'], ['true', 'Sim'], ['false', 'Não']] as const;

/** Pessoas: cadastro único. Busca, filtros por tipo e papel, paginação, criar e editar na gaveta. */
export const PessoasTab: React.FC = () => {
    const [params, setParams] = useSearchParams();
    const [filters, setFilters] = useState<PersonFilters>({ type: '', client: '', link: '', text: '' });
    const [page, setPage] = useState(1);
    const query = personListParams(filters);
    const list = useResource<Person[]>(`persons:list:${JSON.stringify(query)}`, async () => (await personsApi.list(query)).data ?? [], { staleMs: 15_000 });

    const openId = params.get('pessoa');
    const rawMode = params.get('pm') ?? '';
    const mode: PersonMode = PERSON_MODES.includes(rawMode) ? (rawMode as PersonMode) : null;
    const setDrawer = (id: string | null, next: PersonMode = null) => {
        const p = new URLSearchParams(params);
        if (id) p.set('pessoa', id);
        else p.delete('pessoa');
        if (id && next) p.set('pm', next);
        else p.delete('pm');
        setParams(p, { replace: true });
    };
    const change = (patch: Partial<PersonFilters>) => {
        setFilters((current) => ({ ...current, ...patch }));
        setPage(1);
    };
    const paged = useMemo(() => paginate(list.data ?? [], page, PAGE_SIZE), [list.data, page]);
    const filtered = filters.type || filters.client || filters.link || filters.text;

    return (
        <>
            <Panel
                title="Pessoas"
                hint="Cadastro único de quem existe na operação: empresas e pessoas. Cliente, motorista e operador nascem de uma pessoa."
                count={list.data ? num(list.data.length) : null}
                actions={<Button variant="primary" onClick={() => setDrawer('nova')}>Nova pessoa</Button>}
                padded={false}
                bodyClassName="flex flex-col gap-4"
            >
                <div className="grid grid-cols-2 gap-3 px-5 md:grid-cols-4">
                    <div className="col-span-2">
                        <span className="gx-label mb-1.5 block">Nome ou documento</span>
                        <SearchInput placeholder="Buscar pessoa" aria-label="Buscar pessoa" value={filters.text} onChange={(text) => change({ text })} />
                    </div>
                    <Field label="Tipo">
                        <SelectInput value={filters.type} onChange={(e) => change({ type: e.target.value as PersonFilters['type'] })}>
                            <option value="">Todos</option>
                            <option value="CNPJ">CNPJ</option>
                            <option value="CPF">CPF</option>
                        </SelectInput>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="É cliente">
                            <SelectInput value={filters.client} onChange={(e) => change({ client: e.target.value as PersonFilters['client'] })}>
                                {YES_NO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </SelectInput>
                        </Field>
                        <Field label="É motorista">
                            <SelectInput value={filters.link} onChange={(e) => change({ link: e.target.value as PersonFilters['link'] })}>
                                {YES_NO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </SelectInput>
                        </Field>
                    </div>
                </div>
                <Loadable
                    state={list}
                    skeleton={<div className="px-5"><Skeleton rows={5} /></div>}
                    empty={<div className="px-5 pb-5"><EmptyState title={filtered ? 'Ninguém nesta busca' : 'Nenhuma pessoa cadastrada'} hint={filtered ? 'Tire um filtro ou confira o texto.' : 'Cadastre a primeira pessoa.'} /></div>}
                    isEmpty={(rows) => rows.length === 0}
                >
                    {() => (
                        <>
                            <div className="gx-scroll-x">
                                <table className="gx-table">
                                    <thead>
                                        <tr><th>Nome / razão social</th><th>Documento</th><th>Cidade</th><th>Papéis</th><th /></tr>
                                    </thead>
                                    <tbody>
                                        {paged.rows.map((p) => (
                                            <tr key={p.id} data-clickable="true" onClick={() => setDrawer(p.id)}>
                                                <td>
                                                    <span className="font-semibold">{p.legalName}</span>
                                                    {p.tradeName ? <span className="gx-muted block text-[12.5px]">{p.tradeName}</span> : null}
                                                </td>
                                                <td className="gx-mono">{formatCnpjCpf(p.document)}</td>
                                                <td>{[p.city, p.state].filter(Boolean).join('/') || '—'}</td>
                                                <td>
                                                    <span className="flex flex-wrap gap-1.5">
                                                        {personRoleLabels(p).map((r) => <Pill key={r} tone="royal">{r}</Pill>)}
                                                    </span>
                                                </td>
                                                <td className="text-right"><Button size="sm" onClick={(e) => { e.stopPropagation(); setDrawer(p.id); }}>Abrir</Button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {paged.pages > 1 ? (
                                <nav className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4" aria-label="Paginação">
                                    <span className="gx-muted text-[13px]">Página {paged.page} de {paged.pages}</span>
                                    <span className="flex gap-2">
                                        <Button size="sm" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>Anterior</Button>
                                        <Button size="sm" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)}>Próxima</Button>
                                    </span>
                                </nav>
                            ) : null}
                        </>
                    )}
                </Loadable>
            </Panel>
            {openId ? <PersonDrawer key={openId} id={openId} mode={mode} onMode={(next) => setDrawer(openId, next)} onOpen={(id) => setDrawer(id)} onClose={() => setDrawer(null)} /> : null}
        </>
    );
};
