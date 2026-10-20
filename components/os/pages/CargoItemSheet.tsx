import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { HubCargoItem } from '../../../types/index';
import { buildVolumeLabels, cargoFacts } from '../lib/cargo';
import { OsBadge, OsButton } from '../ui/kit';
import { IconTag } from '../ui/icons';
import OsSheet from '../ui/Sheet';

/**
 * Folha do item de carga: fatos + a próxima ação. Em estoque (inclusive logo após a entrada),
 * a ação é etiquetar os volumes. A entrada no balcão tem folha própria (EntrySheet).
 */
const CargoItemSheet: React.FC<{ item: HubCargoItem; note?: string; onClose: () => void }> = ({ item, note, onClose }) => {
    const navigate = useNavigate();
    const labels = buildVolumeLabels(item);

    return (
        <OsSheet
            title={item.orderNumber ? `Pedido ${item.orderNumber}` : item.statusLabel}
            subtitle={item.nfNumber ? `NF ${item.nfNumber}` : undefined}
            onClose={onClose}
            footer={
                labels.length > 0 ? (
                    <OsButton full onClick={() => navigate(`/hubs/etiquetas/${item.orderId ?? item.id}`, { state: { item } })}>
                        <IconTag size={18} />
                        Imprimir etiquetas ({labels.length})
                    </OsButton>
                ) : undefined
            }
        >
            {note ? (
                <p className="mb-3 rounded-lg bg-emerald-600/10 p-3 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">{note}</p>
            ) : null}
            <p className="text-[14px] text-tower-600 dark:text-tower-300">{cargoFacts(item) || item.statusLabel}</p>
            {item.destination ? <p className="mt-1 text-[13px] text-tower-400">Destino: {item.destination}</p> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
                <OsBadge tone={item.bucket === 'stock' ? 'ok' : item.bucket === 'awaiting' ? 'warn' : 'route'}>{item.statusLabel}</OsBadge>
                {item.activeTrip ? (
                    <OsBadge tone="route">
                        em viagem · {item.activeTrip.origin} → {item.activeTrip.destination}
                    </OsBadge>
                ) : null}
            </div>
        </OsSheet>
    );
};

export default CargoItemSheet;
