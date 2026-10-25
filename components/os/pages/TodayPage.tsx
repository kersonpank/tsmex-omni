import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { manifestsApi } from '../../../lib/api';
import { useOs } from '../OsContext';
import { arrivingManifests, ordersToUnload, type ManifestWithLegs } from '../lib/arrival';
import { OsBadge, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows, OsStatTile } from '../ui/kit';

/**
 * HOJE — a capa da roda no hub. Pergunta única: "o que precisa de mim agora?"
 * Placar de leitura à distância + fila de chegadas em rota.
 */

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const TodayPage: React.FC = () => {
    const navigate = useNavigate();
    const { hubId, summary, capabilities, loading, error, refresh } = useOs();
    const [arrivals, setArrivals] = useState<ManifestWithLegs[]>([]);
    const [arrivalsLoading, setArrivalsLoading] = useState(true);

    useEffect(() => {
        if (!hubId) return;
        let cancelled = false;
        setArrivalsLoading(true);
        manifestsApi
            .list({ status: 'IN_PROGRESS' })
            .then((body) => {
                if (cancelled) return;
                const rows = Array.isArray(body.data) ? (body.data as ManifestWithLegs[]) : [];
                setArrivals(arrivingManifests(rows, hubId));
            })
            .catch(() => {
                if (!cancelled) setArrivals([]);
            })
            .finally(() => {
                if (!cancelled) setArrivalsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [hubId]);

    if (loading) return <OsSkeletonRows count={4} />;
    if (error) return <OsErrorNotice message={error} onRetry={() => void refresh()} />;

    return (
        <div className="pb-6">
            <OsSectionTitle>Agora</OsSectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
                {capabilities.canReceive ? (
                    <OsStatTile
                        label="Chegando"
                        value={arrivalsLoading ? '–' : arrivals.length}
                        hint="viagens em rota para cá"
                        tone="route"
                        onClick={() => navigate('/hubs/receber')}
                    />
                ) : null}
                {capabilities.canReceive ? (
                    <OsStatTile
                        label="Aguardando entrada"
                        value={summary.awaiting.demands}
                        hint="notas para dar entrada"
                        tone="attention"
                        onClick={() => navigate('/hubs/receber')}
                    />
                ) : null}
                {capabilities.canViewOrders ? (
                    <OsStatTile
                        label="Em estoque"
                        value={summary.stock.orders}
                        hint={`${summary.stock.withoutActiveTrip} sem viagem · ${nf0.format(summary.stock.effectiveWeightKg)} kg`}
                        tone={summary.stock.withoutActiveTrip > 0 ? 'attention' : 'ok'}
                        onClick={() => navigate('/hubs/cargas')}
                    />
                ) : null}
                {capabilities.canCreateTrip ? (
                    <OsStatTile
                        label="Montar viagem"
                        value={summary.stock.withoutActiveTrip}
                        hint="pedidos em estoque sem viagem"
                        tone={summary.stock.withoutActiveTrip > 0 ? 'attention' : 'ok'}
                        onClick={() => navigate('/hubs/cargas?select=1')}
                    />
                ) : null}
                {capabilities.canViewOrders ? (
                    <OsStatTile
                        label="Sem CT-e/minuta"
                        value={summary.freight?.missing ?? 0}
                        hint="pedidos do estoque sem documento"
                        tone={(summary.freight?.missing ?? 0) > 0 ? 'attention' : 'ok'}
                        onClick={() => navigate('/hubs/documentos')}
                    />
                ) : null}
                <OsStatTile
                    label="Triagem"
                    value={summary.triage.documents}
                    hint="documentos descobertos"
                    tone={summary.triage.documents > 0 ? 'attention' : 'none'}
                    onClick={() => navigate('/hubs/cargas')}
                />
            </div>

            {capabilities.canReceive ? (
                <>
                    <OsSectionTitle>Chegadas em rota</OsSectionTitle>
                    {arrivalsLoading ? (
                        <OsSkeletonRows />
                    ) : arrivals.length === 0 ? (
                        <OsEmpty
                            title="Nenhuma viagem vindo para cá"
                            detail="Quando uma transferência sair com destino a este hub, ela entra nesta fila."
                        />
                    ) : (
                        <div className="flex flex-col gap-2.5">
                            {arrivals.map((m) => {
                                const unload = hubId ? ordersToUnload(m, hubId).length : 0;
                                return (
                                    <OsRow key={m.id} tone="route" onClick={() => navigate(`/hubs/receber/${m.id}`)}>
                                        <div className="flex items-center justify-between gap-2 pr-1">
                                            <p className="truncate font-semibold text-tower-900 dark:text-white">
                                                {m.origin} → {m.destination}
                                            </p>
                                            <OsBadge tone="route">em rota</OsBadge>
                                        </div>
                                        <p className="mt-0.5 truncate text-[13px] text-tower-500 dark:text-tower-400">
                                            {unload > 0 ? `${unload} pedido(s) descem aqui · ` : ''}
                                            {m.link?.name ?? 'transportador a confirmar'} · {nf0.format(m.totalWeight)} kg
                                        </p>
                                    </OsRow>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : null}
        </div>
    );
};

export default TodayPage;
