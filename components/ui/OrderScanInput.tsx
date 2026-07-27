import React, { useEffect, useRef, useState } from 'react';
import { ordersApi } from '../../lib/api';
import type { ResolvedOrderSummary } from '../../types/index';
import QRCodeScanner from './QRCodeScanner';

interface OrderScanInputProps {
  manifestId?: string;
  onResolved: (order: ResolvedOrderSummary) => void;
  disabled?: boolean;
}

const OrderScanInput: React.FC<OrderScanInputProps> = ({ manifestId, onResolved, disabled }) => {
  const [code, setCode] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [candidates, setCandidates] = useState<ResolvedOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const resolve = async (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotFound(false);
    setCandidates(null);
    try {
      const res = await ordersApi.resolve(trimmed, manifestId);
      if (res.match === 'single') {
        onResolved(res.order);
        setCode('');
      } else if (res.match === 'multiple') {
        setCandidates(res.candidates);
      } else {
        setNotFound(true);
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao buscar pedido');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void resolve(code);
  };

  const handleCameraScan = (result: string) => {
    setShowCamera(false);
    setCode(result);
    void resolve(result);
  };

  const chooseCandidate = (order: ResolvedOrderSummary) => {
    setCandidates(null);
    setCode('');
    onResolved(order);
    inputRef.current?.focus();
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={disabled || busy}
          placeholder="Bipe ou digite chave NF-e/CT-e, número ou nº do pedido"
          className="flex-1 min-w-0 px-3 py-2 border border-tower-200 rounded-lg dark:border-tower-600 dark:bg-tower-900"
        />
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          disabled={disabled || busy}
          className="px-3 py-2 bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700 disabled:opacity-50"
          aria-label="Escanear com a câmera"
        >
          📷
        </button>
        <button
          type="submit"
          disabled={disabled || busy || !code.trim()}
          className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? '...' : 'Buscar'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {notFound && (
        <p
          role="alert"
          className="mt-2 text-sm rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 px-3 py-2"
        >
          Nenhum pedido encontrado com esse código neste hub. Verifique o código ou tente outro hub.
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <div
          aria-live="polite"
          className="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-3"
        >
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 mb-2">
            Mais de um pedido encontrado com esse código — escolha o correto:
          </p>
          <ul className="space-y-1">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => chooseCandidate(c)}
                  className="w-full text-left px-3 py-2 bg-white dark:bg-tower-800 rounded-lg border border-tower-200 dark:border-tower-600 hover:bg-tower-50 dark:hover:bg-tower-700 text-sm"
                >
                  Pedido #{c.orderNumber ?? c.id.slice(0, 8)} · {c.origin} → {c.destination} · NF {c.nfNumber ?? '—'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showCamera && <QRCodeScanner onScan={handleCameraScan} onClose={() => setShowCamera(false)} />}
    </div>
  );
};

export default OrderScanInput;
