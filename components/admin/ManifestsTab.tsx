import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { manifestsApi } from '../../lib/api';
import type { Manifest, ManifestTripType } from '../../types/index';
import EmptyState from '../ui/EmptyState';
import InlineNotice from '../ui/InlineNotice';
import LoadingPanel from '../ui/LoadingPanel';
import StatusBadge from '../ui/StatusBadge';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';
import { manifestStatusLabels as statusLabels, manifestStatusTone as manifestTone } from '../../lib/manifestStatusUi';

const tripTypeLabels: Record<ManifestTripType, string> = {
  TRANSFER: 'Transferência hub',
  DELIVERY: 'Entrega final',
  TRANSFER_DELIVERY: 'Transferência + entrega',
  REGIONAL_DISTRIBUTION: 'Distribuição regional',
};

const ManifestsTab: React.FC = () => {
  const navigate = useNavigate();
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterQ, setFilterQ] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const manRes = await manifestsApi.list({});
      setManifests(Array.isArray((manRes as any)?.data) ? (manRes as any).data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagens');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filteredManifests = useMemo(() => {
    let list = manifests;
    if (filterStatus) list = list.filter((m) => m.status === filterStatus);
    const q = filterQ.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => {
        const o = `${m.origin ?? ''} ${m.destination ?? ''} ${m.id}`.toLowerCase();
        return o.includes(q);
      });
    }
    return list;
  }, [manifests, filterStatus, filterQ]);

  const manifestGestao = useMemo(
    () => ({
      listActive: !gestaoFilterOpen,
      filterOpen: gestaoFilterOpen,
      filterCount: (filterStatus ? 1 : 0) + (filterQ.trim() ? 1 : 0),
      pills: [
        ...(filterStatus
          ? [{ id: 'st', label: `Status: ${statusLabels[filterStatus] ?? filterStatus}`, onRemove: () => setFilterStatus('') }]
          : []),
        ...(filterQ.trim()
          ? [{ id: 'q', label: `Busca: ${filterQ.trim()}`, onRemove: () => setFilterQ('') }]
          : []),
      ],
      onList: () => {
        setGestaoFilterOpen(false);
        void load();
        document.getElementById('manifests-lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      onNew: () => navigate('/manifests/new'),
      prominentNew: true,
      disabled: { new: false } as const,
      labels: { new: 'Nova viagem' },
    }),
    [gestaoFilterOpen, filterStatus, filterQ, navigate]
  );

  useRegisterGestaoModuleActions(() => manifestGestao, [manifestGestao]);

  return (
    <div>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-sm text-tower-600 dark:text-tower-400">Crie a viagem pelo fluxo guiado, consolide pedidos e acompanhe todo o ciclo operacional.</p>
      </div>

      {gestaoFilterOpen && (
        <div className="mb-4 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="man-st">
                Status
              </label>
              <select
                id="man-st"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-lg border border-tower-200 dark:border-tower-600 px-3 py-2 text-sm bg-white dark:bg-tower-900 text-tower-900 dark:text-tower-100 focus:outline-none"
              >
                <option value="">Todos</option>
                {Object.keys(statusLabels).map((k) => (
                  <option key={k} value={k}>
                    {statusLabels[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="man-q">
                Busca
              </label>
              <input
                id="man-q"
                type="search"
                value={filterQ}
                onChange={(e) => setFilterQ(e.target.value)}
                className="w-full rounded-lg border border-tower-200 dark:border-tower-600 px-3 py-2 text-sm bg-white dark:bg-tower-900 text-tower-900 dark:text-tower-100 focus:outline-none"
                placeholder="Origem, destino ou ID…"
              />
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <InlineNotice variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {loading ? (
        <LoadingPanel label="Carregando viagens…" />
      ) : manifests.length === 0 ? (
        <EmptyState title="Nenhuma viagem" description="Crie uma nova viagem para começar a consolidar demandas." />
      ) : filteredManifests.length === 0 ? (
        <EmptyState title="Nenhuma viagem neste filtro" description="Ajuste os filtros ou limpe a busca." />
      ) : (
        <div id="manifests-lista" className="space-y-4">
          {filteredManifests.map((m) => (
            <RouterLink
              key={m.id}
              to={`/manifests/${m.id}`}
              className="block rounded-xl border border-tower-200 bg-white/95 p-5 shadow-sm transition-shadow hover:border-brand-300 dark:border-tower-700 dark:bg-tower-900/80"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-ids text-[10px] font-bold text-tower-400">#{m.id.slice(0, 8)}</span>
                  {m.tripType && (
                    <StatusBadge label={tripTypeLabels[m.tripType] ?? m.tripType} tone={m.tripType === 'DELIVERY' ? 'success' : 'info'} />
                  )}
                  <StatusBadge label={statusLabels[m.status] ?? m.status} tone={manifestTone[m.status] ?? 'neutral'} />
                  <span className="font-bold text-tower-900 dark:text-tower-50">{m.origin} → {m.destination}</span>
                  {m.vehicleType && <span className="text-sm text-tower-500">({m.vehicleType.name})</span>}
                  {m.link && <span className="text-sm text-tower-600 dark:text-tower-300">· Responsável: {m.link.name}</span>}
                </div>
                <span className="text-sm font-semibold text-brand-600 dark:text-brand-400">Ver detalhes →</span>
              </div>
              <div className="mt-2 text-xs text-tower-500 dark:text-tower-400">
                {(m.demands?.length ?? 0)} pedido(s){(m.tripStops?.length ?? 0) > 0 ? ` · ${m.tripStops!.length} parada(s)` : ''}
              </div>
            </RouterLink>
          ))}
        </div>
      )}
    </div>
  );
};

export default ManifestsTab;
