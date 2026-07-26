// components/manifest/ManifestDetailPage.tsx
import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { manifestsApi } from '../../lib/api';
import type { Manifest } from '../../types/index';
import type { ResolvedOrderSummary } from '../../types/index';
import EmptyState from '../ui/EmptyState';
import ErrorPanel from '../ui/ErrorPanel';
import LoadingPanel from '../ui/LoadingPanel';
import InlineNotice from '../ui/InlineNotice';
import StatusBadge from '../ui/StatusBadge';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import OrderScanInput from '../ui/OrderScanInput';

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
};

type SectionKey = 'pedidos' | 'paradas' | 'capa' | 'motorista' | 'cartaFrete' | 'fiscal';

const ManifestDetailPage: React.FC = () => {
  const { id } = useParams();
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const isAdmin = user?.roles?.includes('ADMIN') ?? false;
  const backPath = isHub && !isAdmin ? '/hub' : '/gestao?cat=transport&sub=viagens';

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    pedidos: true,
    paradas: true,
    capa: false,
    motorista: false,
    cartaFrete: false,
    fiscal: false,
  });
  const [addingOrderId, setAddingOrderId] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await manifestsApi.getById(id);
      setManifest((res as any)?.data ?? null);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagem');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id]);

  const toggle = (section: SectionKey) => setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleOrderResolved = async (order: ResolvedOrderSummary) => {
    if (!id) return;
    setAddingOrderId(order.id);
    setError(null);
    try {
      await manifestsApi.addDemand(id, { orderId: order.id });
      flashSuccess(`Pedido #${order.id.slice(0, 8)} adicionado à viagem.`);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar pedido');
    } finally {
      setAddingOrderId(null);
    }
  };

  const handleRemoveDemand = async (demandId: string) => {
    if (!id || !window.confirm('Remover este pedido da viagem?')) return;
    setError(null);
    try {
      await manifestsApi.removeDemand(id, demandId);
      flashSuccess('Pedido removido.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const canEditOrders = manifest?.status === 'DRAFT';

  if (loading) return <LoadingPanel label="Carregando viagem…" />;
  if (error && !manifest) return <ErrorPanel message={error} onRetry={load} />;
  if (!manifest) return <EmptyState title="Viagem não encontrada" description="Não foi possível localizar esta viagem." />;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RouterLink
          to={backPath}
          className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          Voltar para viagens
        </RouterLink>
        <StatusBadge label={statusLabels[manifest.status] ?? manifest.status} tone={manifest.status === 'COMPLETED' ? 'success' : 'info'} />
        <span className="font-bold text-tower-900 dark:text-tower-50">{manifest.origin} → {manifest.destination}</span>
      </div>

      {error && <InlineNotice variant="error" message={error} onDismiss={() => setError(null)} />}
      {success && <InlineNotice variant="success" message={success} onDismiss={() => setSuccess(null)} />}

      <CollapsibleSection title="Pedidos" sectionKey="pedidos" expanded={expanded.pedidos} onToggle={() => toggle('pedidos')}>
        {canEditOrders && (
          <div className="mb-4">
            <OrderScanInput manifestId={id} onResolved={handleOrderResolved} disabled={addingOrderId !== null} />
          </div>
        )}
        {manifest.demands && manifest.demands.length > 0 ? (
          <ul className="space-y-1">
            {manifest.demands.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm border-b border-tower-100 dark:border-tower-800 py-2 last:border-0">
                <span>{d.origin} → {d.destination} · {d.commodity} · {d.weight}kg</span>
                {canEditOrders && (
                  <button type="button" onClick={() => handleRemoveDemand(d.id)} className="text-red-600 hover:underline">Remover</button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-tower-500 dark:text-tower-400">Nenhum pedido nesta viagem ainda.</p>
        )}
      </CollapsibleSection>
    </div>
  );
};

export default ManifestDetailPage;
