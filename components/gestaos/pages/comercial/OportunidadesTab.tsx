import React, { useMemo, useState } from 'react';
import { opportunitiesApi } from '../../../../lib/api';
import { STAGE_LABEL, STAGE_ORDER } from '../../lib/comercial';
import { filterOpportunities, opportunityAccountName, SOURCE_LABEL, type OpportunityRow } from '../../lib/comercialForms';
import { cityOnly, money, relative } from '../../lib/format';
import { useResource } from '../../lib/resource';
import { SearchInput } from '../../ui/form';
import { Button, Chip, EmptyState, Loadable, Panel, Pill, Skeleton } from '../../ui/kit';
import { OpportunityDrawer } from './OpportunityDrawer';

const PAGE = 100;

/** Lista de oportunidades com filtro por estágio e busca; a gaveta cria, edita, move de estágio e converte. */
export const OportunidadesTab: React.FC = () => {
    const [stage, setStage] = useState('');
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(PAGE);
    const [selected, setSelected] = useState<OpportunityRow | null>(null);
    const [creating, setCreating] = useState(false);

    const state = useResource<OpportunityRow[]>(`demands:opportunities:${limit}`, async () => ((await opportunitiesApi.list({ limit })).data ?? []) as OpportunityRow[], { refreshMs: 120_000 });
    const rows = state.data ?? [];
    const visible = useMemo(() => filterOpportunities(rows, { stage, query }), [rows, stage, query]);
    const counts = useMemo(() => {
        const map = new Map<string, number>();
        for (const row of rows) map.set(row.stage, (map.get(row.stage) ?? 0) + 1);
        return map;
    }, [rows]);

    return (
        <Panel
            title="Oportunidades"
            hint="Cotações em andamento. Abra uma para editar, mudar de estágio ou converter em demanda."
            mode="manual"
            padded={false}
            actions={
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                    Nova oportunidade
                </Button>
            }
        >
            <div className="flex flex-col gap-3 px-5 pb-3">
                <SearchInput value={query} onChange={setQuery} placeholder="Buscar por conta, origem, destino ou mercadoria" aria-label="Buscar oportunidades" />
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estágio">
                    <Chip active={stage === ''} count={rows.length} onClick={() => setStage('')}>
                        Todas
                    </Chip>
                    {STAGE_ORDER.map((s) => (
                        <Chip key={s} active={stage === s} count={counts.get(s) ?? 0} onClick={() => setStage(s)}>
                            {STAGE_LABEL[s]}
                        </Chip>
                    ))}
                </div>
            </div>
            <Loadable
                state={state}
                skeleton={<Skeleton className="px-5" rows={5} height={60} />}
                isEmpty={(data) => data.length === 0}
                empty={
                    <div className="px-5 pb-3">
                        <EmptyState title="Nenhuma oportunidade ainda." hint="Elas nascem no chat e nos formulários, ou aqui em Nova oportunidade." />
                    </div>
                }
            >
                {() =>
                    visible.length === 0 ? (
                        <div className="px-5 pb-3">
                            <EmptyState title="Nada com esse filtro." hint="Limpe a busca ou escolha outro estágio." />
                        </div>
                    ) : (
                        <>
                            <ul>
                                {visible.map((opp) => (
                                    <li key={opp.id} className="gx-hair-b last:border-b-0">
                                        <button type="button" className="gx-row flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-left" onClick={() => setSelected(opp)} aria-label={`Abrir oportunidade de ${opportunityAccountName(opp)}`}>
                                            <span className="min-w-0 flex-1 basis-64">
                                                <span className="block truncate font-semibold">{opportunityAccountName(opp)}</span>
                                                <span className="gx-soft block truncate text-[13.5px]">
                                                    {opp.origin ? cityOnly(opp.origin) : 'Origem a definir'} → {opp.destination ? cityOnly(opp.destination) : 'destino a definir'}
                                                    {opp.commodity ? ` · ${opp.commodity}` : ''}
                                                </span>
                                                <span className="gx-muted block text-[12.5px]">
                                                    {SOURCE_LABEL[opp.source] ?? opp.source} · {relative(opp.createdAt)}
                                                </span>
                                            </span>
                                            <span className="flex flex-none flex-col items-start gap-1.5 sm:items-end">
                                                <Pill tone={opp.stage === 'LOST' ? 'red' : opp.stage === 'CONVERTED' ? 'neutral' : 'royal'}>{STAGE_LABEL[opp.stage] ?? 'Outro estágio'}</Pill>
                                                {opp.quotedPrice != null ? <span className="gx-num text-[14px]">{money(opp.quotedPrice)}</span> : null}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            {rows.length >= limit ? (
                                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                                    <span className="gx-muted text-[13px]">Mostrando as {rows.length} mais recentes.</span>
                                    <Button size="sm" variant="soft" onClick={() => setLimit((current) => current + PAGE)}>
                                        Ver mais
                                    </Button>
                                </div>
                            ) : null}
                        </>
                    )
                }
            </Loadable>
            <OpportunityDrawer open={creating || Boolean(selected)} opportunity={creating ? null : selected} onClose={() => (creating ? setCreating(false) : setSelected(null))} />
        </Panel>
    );
};
