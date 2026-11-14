import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { opportunitiesApi } from '../../../../lib/api';
import type { Opportunity } from '../../../../types/index';
import { groupOpportunities } from '../../lib/comercial';
import { money, num } from '../../lib/format';
import { useResource } from '../../lib/resource';
import { Loadable, Panel, Progress } from '../../ui/kit';

/** Funil lido da API; o estágio muda pela gaveta da oportunidade. */
export const FunnelPanel: React.FC = () => {
    const state = useResource<Opportunity[]>('demands:funnel', async () => ((await opportunitiesApi.list({ limit: 100 })).data ?? []) as Opportunity[], {
        refreshMs: 120_000,
    });
    const stages = useMemo(() => groupOpportunities(state.data ?? []), [state.data]);
    const max = Math.max(1, ...stages.map((s) => s.count));

    return (
        <Panel
            title="Funil de oportunidades"
            hint="Cotações em andamento, por estágio."
            actions={
                <Link to="/gestaos/comercial?aba=oportunidades" className="gx-btn gx-btn-soft gx-btn-sm">
                    Ver oportunidades
                </Link>
            }
        >
            <Loadable state={state}>
                {(rows) => (
                    <>
                        <ul className="flex flex-col gap-4">
                            {stages.map((stage) => (
                                <li key={stage.stage}>
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="text-[14px] font-semibold">{stage.label}</span>
                                        <span className="gx-num text-[17px]">{num(stage.count)}</span>
                                    </div>
                                    <Progress value={(stage.count / max) * 100} label={`${stage.label}: ${stage.count}`} className="mt-1.5" />
                                    {stage.value != null ? <p className="gx-muted mt-1 text-[12.5px]">{money(stage.value)} em cotações</p> : null}
                                </li>
                            ))}
                        </ul>
                        {rows.length >= 100 ? <p className="gx-muted mt-4 text-[12.5px]">Mostrando as 100 mais recentes. Veja todas em Oportunidades.</p> : null}
                    </>
                )}
            </Loadable>
        </Panel>
    );
};
