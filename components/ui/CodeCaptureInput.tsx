import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';

const QRCodeScanner = lazy(() => import('./QRCodeScanner'));

interface CodeCaptureInputProps {
  onSubmit: (code: string) => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.75A1.75 1.75 0 0 1 5.75 6h2l1.1-1.5h6.3L16.25 6h2A1.75 1.75 0 0 1 20 7.75v9.5A1.75 1.75 0 0 1 18.25 19H5.75A1.75 1.75 0 0 1 4 17.25v-9.5Z" />
    <circle cx="12" cy="12.5" r="3.25" />
  </svg>
);

const CodeCaptureInput: React.FC<CodeCaptureInputProps> = ({
  onSubmit,
  busy = false,
  disabled = false,
  autoFocus = true,
  placeholder = 'Bipe ou busque pedido, NF-e, CT-e...',
}) => {
  const [code, setCode] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy && autoFocus) inputRef.current?.focus();
  }, [autoFocus, busy]);

  const submit = async (raw: string) => {
    const value = raw.trim();
    if (!value || busy || disabled) return;
    await onSubmit(value);
    setCode('');
    if (autoFocus) inputRef.current?.focus();
  };

  return (
    <>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(code);
        }}
      >
        <div className="relative min-w-0 flex-1">
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-tower-400" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path strokeLinecap="round" d="m16 16 4 4" />
          </svg>
          <input
            ref={inputRef}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={disabled || busy}
            placeholder={placeholder}
            autoComplete="off"
            enterKeyHint="search"
            aria-label="Bipar ou buscar carga"
            className="h-12 w-full rounded-xl border border-tower-300 bg-white pl-10 pr-3 text-sm text-tower-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 disabled:opacity-60 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
          />
        </div>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={disabled || busy}
          aria-label="Abrir câmera para ler código"
          className="admin-focus grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-tower-300 bg-white text-tower-700 transition hover:bg-tower-50 disabled:opacity-60 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          <CameraIcon />
        </button>
        <button
          type="submit"
          disabled={disabled || busy || !code.trim()}
          className="admin-focus hidden h-12 shrink-0 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50 sm:block"
        >
          {busy ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      {cameraOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 text-sm text-white">Abrindo câmera...</div>}>
          <QRCodeScanner
            onScan={(result) => {
              setCameraOpen(false);
              setCode(result);
              void submit(result);
            }}
            onClose={() => setCameraOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
};

export default CodeCaptureInput;
