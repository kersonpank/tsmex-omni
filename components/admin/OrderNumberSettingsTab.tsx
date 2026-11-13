import React, { useCallback, useEffect, useState } from 'react';
import { operationSettingsApi, orderSequenceApi } from '../../lib/api';
import type { OrderSequenceConfig, UserRole } from '../../types/index';

/** Papéis que podem ser liberados para trocar o status do pedido à mão. Administrador é sempre incluído. */
const MANUAL_STATUS_ROLES: { role: UserRole; label: string }[] = [
  { role: 'ADMIN', label: 'Administrador' },
  { role: 'HUB', label: 'Hub' },
  { role: 'LINK', label: 'Transportador' },
];

const OrderNumberSettingsTab: React.FC = () => {
  const [config, setConfig] = useState<OrderSequenceConfig | null>(null);
  const [lastNumber, setLastNumber] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusRoles, setStatusRoles] = useState<UserRole[]>(['ADMIN', 'HUB', 'LINK']);
  const [savingRoles, setSavingRoles] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderSequenceApi.get();
      if (res.data) {
        setConfig(res.data);
        setLastNumber(res.data.lastNumber);
      }
      const operation = await operationSettingsApi.get();
      if (operation.data) setStatusRoles(operation.data.manualOrderStatusRoles);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao carregar numeração de pedidos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await orderSequenceApi.update(Math.max(0, Number(lastNumber) || 0));
      if (res.data) {
        setConfig(res.data);
        setLastNumber(res.data.lastNumber);
      }
      setSuccess('Contador atualizado. O próximo pedido criado sairá com o número seguinte.');
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao salvar numeração de pedidos');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRoles = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRoles(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await operationSettingsApi.update(statusRoles);
      if (res.data) setStatusRoles(res.data.manualOrderStatusRoles);
      setSuccess('Permissão de alteração manual do status do pedido atualizada.');
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao salvar quem pode alterar o status do pedido');
    } finally {
      setSavingRoles(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-tower-500 dark:text-tower-400">Carregando...</div>;
  }

  return (
    <div className="max-w-xl space-y-4">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">{error}</div>}
      {success && <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-600 dark:bg-brand-950/50 dark:text-tower-100">{success}</div>}

      <div className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
        <p className="text-sm text-tower-600 dark:text-tower-400">
          Todo pedido/demanda criado recebe um número sequencial único, global para o sistema. Use este contador para
          continuar a numeração a partir do sistema anterior — o próximo pedido sairá com <strong>lastNumber + 1</strong>.
        </p>

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-tower-700 dark:text-tower-200">Último número emitido</label>
            <input
              type="number"
              min={0}
              className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900"
              value={lastNumber}
              onChange={(e) => setLastNumber(Math.max(0, Number(e.target.value) || 0))}
            />
            <p className="mt-1 text-xs text-tower-500 dark:text-tower-400">
              Próximo pedido criado sairá com o número {lastNumber + 1}.
            </p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            Atenção: reduzir este valor abaixo de um número já emitido pode gerar duplicidade ou números fora de ordem.
          </div>

          {config && (
            <p className="text-xs text-tower-400">
              Última atualização: {new Date(config.updatedAt).toLocaleString('pt-BR')}
            </p>
          )}

          <button type="submit" disabled={saving} className="admin-focus rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
        <p className="text-sm font-semibold text-tower-700 dark:text-tower-200">Quem pode alterar o status do pedido manualmente</p>
        <p className="mt-1 text-xs text-tower-500 dark:text-tower-400">
          Vale para a troca manual de status do pedido. O Administrador sempre pode.
        </p>

        <form onSubmit={handleSaveRoles} className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-6">
            {MANUAL_STATUS_ROLES.map(({ role, label }) => (
              <label key={role} className="flex items-center gap-2 text-sm text-tower-800 dark:text-tower-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-tower-300 text-brand-600"
                  checked={role === 'ADMIN' || statusRoles.includes(role)}
                  disabled={role === 'ADMIN'}
                  onChange={(e) => setStatusRoles((prev) => (e.target.checked ? [...prev.filter((r) => r !== role), role] : prev.filter((r) => r !== role)))}
                />
                {label}
              </label>
            ))}
          </div>

          <button type="submit" disabled={savingRoles} className="admin-focus rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">
            {savingRoles ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default OrderNumberSettingsTab;
