import React, { useEffect, useState } from 'react';
import { systemAlertsApi } from '../../lib/api';

interface AlertItem {
  id: string;
  category: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
}

export default function SystemAlertBanner() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await systemAlertsApi.listOpen();
      if (result.success) setAlerts(result.data.filter((a) => a.severity === 'CRITICAL'));
    } catch {
      /* banner não deve quebrar o resto do painel */
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleResume = async (alertId: string) => {
    setResolving(alertId);
    try {
      await systemAlertsApi.resumeCteQueue(alertId);
      await load();
    } catch (e: any) {
      window.alert(e.response?.data?.error ?? e.message ?? 'Erro ao retomar a fila.');
    } finally {
      setResolving(null);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div className="bg-red-600 text-white px-4 py-2 text-sm flex flex-col gap-1">
      {alerts.map((alert) => (
        <div key={alert.id} className="flex items-center justify-between gap-4">
          <span><strong>{alert.title}</strong> — {alert.message}</span>
          {alert.category === 'FISCAL_PROVIDER_QUOTA' && (
            <button
              type="button"
              onClick={() => handleResume(alert.id)}
              disabled={resolving === alert.id}
              className="bg-white text-red-700 px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
            >
              {resolving === alert.id ? 'Retomando…' : 'Retomar fila'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
