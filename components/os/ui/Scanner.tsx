import React, { useEffect, useRef, useState } from 'react';
import {
    BarcodeFormat,
    BinaryBitmap,
    DecodeHintType,
    HTMLCanvasElementLuminanceSource,
    HybridBinarizer,
    MultiFormatReader,
} from '@zxing/library';
import { OsButton } from './kit';
import { IconX } from './icons';

/**
 * Leitor do TSM O.S. — mesmo motor (ZXing) que já lê a DANFE no painel atual, sem escolher modo:
 * alterna a cada quadro entre código de barras (CODE-128 da chave de 44 dígitos da DANFE, numa
 * faixa horizontal em resolução cheia — o código é longo e fino) e QR (etiquetas TSM, DACTE,
 * DAMDFE) no quadro inteiro. Devolve o texto cru para o resolve do hub.
 */

function reader(formats: BarcodeFormat[]): MultiFormatReader {
    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const r = new MultiFormatReader();
    r.setHints(hints);
    return r;
}

const Scanner: React.FC<{ onCode: (code: string) => void; onClose: () => void }> = ({ onCode, onClose }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const onCodeRef = useRef(onCode);
    onCodeRef.current = onCode;
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let stream: MediaStream | null = null;
        let timer: ReturnType<typeof setInterval> | null = null;
        let done = false;
        const barcode = reader([BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF]);
        const qr = reader([BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX]);
        const canvas = document.createElement('canvas');
        let tick = 0;

        const decode = () => {
            const video = videoRef.current;
            if (done || !video || video.readyState < 2 || !video.videoWidth) return;
            const w = video.videoWidth;
            const h = video.videoHeight;
            const tryBarcode = tick++ % 2 === 0;
            // Faixa central (40% da altura) em largura total para o código de barras; quadro inteiro para QR.
            const bandH = Math.round(h * 0.4);
            const sy = tryBarcode ? Math.round((h - bandH) / 2) : 0;
            const sh = tryBarcode ? bandH : h;
            canvas.width = w;
            canvas.height = sh;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;
            ctx.drawImage(video, 0, sy, w, sh, 0, 0, w, sh);
            try {
                const bitmap = new BinaryBitmap(new HybridBinarizer(new HTMLCanvasElementLuminanceSource(canvas)));
                const result = (tryBarcode ? barcode : qr).decodeWithState(bitmap);
                done = true;
                if (navigator.vibrate) navigator.vibrate(60);
                onCodeRef.current(result.getText());
            } catch {
                /* quadro sem código — segue tentando */
            }
        };

        (async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
                });
                const video = videoRef.current;
                if (!video) return;
                video.srcObject = stream;
                video.muted = true;
                video.playsInline = true;
                await video.play();
                timer = setInterval(decode, 220);
            } catch {
                setError('Câmera indisponível. Permita o acesso à câmera ou digite a chave/código.');
            }
        })();

        return () => {
            done = true;
            if (timer) clearInterval(timer);
            stream?.getTracks().forEach((t) => t.stop());
        };
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
            <div className="flex items-center justify-between px-4 py-3 text-white">
                <p className="font-display text-[15px] font-bold">Código de barras da DANFE, QR ou etiqueta</p>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar leitor"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 active:bg-white/20"
                >
                    <IconX />
                </button>
            </div>
            <div className="relative min-h-0 flex-1">
                <video ref={videoRef} className="h-full w-full object-cover" />
                {/* Guia: a faixa onde o código de barras é lido. */}
                <div className="pointer-events-none absolute inset-x-4 top-1/2 h-[28%] -translate-y-1/2 rounded-xl border-2 border-brand-yellow-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            {error ? (
                <div className="px-4 py-5 text-center text-sm text-white/90">
                    <p>{error}</p>
                    <OsButton variant="secondary" className="mt-3" onClick={onClose}>
                        Voltar e digitar
                    </OsButton>
                </div>
            ) : (
                <p className="px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 text-center text-[13px] text-white/70">
                    Aproxime até o código de barras ocupar a faixa de ponta a ponta. A leitura é automática.
                </p>
            )}
        </div>
    );
};

export default Scanner;
