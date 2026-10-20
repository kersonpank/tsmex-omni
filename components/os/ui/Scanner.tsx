import React, { useEffect, useRef, useState } from 'react';
import { OsButton } from './kit';
import { IconX } from './icons';

/**
 * Leitor de código do TSM O.S. — câmera traseira via html5-qrcode (dependência já
 * existente no app), carregada sob demanda para não pesar o chunk da estação.
 * Lê QR (DANFE/etiqueta) e código de barras; devolve o texto cru para o resolve.
 */

const REGION_ID = 'os-scanner-region';

const Scanner: React.FC<{ onCode: (code: string) => void; onClose: () => void }> = ({ onCode, onClose }) => {
    const [error, setError] = useState<string | null>(null);
    const stopRef = useRef<(() => Promise<void>) | null>(null);
    const firedRef = useRef(false);

    useEffect(() => {
        let disposed = false;
        (async () => {
            try {
                const { Html5Qrcode } = await import('html5-qrcode');
                if (disposed) return;
                const scanner = new Html5Qrcode(REGION_ID);
                stopRef.current = async () => {
                    try {
                        await scanner.stop();
                        scanner.clear();
                    } catch {
                        /* já parado */
                    }
                };
                await scanner.start(
                    { facingMode: 'environment' },
                    { fps: 8, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.75, height: Math.min(w, h) * 0.55 }) },
                    (text) => {
                        if (firedRef.current) return;
                        firedRef.current = true;
                        if (navigator.vibrate) navigator.vibrate(60);
                        onCode(text);
                    },
                    () => {
                        /* frame sem código — silêncio */
                    },
                );
            } catch {
                if (!disposed) {
                    setError('Câmera indisponível. Permita o acesso à câmera ou digite o código na busca.');
                }
            }
        })();
        return () => {
            disposed = true;
            void stopRef.current?.();
        };
    }, [onCode]);

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
            <div className="flex items-center justify-between px-4 py-3 text-white">
                <p className="font-display text-[15px] font-bold">Aponte para a etiqueta ou o QR da NF-e</p>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar leitor"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 active:bg-white/20"
                >
                    <IconX />
                </button>
            </div>
            <div id={REGION_ID} className="min-h-0 flex-1 [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
            {error ? (
                <div className="px-4 py-5 text-center text-sm text-white/90">
                    <p>{error}</p>
                    <OsButton variant="secondary" className="mt-3" onClick={onClose}>
                        Voltar e digitar o código
                    </OsButton>
                </div>
            ) : (
                <p className="px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 text-center text-[13px] text-white/60">
                    A leitura é automática — segure firme por um instante.
                </p>
            )}
        </div>
    );
};

export default Scanner;
