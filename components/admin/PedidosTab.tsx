import React, { useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ordersApi, hubsApi } from '../../lib/api';
import type { StatusTone } from '../../lib/demandStatusUi';
import { useAuthStore } from '../../store/authStore';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import ErrorPanel from '../ui/ErrorPanel';
import LoadingPanel from '../ui/LoadingPanel';
import StatusBadge from '../ui/StatusBadge';

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  IN_TRANSIT: 'Em trânsito',
  AT_HUB: 'No HUB',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

const orderStatusTones: Record<string, StatusTone> = {
  PENDING: 'warning',
  IN_TRANSIT: 'info',
  AT_HUB: 'info',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

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
  const [attachmentLoading, setAttachmentLoading] = useState<string | null>(null);
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

  const handleAttachmentUpload = async (orderId: string, file: File) => {
    setAttachmentLoading(orderId);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      await ordersApi.addAttachment(orderId, {
        file: base64,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        category: 'PEDIDOS_TAB',
      });
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao anexar arquivo');
    } finally {
      setAttachmentLoading(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-sm text-tower-600 dark:text-tower-400">Filtre por status e atualize a lista.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
          >
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            className="admin-focus rounded-xl border border-tower-200 px-4 py-2 text-sm font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
          >
            Atualizar
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorPanel message={error} onRetry={load} />
        </div>
      )}
      {loading ? (
        <LoadingPanel label="Carregando pedidos…" />
      ) : orders.length === 0 ? (
        <EmptyState title="Nenhum pedido" description="Não há pedidos com os filtros atuais." />
      ) : (
        <DataTable>
          <thead className="border-b border-tower-200 bg-tower-50/90 dark:border-tower-700 dark:bg-tower-800/80">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300">NF / Demanda</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300">Origem → Destino</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300">Status</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300">HUB atual</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300">Anexos</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-tower-100 dark:divide-tower-800">
            {orders.map((o) => {
              const trackingId = o.demand?.id ?? o.demandId ?? o.id;
              return (
                <tr key={o.id} className="hover:bg-tower-50/80 dark:hover:bg-tower-800/40">
                  <td className="px-4 py-3 font-mono-ids text-sm font-medium text-tower-900 dark:text-tower-100">
                    {o.nfNumber || o.demand?.nfNumber || o.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-200">
                    {o.demand?.origin ?? o.origemPrestacao ?? '-'} → {o.demand?.destination ?? o.fimPrestacao ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge label={statusLabels[o.status] ?? o.status} tone={orderStatusTones[o.status] ?? 'neutral'} />
                  </td>
                  <td className="px-4 py-3 text-sm text-tower-600 dark:text-tower-300">{o.currentHub?.name ?? o.currentHub?.code ?? '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-tower-500 dark:text-tower-400">
                        {(o.attachments?.length ?? 0)} arquivo(s)
                      </span>
                      {o.attachments?.[0]?.attachment?.downloadUrl ? (
                        <a
                          href={o.attachments[0].attachment.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand-600 dark:text-brand-300 hover:underline"
                        >
                          Ver último
                        </a>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {o.status === 'IN_TRANSIT' &&
                        (isHub && hubId ? (
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => handleStatusUpdate(o.id, 'AT_HUB', hubId)}
                            className="admin-focus rounded-lg bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-700 disabled:opacity-50"
                          >
                            Chegou no hub
                          </button>
                        ) : !isHub && hubs.length > 0 ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={chegouHubId[o.id] ?? ''}
                              onChange={(e) => setChegouHubId((prev) => ({ ...prev, [o.id]: e.target.value }))}
                              className="admin-focus min-w-[120px] rounded border border-tower-200 bg-white px-1 py-0.5 text-xs dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                            >
                              <option value="">Selecione hub</option>
                              {hubs.filter((h: { active?: boolean }) => h.active !== false).map((h: { id: string; name: string }) => (
                                <option key={h.id} value={h.id}>
                                  {h.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!!actionLoading || !chegouHubId[o.id]}
                              onClick={() => handleStatusUpdate(o.id, 'AT_HUB', chegouHubId[o.id])}
                              className="admin-focus rounded-lg bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-700 disabled:opacity-50"
                            >
                              Chegou
                            </button>
                          </div>
                        ) : null)}
                      {o.status === 'AT_HUB' && (
                        <button
                          type="button"
                          disabled={!!actionLoading}
                          onClick={() => handleStatusUpdate(o.id, 'OUT_FOR_DELIVERY')}
                          className="admin-focus rounded-lg bg-teal-600 px-2 py-1 text-xs text-white hover:bg-teal-700 disabled:opacity-50"
                        >
                          Saiu para entrega
                        </button>
                      )}
                      {o.status === 'OUT_FOR_DELIVERY' && (
                        <button
                          type="button"
                          disabled={!!actionLoading}
                          onClick={() => handleStatusUpdate(o.id, 'DELIVERED')}
                          className="admin-focus rounded-lg bg-brand-600 px-2 py-1 text-xs text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          Entregue
                        </button>
                      )}
                      <RouterLink
                        to={`/tracking/${trackingId}`}
                        className="admin-focus px-2 py-1 text-xs text-brand-600 hover:text-brand-500 dark:text-brand-300"
                      >
                        Ver tracking
                      </RouterLink>
                      <label className="admin-focus rounded-lg border border-tower-300 dark:border-tower-600 px-2 py-1 text-xs text-tower-700 dark:text-tower-200 cursor-pointer hover:bg-tower-100 dark:hover:bg-tower-800">
                        {attachmentLoading === o.id ? 'Enviando...' : 'Anexar'}
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleAttachmentUpload(o.id, file);
                            e.currentTarget.value = '';
                          }}
                          disabled={attachmentLoading === o.id}
                        />
                      </label>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </div>
  );
};

export default PedidosTab;
