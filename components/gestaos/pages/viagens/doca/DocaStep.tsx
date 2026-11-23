import React, { useMemo } from 'react';
import { manifestsApi } from '../../../../../lib/api';
import type { DeliveryProgress, Manifest } from '../../../../../types/index';
import type { ManifestWithLegs } from '../../../../os/lib/arrival';
import { isDeliveryTrip, unloadPoints } from '../../../lib/docaWork';
import { useResource } from '../../../lib/resource';
import { EmptyState, Loadable, Skeleton } from '../../../ui/kit';
import { DeliverySection } from './DeliverySection';
import { ReceivePoint } from './ReceivePoint';

/**
 * Chegada, conferência, entrega e conclusão da viagem pela torre (decisão do dono: a torre também opera a doca).
 * Cada escrita é "registrada pela torre", com a conta de quem operou; a lógica é a do TSM O.S.
 */
export const DocaStep = ({ trip, onChanged }: { trip: Manifest; onChanged: () => void }) => {
    const t = trip as ManifestWithLegs;
    const running = t.status === 'IN_PROGRESS';
    const finished = t.status === 'COMPLETED';
    const points = useMemo(() => unloadPoints(t), [t]);
    const delivery = isDeliveryTrip(t) && (running || finished);
    const progress = useResource<DeliveryProgress[]>(delivery ? `manifest:doca:${t.id}` : null, async () => (await manifestsApi.deliveryProgress(t.id)).data ?? [], { staleMs: 0 });

    if (!running && !finished) {
        return <EmptyState title="A doca abre quando a viagem estiver na estrada" hint="Chegada, conferência e entrega só podem ser registradas depois da saída." />;
    }

    return (
        <div className="flex flex-col gap-6">
            {points.map((point) => (
                <ReceivePoint key={point.stop?.id ?? 'viagem'} trip={t} point={point} canOperate={running} onChanged={onChanged} />
            ))}
            {delivery ? (
                <Loadable state={progress} skeleton={<Skeleton rows={3} />}>
                    {(items) => <DeliverySection manifestId={t.id} items={items} canOperate={running} onChanged={onChanged} />}
                </Loadable>
            ) : null}
            {points.length === 0 && !delivery ? <EmptyState title="Nada para descarregar nem entregar" hint="Esta viagem não tem paradas com hub nem pedidos de entrega." /> : null}
        </div>
    );
};
