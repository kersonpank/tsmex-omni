import React, { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { linksApi, vehicleTypesApi } from '../../../../lib/api';
import type { Link, LinkApprovalStatus } from '../../../../types/index';
import { useHubs } from '../../lib/data';
import { num, pct } from '../../lib/format';
import { APPROVAL_LABEL, APPROVAL_ORDER, approvalCounts, matchesCarrier, sortApproved } from '../../lib/redeCarriers';
import { useResource } from '../../lib/resource';
import { Chip, EmptyState, Loadable, ModeBadge, Panel, Pill, Skeleton, TextInput } from '../../ui/kit';
import { PendingCarrierRow } from './PendingCarrierRow';

const FichaLink: React.FC<{ id: string }> = ({ id }) => (
    <RouterLink to={`/hubs/transportadores/${id}`} className="gx-btn gx-btn-ghost gx-btn-sm">
        Ficha completa
    </RouterLink>
);

const ApprovedTable: React.FC<{ links: Link[] }> = ({ links }) => (
    <div className="gx-scroll-x">
        <table className="gx-table">
            <thead>
                <tr>
                    <th>Nome</th>
                    <th>Documento</th>
                    <th>Placa</th>
                    <th>RNTRC</th>
                    <th>Nota</th>
                    <th>Entregas</th>
                    <th>Pontualidade</th>
                    <th />
                </tr>
            </thead>
            <tbody>
                {links.map((link) => (
                    <tr key={link.id}>
                        <td className="font-semibold">{link.name}</td>
                        <td className="gx-mono">{link.document || '—'}</td>
                        <td className="gx-mono">{link.vehiclePlate || '—'}</td>
                        <td className="gx-mono">{link.rntrc || '—'}</td>
                        <td className="gx-num">{Number(link.score) > 0 ? Number(link.score).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</td>
                        <td className="gx-num">{num(link.deliveryCount)}</td>
                        <td className="gx-num">{link.deliveryCount > 0 ? pct(link.onTimeRate, 0) : '—'}</td>
                        <td className="text-right">
                            <FichaLink id={link.id} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const OtherList: React.FC<{ links: Link[] }> = ({ links }) => (
    <div className="flex flex-col">
        {links.map((link) => (
            <div key={link.id} className="gx-hair-b flex flex-wrap items-center justify-between gap-3 px-5 py-3 last:border-b-0">
                <div className="min-w-0">
                    <p className="font-semibold">{link.name}</p>
                    <p className="gx-muted text-[13px]">
                        <span className="gx-mono">{link.document || '—'}</span> · <span className="gx-mono">{link.vehiclePlate || 'sem placa'}</span>
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Pill tone={link.approvalStatus === 'REJECTED' ? 'red' : 'yellow'}>{APPROVAL_LABEL[link.approvalStatus]}</Pill>
                    <FichaLink id={link.id} />
                </div>
            </div>
        ))}
    </div>
);

export const CarriersTab: React.FC = () => {
    const links = useResource<Link[]>('links:all', async () => (await linksApi.list()).data ?? [], { staleMs: 30_000 });
    const types = useResource('links:vehicle-types', async () => (await vehicleTypesApi.list()).data ?? [], { staleMs: 300_000 });
    const hubs = useHubs();
    const [status, setStatus] = useState<LinkApprovalStatus | null>(null);
    const [query, setQuery] = useState('');

    const all = links.data ?? [];
    const counts = useMemo(() => approvalCounts(all), [all]);
    // Sem escolha da pessoa: abre em Aguardando se houver, senão em Aprovados.
    const current: LinkApprovalStatus = status ?? (counts.PENDING > 0 ? 'PENDING' : 'APPROVED');
    const visible = useMemo(() => all.filter((link) => link.approvalStatus === current && matchesCarrier(link, query)), [all, current, query]);

    return (
        <Panel
            title="Transportadores"
            hint="Quem pode receber viagem da rede. Quem está aguardando precisa de uma decisão sua."
            count={counts.PENDING > 0 ? `${counts.PENDING} aguardando` : null}
            countTone="yellow"
            padded={false}
            bodyClassName="flex flex-col gap-4"
        >
            <div className="flex flex-col gap-3 px-5">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
                    {APPROVAL_ORDER.map((key) => (
                        <Chip key={key} active={key === current} count={links.data ? counts[key] : null} onClick={() => setStatus(key)}>
                            {APPROVAL_LABEL[key]}
                        </Chip>
                    ))}
                </div>
                <TextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, documento ou placa" aria-label="Buscar transportador" />
            </div>

            <Loadable state={links} skeleton={<div className="px-5"><Skeleton rows={4} /></div>}>
                {() =>
                    visible.length === 0 ? (
                        <div className="px-5 pb-5">
                            <EmptyState
                                title={query ? 'Nada encontrado nesta situação' : `Nenhum transportador: ${APPROVAL_LABEL[current].toLowerCase()}`}
                                hint={query ? 'Tire a busca ou troque a situação acima.' : undefined}
                            />
                        </div>
                    ) : current === 'PENDING' ? (
                        <div className="flex flex-col gap-3 px-5 pb-5">
                            <p className="flex items-center gap-2 text-[13px]">
                                <ModeBadge mode="manual" />
                                <span className="gx-muted">Aprovar ou recusar é decisão da pessoa; o sistema não decide por você.</span>
                            </p>
                            {visible.map((link) => (
                                <PendingCarrierRow key={link.id} link={link} hubs={hubs.data ?? []} vehicleTypes={types.data ?? []} typesError={types.error} />
                            ))}
                        </div>
                    ) : current === 'APPROVED' ? (
                        <ApprovedTable links={sortApproved(visible)} />
                    ) : (
                        <OtherList links={visible} />
                    )
                }
            </Loadable>
        </Panel>
    );
};
