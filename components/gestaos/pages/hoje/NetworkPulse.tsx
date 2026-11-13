import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Manifest, OperationsSummaryData } from '../../../../types/index';
import { num } from '../../lib/format';
import type { UseResourceResult } from '../../lib/resource';
import { IconArrowRight } from '../../ui/icons';
import { Loadable, Panel, Skeleton } from '../../ui/kit';

/** A rede em uma faixa: quanto há em cada hub e quanto está na estrada entre eles. */

const MAX_HUBS = 6;

export const NetworkPulse = ({ summary, manifests }: { summary: UseResourceResult<OperationsSummaryData>; manifests: Manifest[] | null }) => {
    const moving = useMemo(() => {
        const out = new Map<string, number>();
        const into = new Map<string, number>();
        for (const trip of manifests ?? []) {
            if (trip.status !== 'IN_PROGRESS') continue;
            if (trip.hubId) out.set(trip.hubId, (out.get(trip.hubId) ?? 0) + 1);
            if (trip.destHubId) into.set(trip.destHubId, (into.get(trip.destHubId) ?? 0) + 1);
        }
        return { out, into };
    }, [manifests]);

    return (
        <Panel
            title="A rede agora"
            hint="Estoque em cada hub e o que está na estrada."
            actions={
                <Link to="/gestaos/rede" className="gx-btn gx-btn-soft gx-btn-sm">
                    Ver a rede <IconArrowRight size={15} />
                </Link>
            }
        >
            <Loadable state={summary} skeleton={<Skeleton rows={2} height={72} />}>
                {(data) => {
                    const hubs = data.estoque.porHub.slice().sort((a, b) => b.count - a.count);
                    return (
                        <div className="flex flex-col gap-4">
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                                <div>
                                    <dt className="gx-label">Nos hubs</dt>
                                    <dd className="gx-num mt-1 text-[28px] leading-none">{num(data.estoque.pedidosNoCd)}</dd>
                                </div>
                                <div>
                                    <dt className="gx-label">Na estrada</dt>
                                    <dd className="gx-num gx-royal-text mt-1 text-[28px] leading-none">{num(data.estoque.pedidosEmTransito)}</dd>
                                </div>
                                <div>
                                    <dt className="gx-label">Parados há mais de 7 dias</dt>
                                    <dd className={`gx-num mt-1 text-[28px] leading-none ${data.estoque.agingMais7d > 0 ? 'gx-yellow-text' : ''}`}>{num(data.estoque.agingMais7d)}</dd>
                                </div>
                                <div>
                                    <dt className="gx-label">Aguardando cotação</dt>
                                    <dd className="gx-num mt-1 text-[28px] leading-none">{num(data.cenario.aguardandoCotacao)}</dd>
                                </div>
                            </dl>

                            {hubs.length ? (
                                <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                                    {hubs.slice(0, MAX_HUBS).map((hub) => {
                                        const leaving = moving.out.get(hub.hubId) ?? 0;
                                        const arriving = moving.into.get(hub.hubId) ?? 0;
                                        return (
                                            <li key={hub.hubId} className="gx-inset flex items-center justify-between gap-4 px-4 py-3">
                                                <span className="min-w-0">
                                                    <span className="gx-mono gx-muted block">{hub.code}</span>
                                                    <span className="block truncate font-semibold">{hub.name}</span>
                                                    <span className="gx-muted block text-[12.5px]">
                                                        {leaving} saindo · {arriving} chegando
                                                    </span>
                                                </span>
                                                <span className="text-right">
                                                    <span className="gx-num block text-[26px] leading-none">{num(hub.count)}</span>
                                                    <span className="gx-muted block text-[12px]">em estoque</span>
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <p className="gx-muted text-[13.5px]">Nenhum hub com estoque no momento.</p>
                            )}
                            {hubs.length > MAX_HUBS ? <p className="gx-muted text-[13px]">Mostrando os {MAX_HUBS} hubs com mais estoque, de {hubs.length}.</p> : null}
                        </div>
                    );
                }}
            </Loadable>
        </Panel>
    );
};
