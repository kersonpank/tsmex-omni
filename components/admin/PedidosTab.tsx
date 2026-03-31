import React, { useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ordersApi, hubsApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  IN_TRANSIT: 'Em trânsito',
  AT_HUB: 'No HUB',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

const PedidosTab: React.FC = () => {
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const hubId = (user as { hubId?: string })?.hubId ?? (user?.profile as { hub?: { hubId?: string } })?.hub?.hubId;

  const [orders, setOrders] = useState<any[]>([]);
  const [hubs, setHubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [chegouHubId, setChegouHubId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isHub) hubsApi.list().then((r: any) => setHubs((r?.data ?? r) || [])).catch(() => setHubs([]));
  }, [isHub]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ordersApi.list({ limit: 100, ...(statusFilter ? { status: statusFilter } : {}) });
      const data = (res as any)?.data ?? res;
      setOrders(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar pedidos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const handleStatusUpdate = async (orderId: string, newStatus: string, currentHubId?: string) => {
    setActionLoading(orderId);
    try {
      await ordersApi.updateStatus(orderId, {
        status: newStatus,
        ...(currentHubId && { currentHubId }),
        description: `Status atualizado para ${statusLabels[newStatus]}`,
      });
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao atualizar status');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">Pedidos</h2>
        <div className="flex gap-2 items-center">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button type="button" onClick={load} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Atualizar</button>
        </div>
      </div>
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-slate-400">Carregando...</div>
      ) : orders.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-12 text-center text-slate-500 dark:text-slate-400">Nenhum pedido.</div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">NF / Demanda</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">Origem → Destino</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">Status</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">HUB atual</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">Ações</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const trackingId = o.demand?.id ?? o.demandId ?? o.id;
                return (
                <tr key={o.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-200">{o.nfNumber || o.demand?.nfNumber || o.id.slice(0, 8)}</td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{o.demand?.origin ?? o.origemPrestacao ?? '-'} → {o.demand?.destination ?? o.fimPrestacao ?? '-'}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-600 dark:text-slate-200">
                      {statusLabels[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{o.currentHub?.name ?? o.currentHub?.code ?? '-'}</td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1 items-center">
                      {o.status === 'IN_TRANSIT' && (
                        isHub && hubId ? (
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => handleStatusUpdate(o.id, 'AT_HUB', hubId)}
                            className="px-2 py-1 text-xs bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50"
                          >
                            Chegou no hub
                          </button>
                        ) : !isHub && hubs.length > 0 ? (
                          <div className="flex gap-1 items-center">
                            <select
                              value={chegouHubId[o.id] ?? ''}
                              onChange={(e) => setChegouHubId((prev) => ({ ...prev, [o.id]: e.target.value }))}
                              className="text-xs border border-slate-300 dark:border-slate-600 rounded px-1 py-0.5 min-w-[120px] bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                            >
                              <option value="">Selecione hub</option>
                              {hubs.filter((h: any) => h.active !== false).map((h: any) => (
                                <option key={h.id} value={h.id}>{h.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!!actionLoading || !chegouHubId[o.id]}
                              onClick={() => handleStatusUpdate(o.id, 'AT_HUB', chegouHubId[o.id])}
                              className="px-2 py-1 text-xs bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50"
                            >
                              Chegou
                            </button>
                          </div>
                        ) : null
                      )}
                      {o.status === 'AT_HUB' && (
                        <button
                          type="button"
                          disabled={!!actionLoading}
                          onClick={() => handleStatusUpdate(o.id, 'OUT_FOR_DELIVERY')}
                          className="px-2 py-1 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
                        >
                          Saiu para entrega
                        </button>
                      )}
                      {o.status === 'OUT_FOR_DELIVERY' && (
                        <button
                          type="button"
                          disabled={!!actionLoading}
                          onClick={() => handleStatusUpdate(o.id, 'DELIVERED')}
                          className="px-2 py-1 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Entregue
                        </button>
                      )}
                      <RouterLink
                        to={`/tracking/${trackingId}`}
                        className="px-2 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline"
                      >
                        Ver tracking
                      </RouterLink>
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PedidosTab;
