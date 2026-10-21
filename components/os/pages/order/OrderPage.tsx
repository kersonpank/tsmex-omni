import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { hubCargoApi } from '../../../../lib/api';
import type { HubCargoItem } from '../../../../types/index';
import { useOs } from '../../OsContext';
import { useFreightDoc } from '../../useFreightDoc';
import { buildVolumeLabels, cargoFacts } from '../../lib/cargo';
import { OsCard, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows } from '../../ui/kit';
import { IconCheck, IconTag } from '../../ui/icons';
import FreightComposer from './FreightComposer';
import FreightDocuments from './FreightDocuments';
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

    const reload = () => {
        void freight.reload();
        void refresh();
    };

    // Um documento novo apareceu: sai do modo "emitir outro".
    const docCount = freight.suggestion?.documents.length ?? 0;
    useEffect(() => setAnother(false), [docCount]);

    const labels = item ? buildVolumeLabels(item) : [];
    const s = freight.suggestion;
    const documented = s?.state === 'emitted';
    const composing = s && (!['emitted', 'in_flight'].includes(s.state) || another);

    return (
        <div className="pb-32">
            {state?.fromEntry ? (
                <p className="mb-3 rounded-xl bg-emerald-600/10 p-3 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">
                    Entrada confirmada. Etiquete os volumes e emita o documento do frete.
                </p>
            ) : null}

            <OsCard>
                <p className="font-display text-[20px] font-extrabold text-tower-900 dark:text-white">
                    {s?.orderNumber || item?.orderNumber ? `Pedido ${s?.orderNumber ?? item?.orderNumber}` : 'Pedido'}
                    {s?.nfNumber || item?.nfNumber ? <span className="ml-2 font-mono text-[14px] font-medium text-tower-500"> NF {s?.nfNumber ?? item?.nfNumber}</span> : null}
                </p>
                {item ? <p className="mt-0.5 text-[13px] text-tower-500 dark:text-tower-400">{cargoFacts(item) || item.statusLabel}</p> : null}
                {item?.destination ? <p className="text-[13px] text-tower-400">Destino: {item.destination}</p> : null}
            </OsCard>

            <OsSectionTitle>1 · Etiquetas</OsSectionTitle>
            <OsRow tone="none" onClick={item ? () => navigate(`/hubs/etiquetas/${orderId}`, { state: { item } }) : undefined}>
                <span className="flex items-center gap-2 font-semibold text-tower-900 dark:text-white">
                    <IconTag size={18} />
                    Imprimir etiquetas{labels.length > 0 ? ` (${labels.length} volume${labels.length > 1 ? 's' : ''})` : ''}
                </span>
            </OsRow>

            <OsSectionTitle>2 · Documento do frete</OsSectionTitle>
            {freight.loading ? (
                <OsSkeletonRows count={2} />
            ) : freight.error || !s || !orderId ? (
                <OsErrorNotice message={freight.error ?? 'Pedido não encontrado.'} onRetry={() => void freight.reload()} />
            ) : (
                <>
                    <PayerRow orderId={orderId} suggestion={s} onChanged={reload} />
                    <FreightDocuments orderId={orderId} documents={s.documents} />
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
                    <OsSectionTitle>3 · Pronto para viajar</OsSectionTitle>
                    <OsRow tone="ok" onClick={() => navigate('/hubs/viagens')}>
                        <span className="flex items-center gap-2 font-semibold text-tower-900 dark:text-white">
                            <IconCheck size={18} />
                            Documentado — ver a fila de viagens
                        </span>
                    </OsRow>
                </>
            ) : null}
        </div>
    );
};

export default OrderPage;
