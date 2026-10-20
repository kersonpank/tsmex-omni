import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { manifestsApi } from '../../../lib/api';
import { useOs } from '../OsContext';
import { arrivingManifests, ordersToUnload, type ManifestWithLegs } from '../lib/arrival';
import { OsBadge, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../ui/kit';

/**
 * RECEBER — estação de chegada. Pergunta única: "o que chegou e confere?"
 * Fila: viagens em rota com descarga pendente neste hub.
 */

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const ReceivePage: React.FC = () => {
    const navigate = useNavigate();
    const { hubId, capabilities } = useOs();
    const [arrivals, setArrivals] = useState<ManifestWithLegs[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!hubId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        manifestsApi
            .list({ status: 'IN_PROGRESS' })
            .then((body) => {
                if (cancelled) return;
                const rows = Array.isArray(body.data) ? (body.data as ManifestWithLegs[]) : [];
                setArrivals(arrivingManifests(rows, hubId));
            })
            .catch(() => {
                if (!cancelled) setError('Não foi possível carregar as viagens chegando. Tente de novo.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [hubId]);

    if (!capabilities.canReceive) {
        return <OsEmpty title="Este hub não recebe carga" detail="O perfil deste hub não tem recebimento habilitado." />;
    }

    return (
        <div className="pb-6">
            <OsSectionTitle>Viagens chegando</OsSectionTitle>
            {loading ? (
                <OsSkeletonRows />
            ) : error ? (
                <OsErrorNotice message={error} />
            ) : arrivals.length === 0 ? (
                <OsEmpty
                    title="Nada para receber agora"
                    detail="Quando uma transferência estiver em rota para este hub, ela aparece aqui para conferência."
                />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {arrivals.map((m) => {
                        const unload = hubId ? ordersToUnload(m, hubId) : [];
                        return (
                            <OsRow key={m.id} tone="attention" onClick={() => navigate(`/hubs/receber/${m.id}`)}>
                                <div className="flex items-center justify-between gap-2 pr-1">
                                    <p className="truncate font-semibold text-tower-900 dark:text-white">
                                        {m.origin} → {m.destination}
                                    </p>
                                    <OsBadge tone="warn">conferir</OsBadge>
                                </div>
                                <p className="mt-0.5 truncate text-[13px] text-tower-500 dark:text-tower-400">
                                    {unload.length > 0 ? `${unload.length} pedido(s) descem aqui` : 'descarga a confirmar'}
                                    {m.link?.name ? ` · ${m.link.name}` : ''} · {nf0.format(m.totalWeight)} kg
                                </p>
                            </OsRow>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ReceivePage;
