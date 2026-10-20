import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { manifestsApi } from '../../../lib/api';
import { useOs } from '../OsContext';
import { arrivingManifests, type ManifestWithLegs } from '../lib/arrival';
import { OsBadge, OsCard, OsEmpty, OsErrorNotice, OsSectionTitle, OsSpinner, OsStatTile } from '../ui/kit';

/**
 * HOJE — a capa da roda no hub. Pergunta única: "o que precisa de mim agora?"
 * Fila: chegadas em rota, aguardando entrada, cargas em estoque, triagem.
 */

function formatKg(value: number): string {
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value)} kg`;
}

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

    if (loading) return <OsSpinner label="Carregando o seu dia…" />;
    if (error) return <OsErrorNotice message={error} onRetry={() => void refresh()} />;

    return (
        <div className="pb-6">
            <OsSectionTitle>Agora</OsSectionTitle>
            <div className="grid grid-cols-2 gap-3">
                {capabilities.canReceive ? (
                    <OsStatTile
                        label="Chegando"
                        value={arrivalsLoading ? '…' : arrivals.length}
                        hint="viagens em rota para cá"
                        onClick={() => navigate('/hubs/receber')}
                    />
                ) : null}
                {capabilities.canReceive ? (
                    <OsStatTile
                        label="Aguardando entrada"
                        value={summary.awaiting.demands}
                        hint="mercadoria anunciada"
                        onClick={() => navigate('/hubs/cargas')}
                    />
                ) : null}
                {capabilities.canViewOrders ? (
                    <OsStatTile
                        label="Em estoque"
                        value={summary.stock.orders}
                        hint={`${summary.stock.withoutActiveTrip} sem viagem · ${formatKg(summary.stock.effectiveWeightKg)}`}
                        onClick={() => navigate('/hubs/cargas')}
                    />
                ) : null}
                <OsStatTile
                    label="Triagem"
                    value={summary.triage.documents}
                    hint="documentos descobertos"
                    onClick={() => navigate('/hubs/cargas')}
                />
            </div>

            {capabilities.canReceive ? (
                <>
                    <OsSectionTitle>Chegadas em rota</OsSectionTitle>
                    {arrivalsLoading ? (
                        <OsSpinner />
                    ) : arrivals.length === 0 ? (
                        <OsEmpty title="Nenhuma viagem vindo para cá agora" detail="Quando uma transferência sair com destino a este hub, ela aparece aqui." />
                    ) : (
                        <div className="flex flex-col gap-3">
                            {arrivals.map((m) => (
                                <OsCard key={m.id} onClick={() => navigate(`/hubs/receber/${m.id}`)}>
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-semibold text-tower-900 dark:text-white">
                                            {m.origin} → {m.destination}
                                        </p>
                                        <OsBadge tone="warn">em rota</OsBadge>
                                    </div>
                                    <p className="mt-1 text-sm text-tower-500 dark:text-tower-300">
                                        {m.link?.name ?? 'Transportador não informado'} · {formatKg(m.totalWeight)}
                                    </p>
                                </OsCard>
                            ))}
                        </div>
                    )}
                </>
            ) : null}
        </div>
    );
};

export default TodayPage;
