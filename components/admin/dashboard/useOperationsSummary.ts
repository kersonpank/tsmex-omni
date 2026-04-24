import { useCallback, useEffect, useState } from 'react';
import { dashboardApi } from '../../../lib/api';
import type { OperationsSummaryData } from '../../../types/index';

export function useOperationsSummary(enabled: boolean) {
  const [data, setData] = useState<OperationsSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.getOperationsSummary();
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.error || 'Falha ao carregar resumo operacional');
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setError(msg || 'Erro ao carregar resumo operacional');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
