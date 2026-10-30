import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { hubCargoApi, manifestsApi } from '../../../lib/api';
import type { HubCargoItem } from '../../../types/index';
import { useOs } from '../OsContext';
import { arrivingManifests, ordersToUnload, type ManifestWithLegs } from '../lib/arrival';
import { cargoFacts } from '../lib/cargo';
import { addressLine, canRequestCollection, collectionBadge } from '../lib/collection';
import { looksLikeAccessKey } from '../lib/intake';
import { useScanController } from '../useScanController';
import { OsBadge, OsButton, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../ui/kit';
import { IconReceive } from '../ui/icons';
import { osFieldClass } from '../ui/Sheet';
import CollectionRequestSheet from './CollectionRequestSheet';

/**
 * RECEBER — tudo o que entra no hub. Pergunta: "o que chegou e precisa de entrada?"
 * Balcão: escanear a DANFE (ou digitar a chave) → entrada → pedido → etiquetas.
 * Doca: viagens em rota para cá → conferência da descarga.
 */

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const ReceivePage: React.FC = () => {
    const navigate = useNavigate();
    const { hubId, capabilities, refresh } = useOs();
    const [arrivals, setArrivals] = useState<ManifestWithLegs[]>([]);
    const [awaiting, setAwaiting] = useState<HubCargoItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [key, setKey] = useState('');
    const [requesting, setRequesting] = useState(false);

    const load = useCallback(async () => {
        if (!hubId) return;
        setError(null);
        try {
            const [trips, waiting] = await Promise.all([
                manifestsApi.list({ status: 'IN_PROGRESS' }),
                hubCargoApi.list({ bucket: 'awaiting', limit: 20, sort: 'recent', hubId }),
            ]);
            setArrivals(arrivingManifests((Array.isArray(trips.data) ? trips.data : []) as ManifestWithLegs[], hubId));
            setAwaiting(Array.isArray(waiting.data) ? waiting.data : []);
        } catch {
            setError('Não foi possível carregar o que está chegando. Tente de novo.');
        } finally {
            setLoading(false);
        }
    }, [hubId]);

    useEffect(() => {
        void load();
    }, [load]);

    const scan = useScanController(hubId, () => {
        void load();
        void refresh();
    });

    if (!capabilities.canReceive) {
        return <OsEmpty title="Este hub não recebe carga" detail="O perfil deste hub não tem recebimento habilitado." />;
    }

    const submitKey = () => {
        if (!key.trim()) return;
        void scan.handleCode(key);
        setKey('');
    };

    return (
        <div className="pb-6">
            <OsSectionTitle>Entrada no balcão</OsSectionTitle>
            <OsButton full onClick={scan.openScanner} disabled={scan.busy}>
                <IconReceive size={20} />
                {scan.busy ? 'Lendo a nota…' : 'Escanear nota fiscal'}
            </OsButton>
            <div className="mt-2 flex gap-2">
                <input
                    inputMode="numeric"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitKey()}
                    placeholder="ou digite a chave de 44 dígitos"
                    className={clsx(osFieldClass, 'min-w-0 flex-1 font-mono text-[13px]')}
                />
                <OsButton variant="secondary" disabled={!looksLikeAccessKey(key) || scan.busy} onClick={submitKey}>
                    Buscar
                </OsButton>
            </div>
            <OsButton full variant="secondary" className="mt-2" onClick={() => setRequesting(true)}>
                Solicitar coleta
            </OsButton>
            {scan.message ? (
                <p
                    className={clsx(
                        'mt-3 rounded-xl border-l-4 p-3 text-[13px] font-semibold',
                        scan.message.kind === 'error'
                            ? 'border-brand-red-500 bg-brand-red-500/8 text-brand-red-700 dark:text-brand-red-400'
                            : 'border-brand-500 bg-brand-500/8 text-brand-700 dark:text-brand-200',
                    )}
                >
                    {scan.message.text}
                </p>
            ) : null}

            <OsSectionTitle>Aguardando entrada</OsSectionTitle>
            {loading ? (
                <OsSkeletonRows count={2} />
            ) : awaiting.length === 0 ? (
                <OsEmpty title="Nenhuma nota esperando" detail="Notas anunciadas ou descobertas na SEFAZ para este hub aparecem aqui." />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {awaiting.map((item) => (
                        <OsRow key={`${item.kind}-${item.id}`} tone="attention" onClick={() => void scan.openItem(item)}>
                            <div className="flex items-center justify-between gap-2 pr-1">
                                <p className="truncate font-semibold text-tower-900 dark:text-white">
                                    {item.collectionRequest?.senderName ?? (item.nfNumber ? `NF ${item.nfNumber}` : item.statusLabel)}
                                </p>
                                <OsBadge tone="warn">{item.collectionRequest ? collectionBadge(item.collectionRequest) : 'dar entrada'}</OsBadge>
                            </div>
                            <p className="mt-0.5 truncate text-[13px] text-tower-500 dark:text-tower-400">{item.collectionRequest ? addressLine(item.collectionRequest.address) || item.collectionRequest.senderName : cargoFacts(item) || item.statusLabel}
                            </p>
                            {canRequestCollection(item) ? (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        scan.requestCollectionFor(item);
                                    }}
                                    className="mt-1 min-h-[40px] text-[13px] font-bold text-brand-600 dark:text-brand-300"
                                >
                                    Solicitar coleta desta NF
                                </button>
                            ) : null}
                        </OsRow>
                    ))}
                </div>
            )}

            <OsSectionTitle>Viagens chegando</OsSectionTitle>
            {loading ? (
                <OsSkeletonRows count={2} />
            ) : error ? (
                <OsErrorNotice message={error} onRetry={() => void load()} />
            ) : arrivals.length === 0 ? (
                <OsEmpty title="Nenhuma viagem vindo para cá" detail="Transferências em rota para este hub aparecem aqui para conferência." />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {arrivals.map((m) => {
                        const unload = hubId ? ordersToUnload(m, hubId) : [];
                        return (
                            <OsRow key={m.id} tone="route" onClick={() => navigate(`/hubs/receber/${m.id}`)}>
                                <div className="flex items-center justify-between gap-2 pr-1">
                                    <p className="truncate font-semibold text-tower-900 dark:text-white">
                                        {m.origin} → {m.destination}
                                    </p>
                                    <OsBadge tone="route">conferir</OsBadge>
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

            {requesting && hubId ? (
                <CollectionRequestSheet
                    hubId={hubId}
                    onClose={() => setRequesting(false)}
                    onDone={() => {
                        setRequesting(false);
                        void load();
                        void refresh();
                    }}
                />
            ) : null}
            {scan.overlays}
        </div>
    );
};

export default ReceivePage;
