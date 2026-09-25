import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  BinaryBitmap,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
} from '@zxing/library';

interface QRCodeScannerProps {
  onScan: (result: string) => void;
  onClose: () => void;
}

const QRCodeScanner: React.FC<QRCodeScannerProps> = ({ onScan, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const readerRef = useRef<MultiFormatReader | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [mode, setMode] = useState<'barcode' | 'qr'>('barcode');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'found'>('starting');

  const stopAll = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const decodeFrame = () => {
    const video = videoRef.current;
    const reader = readerRef.current;
    if (!video || !reader || video.readyState < 2 || video.videoWidth === 0) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);

      const luminance = new HTMLCanvasElementLuminanceSource(canvas);
      const bitmap = new BinaryBitmap(new HybridBinarizer(luminance));
      const result = reader.decodeWithState(bitmap);

      setStatus('found');
      stopAll();
      onScanRef.current(result.getText());
    } catch {
      // NotFoundException é normal — nenhum barcode neste frame, continua tentando
    }
  };

  const startCamera = async (scanMode: 'barcode' | 'qr') => {
    stopAll();
    setError(null);
    setStatus('starting');

    const hints = new Map<DecodeHintType, unknown>();
    if (scanMode === 'barcode') {
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]);
      hints.set(DecodeHintType.TRY_HARDER, true);
    } else {
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX]);
      hints.set(DecodeHintType.TRY_HARDER, true);
    }
    const reader = new MultiFormatReader();
    reader.setHints(hints);
    readerRef.current = reader;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;

      const video = videoRef.current!;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await video.play();

      setStatus('scanning');
      intervalRef.current = setInterval(decodeFrame, 500);
    } catch {
      stopAll();
      setError('A câmera não pôde ser aberta.');
    }
  };

  useEffect(() => {
    startCamera(mode);
    return stopAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from<HTMLButtonElement>(
        dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const switchMode = (newMode: 'barcode' | 'qr') => {
    if (newMode !== mode) setMode(newMode);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div ref={dialogRef} className="fixed inset-0 z-[100] flex bg-tower-950 sm:items-center sm:justify-center sm:bg-black/80 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="danfe-scanner-title">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-tower-950 text-white sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-md sm:rounded-2xl sm:shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-300">Leitura fiscal</p>
            <h2 id="danfe-scanner-title" className="mt-0.5 text-lg font-bold">Escanear DANFE</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="admin-focus grid size-11 place-items-center rounded-xl text-tower-300 hover:bg-white/10 hover:text-white"
            aria-label="Fechar câmera"
          >
            <svg className="size-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 border-b border-white/10 p-2" role="tablist" aria-label="Tipo de código">
          {(['barcode', 'qr'] as const).map(m => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`admin-focus min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors ${
                mode === m
                  ? 'bg-white text-tower-950'
                  : 'text-tower-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {m === 'barcode' ? 'Código de barras' : 'QR Code'}
            </button>
          ))}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-black sm:m-4 sm:min-h-[28rem] sm:rounded-xl">
          {error ? (
            <div className="grid h-full min-h-80 place-items-center px-6 text-center">
              <div>
                <div className="mx-auto grid size-12 place-items-center rounded-full bg-rose-500/15 text-rose-300" aria-hidden>!</div>
                <p className="mt-4 text-sm font-semibold text-white">{error}</p>
                <p className="mt-2 text-xs leading-5 text-tower-400">Libere o acesso nas configurações do navegador e tente novamente.</p>
              </div>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} className="h-full min-h-[45dvh] w-full object-cover sm:min-h-[28rem]" />

              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={`relative rounded-xl border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.48)] ${
                    mode === 'barcode'
                      ? 'h-28 w-[88%]'
                      : 'aspect-square w-[68%] max-w-64'
                  }`}
                >
                  <span className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-xl border-l-4 border-t-4 border-brand-300" />
                  <span className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-xl border-r-4 border-t-4 border-brand-300" />
                  <span className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-xl border-b-4 border-l-4 border-brand-300" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-xl border-b-4 border-r-4 border-brand-300" />
                </div>
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
                <p className="rounded-full bg-black/65 px-3 py-1.5 text-xs font-semibold text-white">
                  {status === 'starting'
                    ? 'Iniciando câmera...'
                    : mode === 'barcode'
                      ? 'Centralize a chave de acesso'
                      : 'Centralize o QR Code'}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="space-y-2 border-t border-white/10 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:border-0 sm:pt-0">
          {error ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onClose}
                className="admin-focus min-h-12 rounded-xl border border-white/15 px-4 text-sm font-semibold text-white"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => void startCamera(mode)}
                className="admin-focus min-h-12 rounded-xl bg-brand-500 px-4 text-sm font-bold text-white"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={decodeFrame}
              disabled={status === 'starting'}
              className="admin-focus flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-bold text-white hover:bg-brand-400 disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.75A1.75 1.75 0 0 1 5.75 6h2l1.1-1.5h6.3L16.25 6h2A1.75 1.75 0 0 1 20 7.75v9.5A1.75 1.75 0 0 1 18.25 19H5.75A1.75 1.75 0 0 1 4 17.25v-9.5Z" />
                <circle cx="12" cy="12.5" r="3.25" />
              </svg>
              Capturar agora
            </button>
          )}
          {!error && <p className="text-center text-[11px] text-tower-400">A leitura acontece automaticamente. A captura manual força uma nova tentativa.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default QRCodeScanner;
