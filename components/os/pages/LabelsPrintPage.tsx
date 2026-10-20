import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import type { HubCargoItem } from '../../../types/index';
import { useOs } from '../OsContext';
import { buildVolumeLabels, type VolumeLabel } from '../lib/cargo';
import { OsButton, OsEmpty } from '../ui/kit';

/**
 * ETIQUETAS — uma por volume, com QR que o scan do hub resolve (número do pedido).
 * Impressão térmica ou A4 via diálogo do navegador; identidade por volume no
 * banco chega na Fatia 3 (conferência de carregamento).
 */

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const LabelsPrintPage: React.FC = () => {
    const navigate = useNavigate();
    const { hub } = useOs();
    const { state } = useLocation() as { state?: { item?: HubCargoItem } };
    const item = state?.item ?? null;
    const labels: VolumeLabel[] = item ? buildVolumeLabels(item) : [];
    const [qrs, setQrs] = useState<string[]>([]);

    useEffect(() => {
        if (labels.length === 0) return;
        let cancelled = false;
        QRCode.toDataURL(labels[0].code, { margin: 0, width: 240, errorCorrectionLevel: 'M' })
            .then((url) => {
                if (!cancelled) setQrs(labels.map(() => url));
            })
            .catch(() => {
                if (!cancelled) setQrs([]);
            });
        return () => {
            cancelled = true;
        };
        // labels deriva de item (estável via state); o QR é o mesmo para todos os volumes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item?.id]);

    if (!item || labels.length === 0) {
        return (
            <div className="pt-2">
                <OsEmpty
                    title="Abra as etiquetas pela carga"
                    detail="Vá em Cargas, toque no pedido e use “Imprimir etiquetas” — esta tela precisa dos dados do pedido."
                />
                <OsButton full variant="secondary" className="mt-4" onClick={() => navigate('/hubs/cargas')}>
                    Ir para Cargas
                </OsButton>
            </div>
        );
    }

    return (
        <div className="pb-8">
            <style>{`@media print {
                body * { visibility: hidden; }
                #os-labels, #os-labels * { visibility: visible; }
                #os-labels { position: absolute; inset: 0; }
                .os-label { break-inside: avoid; page-break-inside: avoid; }
            }`}</style>

            <div className="flex items-center justify-between gap-3 print:hidden">
                <div>
                    <p className="font-display text-[17px] font-bold text-tower-900 dark:text-white">
                        Etiquetas do pedido {item.orderNumber}
                    </p>
                    <p className="text-[13px] text-tower-500 dark:text-tower-400">
                        {labels.length} volume(s) · o QR leva ao pedido no scan do hub
                    </p>
                </div>
                <OsButton onClick={() => window.print()}>Imprimir</OsButton>
            </div>

            <div id="os-labels" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {labels.map((label, i) => (
                    <div
                        key={label.seq}
                        className="os-label rounded-lg border-2 border-black bg-white p-3 text-black"
                    >
                        <div className="flex items-start justify-between gap-2 border-b-2 border-black pb-1.5">
                            <span className="font-display text-[15px] font-extrabold leading-tight">
                                {hub?.code ?? 'TSM'} · TransMesquita
                            </span>
                            <span className="font-display text-[15px] font-extrabold">
                                VOL {label.seq}/{label.total}
                            </span>
                        </div>
                        <div className="mt-2 flex gap-3">
                            {qrs[i] ? <img src={qrs[i]} alt="" className="h-[96px] w-[96px] shrink-0" /> : null}
                            <div className="min-w-0 text-[12px] leading-snug">
                                <p className="font-display text-[22px] font-extrabold leading-none">#{label.code}</p>
                                {label.nfNumber ? <p className="mt-1 font-mono">NF {label.nfNumber}</p> : null}
                                {label.recipientName ? <p className="mt-1 truncate font-bold">{label.recipientName}</p> : null}
                                {label.destination ? <p className="truncate">{label.destination}</p> : null}
                                {label.weightKg > 0 ? <p className="mt-1">{nf0.format(label.weightKg)} kg (total)</p> : null}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default LabelsPrintPage;
