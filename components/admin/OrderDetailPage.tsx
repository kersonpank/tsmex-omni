import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { ordersApi } from '../../lib/api';
import EmptyState from '../ui/EmptyState';
import ErrorPanel from '../ui/ErrorPanel';
import LoadingPanel from '../ui/LoadingPanel';
import StatusBadge from '../ui/StatusBadge';
import type { StatusTone } from '../../lib/demandStatusUi';

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

const OrderDetailPage: React.FC = () => {
  const { id } = useParams();
  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await ordersApi.getById(id);
      setOrder((response as any)?.data ?? response);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao carregar pedido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  if (loading) return <LoadingPanel label="Carregando pedido..." />;
  if (error) return <ErrorPanel message={error} onRetry={load} />;
  if (!order) return <EmptyState title="Pedido não encontrado" description="Não foi possível localizar o pedido solicitado." />;

  const demandStatus = order.demand?.status ?? '-';

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RouterLink
          to="/gestao?category=transport&transportSubTab=pedidos"
          className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          Voltar para pedidos
        </RouterLink>
        <RouterLink
          to={`/tracking/${order.demand?.id ?? order.demandId ?? order.id}`}
          className="admin-focus rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-900/40"
        >
          Ver tracking
        </RouterLink>
      </div>

      <div className="rounded-2xl border border-tower-200 bg-white p-5 dark:border-tower-700 dark:bg-tower-900/50">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100">Pedido {order.nfNumber ?? order.demand?.nfNumber ?? order.id.slice(0, 8)}</h1>
            <p className="text-sm text-tower-600 dark:text-tower-300">
              Cliente: {order.demand?.client?.companyName ?? 'Não informado'}
            </p>
          </div>
          <StatusBadge label={statusLabels[order.status] ?? order.status} tone={orderStatusTones[order.status] ?? 'neutral'} />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Origem rota</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">{order.demand?.origin ?? order.origemPrestacao ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Destino rota</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">{order.demand?.destination ?? order.fimPrestacao ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Status da demanda</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">{demandStatus}</p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Hub atual</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">{order.currentHub?.name ?? order.currentHub?.code ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Remetente</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">
              {order.remetentePerson?.legalName ?? '-'}
              <span className="block text-xs text-tower-500 dark:text-tower-400">
                {(order.remetentePerson?.city ?? '-') + ' / ' + (order.remetentePerson?.state ?? '-')}
              </span>
            </p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Destinatário</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">
              {order.destinatarioPerson?.legalName ?? '-'}
              <span className="block text-xs text-tower-500 dark:text-tower-400">
                {(order.destinatarioPerson?.city ?? '-') + ' / ' + (order.destinatarioPerson?.state ?? '-')}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderDetailPage;
