import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hubCargoApi, manifestsApi } from '../../../lib/api';
import type { ConsolidationQueueGroup, Manifest } from '../../../types/index';
import { useOs } from '../OsContext';
import { OsBadge, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../ui/kit';
import QueueGroupSheet from './QueueGroupSheet';

/**
 * VIAGENS — estação de consolidação (G1). Pergunta única: "o que está pronto
 * para viajar e para onde?" A fila por próximo salto é a novidade que nenhuma
 * tela do sistema tinha: o operador monta a viagem a partir dela.
 */

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function ageDays(iso: string): number {
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function groupTitle(g: ConsolidationQueueGroup): string {
    if (g.kind === 'TRANSFER') return `→ ${g.destHubName ?? g.destHubCode ?? 'Hub destino'}`;
    if (g.kind === 'LOCAL') return 'Entrega local (distribuição daqui)';
    return 'Sem rota definida';
}

const TripsPage: React.FC = () => {
    const navigate = useNavigate();
    const { hubId, capabilities, isAdmin } = useOs();
    const [groups, setGroups] = useState<ConsolidationQueueGroup[]>([]);
    const [active, setActive] = useState<Manifest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<ConsolidationQueueGroup | null>(null);

    const load = useCallback(async () => {
        if (!hubId) return;
        setLoading(true);
        setError(null);
        try {
            const [queues, manifests] = await Promise.all([
                hubCargoApi.queues(hubId),
                manifestsApi.list({}),
            ]);
            setGroups(Array.isArray(queues.data) ? queues.data : []);
            const rows = Array.isArray(manifests.data) ? manifests.data : [];
            setActive(
                rows.filter(
                    (m) => m.hubId === hubId && ['DRAFT', 'PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'].includes(m.status),
                ),
            );
        } catch {
            setError('Não foi possível carregar a fila de consolidação. Tente de novo.');
        } finally {
            setLoading(false);
        }
    }, [hubId]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="pb-6">
            <OsSectionTitle
                action={
                    isAdmin ? (
                        <button
                            type="button"
                            onClick={() => navigate('/hubs/cobertura')}
                            className="text-[13px] font-bold text-brand-600 dark:text-brand-300"
                        >
                            Cobertura do hub
                        </button>
                    ) : undefined
                }
            >
                Prontos para viajar
            </OsSectionTitle>
            {loading ? (
                <OsSkeletonRows />
            ) : error ? (
                <OsErrorNotice message={error} onRetry={() => void load()} />
            ) : groups.length === 0 ? (
                <OsEmpty
                    title="Fila vazia"
                    detail="Pedidos em estoque fora de viagem entram aqui, agrupados pelo próximo salto da teia."
                />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {groups.map((g) => (
                        <OsRow
                            key={g.key}
                            tone={g.kind === 'TRANSFER' ? 'attention' : g.kind === 'LOCAL' ? 'ok' : 'bad'}
                            onClick={() => setSelected(g)}
                        >
                            <div className="flex items-center justify-between gap-2 pr-1">
                                <p className="truncate font-semibold text-tower-900 dark:text-white">{groupTitle(g)}</p>
                                <OsBadge tone={g.kind === 'UNROUTED' ? 'bad' : 'neutral'}>
                                    {g.orders.length} pedido(s)
                                </OsBadge>
                            </div>
                            <p className="mt-0.5 truncate text-[13px] text-tower-500 dark:text-tower-400">
                                {nf0.format(g.totalWeightKg)} kg · {nf1.format(g.totalVolumeM3)} m³ · mais antigo há{' '}
                                {ageDays(g.oldestSinceAt)}d
                            </p>
                        </OsRow>
                    ))}
                </div>
            )}

            <OsSectionTitle>Viagens deste hub</OsSectionTitle>
            {loading ? null : active.length === 0 ? (
                <OsEmpty title="Nenhuma viagem ativa" detail="Monte uma viagem a partir da fila acima." />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {active.map((m) => (
                        <OsRow key={m.id} tone="route" onClick={() => navigate(`/hubs/viagens/${m.id}`)}>
                            <div className="flex items-center justify-between gap-2 pr-1">
                                <p className="truncate font-semibold text-tower-900 dark:text-white">
                                    {m.origin} → {m.destination}
                                </p>
                                <OsBadge tone="route">{m.status === 'DRAFT' ? 'rascunho' : m.status === 'IN_PROGRESS' ? 'em rota' : m.status === 'COMPLETED' ? 'concluída' : m.status.toLowerCase()}</OsBadge>
                            </div>
                            <p className="mt-0.5 truncate text-[13px] text-tower-500 dark:text-tower-400">
                                {nf0.format(m.totalWeight)} kg · {m.vehicleType?.name ?? 'veículo a definir'}
                            </p>
                        </OsRow>
                    ))}
                </div>
            )}

            {selected && hubId ? (
                <QueueGroupSheet
                    group={selected}
                    hubId={hubId}
                    canCreateTrip={capabilities.canCreateTrip}
                    onClose={() => setSelected(null)}
                    onCreated={(manifestId) => {
                        setSelected(null);
                        navigate(`/hubs/viagens/${manifestId}`);
                    }}
                />
            ) : null}
        </div>
    );
};

export default TripsPage;
