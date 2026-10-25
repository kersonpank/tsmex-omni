import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { hubCargoApi } from '../../../../lib/api';
import type { HubCargoItem } from '../../../../types/index';
import { useOs } from '../../OsContext';
import { useFreightDoc } from '../../useFreightDoc';
import { buildVolumeLabels, cargoFacts } from '../../lib/cargo';
import { orderNextStep } from '../../lib/nextStep';
import { isCubageInformed } from '../../lib/packages';
import { orderReadiness } from '../../lib/readiness';
import { OsBadge, OsButton, OsCard, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../../ui/kit';
import { IconCheck, IconTag } from '../../ui/icons';
import FreightComposer from './FreightComposer';
import FreightDocuments from './FreightDocuments';
import PackagesEditor from './PackagesEditor';
import PayerRow from './PayerRow';

/**
 * PEDIDO NO HUB — "o que falta para este pedido ficar pronto para viajar?"
 * A roda depois da entrada: etiquetar os volumes e emitir o documento do frete (CT-e/minuta),
 * que é do pedido e sai antes de qualquer carregamento (NORTE #30). Documentado → fila de viagem.
 */
const OrderPage: React.FC = () => {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { hubId, refresh } = useOs();
    const state = (location.state ?? null) as { item?: HubCargoItem; fromEntry?: boolean } | null;
    const [item, setItem] = useState<HubCargoItem | null>(state?.item ?? null);
    const [another, setAnother] = useState(false);
    const freight = useFreightDoc(orderId);
    const [editingPackages, setEditingPackages] = useState(false);
    const [savedVolumeM3, setSavedVolumeM3] = useState<number | null>(null);
    const freightSection = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!orderId || !hubId) return;
        let cancelled = false;
        hubCargoApi
            .resolve(orderId, hubId)
            .then((body) => {
                if (!cancelled && 'item' in body.data && body.data.item) setItem(body.data.item);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [orderId, hubId]);

    const reload = async () => {
        await freight.reload();
        void refresh();
    };

    // Um documento novo apareceu: sai do modo "emitir outro".
    const docCount = freight.suggestion?.documents.length ?? 0;
    useEffect(() => setAnother(false), [docCount]);

    const labels = item ? buildVolumeLabels(item) : [];
    const s = freight.suggestion;
    const documented = s?.state === 'emitted';
    const volumeM3 = savedVolumeM3 ?? item?.volumeM3 ?? null;
    const readiness = orderReadiness({ inStock: item ? item.bucket === 'stock' : null, volumeM3, docState: s?.state ?? null });
    // Impressão de etiquetas não é rastreada (labelsPrinted indefinido): o passo é pulado.
    const next = orderNextStep({ volumeM3: volumeM3 ?? 0, freightDocState: s?.state ?? null, inTrip: Boolean(item?.activeTrip) });
    const runNext = () => {
        if (next.action === 'cubage') setEditingPackages(true);
        else if (next.action === 'labels' && item) navigate(`/hubs/etiquetas/${orderId}`, { state: { item } });
        else if (next.action === 'freight') freightSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else if (next.action === 'trip') navigate('/hubs/cargas?select=1');
    };
    const cubageDone = volumeM3 != null && isCubageInformed(volumeM3);
    const composing = s && (!['emitted', 'in_flight'].includes(s.state) || another);

    return (
        <div className="pb-32">
            {state?.fromEntry ? (
                <p className="mb-3 rounded-xl bg-emerald-600/10 p-3 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">
                    Entrada confirmada. Etiquete os volumes e emita o documento do frete.
                </p>
            ) : null}

            {next.action !== 'none' && (item || s) ? (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-brand-600/10 p-3">
                    <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-tower-500 dark:text-tower-400">Próximo passo</p>
                        <p className="text-[14px] font-bold text-tower-900 dark:text-white">{next.label}</p>
                    </div>
                    <OsButton className="min-h-[44px] shrink-0" onClick={runNext}>
                        {next.action === 'trip' ? 'Ir às cargas' : 'Fazer agora'}
                    </OsButton>
                </div>
            ) : null}

            <OsCard>
                <p className="font-display text-[20px] font-extrabold text-tower-900 dark:text-white">
                    {s?.orderNumber || item?.orderNumber ? `Pedido ${s?.orderNumber ?? item?.orderNumber}` : 'Pedido'}
                    {s?.nfNumber || item?.nfNumber ? <span className="ml-2 font-mono text-[14px] font-medium text-tower-500"> NF {s?.nfNumber ?? item?.nfNumber}</span> : null}
                </p>
                {item ? <p className="mt-0.5 text-[13px] text-tower-500 dark:text-tower-400">{cargoFacts(item) || item.statusLabel}</p> : null}
                {item?.destination ? <p className="text-[13px] text-tower-400">Destino: {item.destination}</p> : null}
            </OsCard>

            {readiness.items.length > 0 ? (
                <div
                    className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border-l-4 px-3 py-2.5 ${
                        readiness.ready ? 'border-emerald-500 bg-emerald-600/8' : 'border-brand-yellow-400 bg-brand-yellow-400/15'
                    }`}
                >
                    <span className="text-[13px] font-bold text-tower-900 dark:text-white">Pronto para viajar?</span>
                    {readiness.items.map((i) => (
                        <OsBadge key={i.key} tone={i.ok ? 'ok' : 'warn'}>
                            {i.ok ? '✓' : '•'} {i.label}
                        </OsBadge>
                    ))}
                </div>
            ) : null}

            <OsSectionTitle>1 · Etiquetas</OsSectionTitle>
            <OsRow tone="none" onClick={item ? () => navigate(`/hubs/etiquetas/${orderId}`, { state: { item } }) : undefined}>
                <span className="flex items-center gap-2 font-semibold text-tower-900 dark:text-white">
                    <IconTag size={18} />
                    Imprimir etiquetas{labels.length > 0 ? ` (${labels.length} volume${labels.length > 1 ? 's' : ''})` : ''}
                </span>
            </OsRow>

            <OsSectionTitle>2 · Cubagem</OsSectionTitle>
            <OsRow tone={cubageDone ? 'ok' : 'attention'} onClick={orderId ? () => setEditingPackages(true) : undefined}>
                <span className="flex w-full items-center justify-between gap-2 font-semibold text-tower-900 dark:text-white">
                    <span>
                        {cubageDone ? `${Number(volumeM3).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m³` : 'Cubagem não informada'}
                    </span>
                    <span className="text-[13px] font-bold text-brand-600 dark:text-brand-300">{cubageDone ? 'Editar medidas' : 'Informar medidas'}</span>
                </span>
            </OsRow>

            <div ref={freightSection} />
            <OsSectionTitle>3 · Documento do frete</OsSectionTitle>
            {freight.loading ? (
                <OsSkeletonRows count={2} />
            ) : freight.error || !s || !orderId ? (
                <OsErrorNotice message={freight.error ?? 'Pedido não encontrado.'} onRetry={() => void freight.reload()} />
            ) : (
                <>
                    <PayerRow orderId={orderId} suggestion={s} onChanged={reload} />
                    <FreightDocuments orderId={orderId} documents={s.documents} onResent={reload} />
                    {composing ? (
                        <div className="mt-3">
                            <FreightComposer key={`${s.freightTerm}-${another}`} orderId={orderId} suggestion={s} newDocument={another} onEmitted={reload} />
                        </div>
                    ) : (
                        <button type="button" onClick={() => setAnother(true)} className="mt-2 min-h-[40px] text-[13px] font-bold text-brand-600 dark:text-brand-300">
                            Emitir outro documento para este pedido
                        </button>
                    )}
                </>
            )}

            {documented && !composing ? (
                <>
                    <OsSectionTitle>4 · Pronto para viajar</OsSectionTitle>
                    <OsRow tone="ok" onClick={() => navigate('/hubs/viagens')}>
                        <span className="flex items-center gap-2 font-semibold text-tower-900 dark:text-white">
                            <IconCheck size={18} />
                            Documentado — ver a fila de viagens
                        </span>
                    </OsRow>
                </>
            ) : null}

            {editingPackages && orderId ? (
                <PackagesEditor
                    orderId={orderId}
                    onClose={() => setEditingPackages(false)}
                    onSaved={(volume) => {
                        setSavedVolumeM3(volume);
                        setEditingPackages(false);
                        void reload();
                    }}
                />
            ) : null}
        </div>
    );
};

export default OrderPage;
