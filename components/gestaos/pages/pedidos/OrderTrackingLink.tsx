import React from 'react';
import { trackingPath, trackingUrl } from '../../lib/pedidoDrawer';
import { Button } from '../../ui/kit';
import { useToast } from '../../ui/overlay';
import { DrawerBlock } from './DrawerBlock';

/** Link público de rastreio para o cliente (`/#/tracking/<demanda>`), pronto para copiar. */
export const OrderTrackingLink: React.FC<{ order: { id: string; demandId?: string | null; demand?: { id?: string | null } | null } }> = ({ order }) => {
    const toast = useToast();
    const path = trackingPath(order);
    const url = trackingUrl(window.location.origin, path);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success('Link de rastreio copiado.');
        } catch {
            toast.error('Não foi possível copiar. Selecione o link e copie à mão.');
        }
    };

    return (
        <DrawerBlock title="Rastreio do cliente">
            <p className="gx-mono break-all text-[12.5px]" data-testid="tracking-url">
                {url}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="soft" onClick={() => void copy()}>
                    Copiar link
                </Button>
                <a href={`#${path}`} target="_blank" rel="noreferrer" className="gx-btn gx-btn-ghost gx-btn-sm">
                    Abrir rastreio
                </a>
            </div>
        </DrawerBlock>
    );
};
