import React, { useEffect, useRef, useState } from 'react';
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
      setError('Não foi possível acessar a câmera. Verifique as permissões do navegador.');
    }
  };

  useEffect(() => {
    startCamera(mode);
    return stopAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const switchMode = (newMode: 'barcode' | 'qr') => {
    if (newMode !== mode) setMode(newMode);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-900 dark:text-white">Escanear DANFE</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          {(['barcode', 'qr'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-b-2 border-indigo-600'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {m === 'barcode' ? '▬ Código de Barras' : '⬛ QR Code'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-4">
          {error ? (
            <div className="text-center py-8">
              <p className="text-red-600 text-sm mb-4">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Fechar
              </button>
            </div>
          ) : (
            <div className="relative w-full rounded-lg overflow-hidden bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} className="w-full" />

              {/* Overlay da faixa de scan */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className={`border-2 rounded shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] ${
                    mode === 'barcode'
                      ? 'w-[90%] h-[90px] border-white'
                      : 'w-[200px] h-[200px] border-white'
                  }`}
                />
              </div>

              {/* Status */}
              {status === 'starting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <p className="text-white text-sm">Iniciando câmera...</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!error && (
          <div className="px-4 pb-4 space-y-3">
            {/* Botão de captura manual */}
            <button
              type="button"
              onClick={decodeFrame}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              📷 Capturar agora
            </button>

            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
              {mode === 'barcode'
                ? <>Centralize o <strong>código de barras</strong> na faixa. O scanner tenta automaticamente a cada 200ms. Use <strong>Capturar agora</strong> para forçar a leitura.</>
                : <>Aponte para o <strong>QR Code</strong> e aguarde ou use <strong>Capturar agora</strong>.</>
              }
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default QRCodeScanner;
