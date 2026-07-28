import React, { useEffect, useState } from 'react';
import { systemAlertsApi } from '../../lib/api';

interface AlertItem {
  id: string;
  category: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
}

// Static module-level constants — defined once, never recreated on render
const WARNING_CATEGORIES_SHOWN = new Set(['FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED', 'FISCAL_PROVIDER_ERROR']);

const RESUME_ACTION_BY_CATEGORY: Record<string, (alertId: string) => Promise<unknown>> = {
  FISCAL_PROVIDER_QUOTA: systemAlertsApi.resumeCteQueue,
  FISCAL_DISTRIBUICAO_NFE_QUOTA: systemAlertsApi.resumeDistribuicaoNfeQueue,
};

export default function SystemAlertBanner() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await systemAlertsApi.listOpen();
      if (result.success) {
        setAlerts(
          result.data.filter(
            (a) => a.severity === 'CRITICAL' || (a.severity === 'WARNING' && WARNING_CATEGORIES_SHOWN.has(a.category))
          )
        );
      }
    } catch {
      /* banner não deve quebrar o resto do painel */
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleResume = async (alertId: string, category: string) => {
    const resumeAction = RESUME_ACTION_BY_CATEGORY[category];
    if (!resumeAction) return;
    setResolving(alertId);
    try {
      await resumeAction(alertId);
      await load();
    } catch (e: any) {
      window.alert(e.response?.data?.error ?? e.message ?? 'Erro ao retomar a fila.');
    } finally {
      setResolving(null);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {alerts.map((alert) => {
        const isCritical = alert.severity === 'CRITICAL';
        return (
          <div
            key={alert.id}
            className={`px-4 py-2 text-sm flex items-center justify-between gap-4 ${
              isCritical ? 'bg-red-600 text-white' : 'bg-amber-500 text-amber-950'
            }`}
          >
            <span><strong>{alert.title}</strong> — {alert.message}</span>
            {RESUME_ACTION_BY_CATEGORY[alert.category] && (
              <button
                type="button"
                onClick={() => handleResume(alert.id, alert.category)}
                disabled={resolving === alert.id}
                className={`px-3 py-1 rounded text-xs font-medium disabled:opacity-50 ${
                  isCritical ? 'bg-white text-red-700' : 'bg-white text-amber-800'
                }`}
              >
                {resolving === alert.id ? 'Retomando…' : 'Retomar fila'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
