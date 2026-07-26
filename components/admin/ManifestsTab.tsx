import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { manifestsApi, vehicleTypesApi, hubsApi } from '../../lib/api';
import type { Manifest, ManifestTripType, VehicleType, Hub } from '../../types/index';
import type { StatusTone } from '../../lib/demandStatusUi';
import EmptyState from '../ui/EmptyState';
import InlineNotice from '../ui/InlineNotice';
import LoadingPanel from '../ui/LoadingPanel';
import StatusBadge from '../ui/StatusBadge';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
};

const tripTypeLabels: Record<ManifestTripType, string> = {
  TRANSFER: 'Transferência hub',
  DELIVERY: 'Entrega final',
  REGIONAL_DISTRIBUTION: 'Distribuição regional',
};

const manifestTone: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_ACCEPT: 'warning',
  ACCEPTED: 'info',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  REJECTED: 'danger',
};

const ManifestsTab: React.FC = () => {
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    vehicleTypeId: '',
    origin: '',
    destination: '',
    hubId: '',
    tripType: 'TRANSFER' as 'TRANSFER' | 'DELIVERY',
    destHubId: '',
  });
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterQ, setFilterQ] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [manRes, vtRes, hubRes] = await Promise.all([
        manifestsApi.list({}),
        vehicleTypesApi.list(),
        hubsApi.list(),
      ]);
      setManifests(Array.isArray((manRes as any)?.data) ? (manRes as any).data : []);
      setVehicleTypes(Array.isArray((vtRes as any)?.data) ? (vtRes as any).data : []);
      setHubs(Array.isArray((hubRes as any)?.data) ? (hubRes as any).data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagens');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.vehicleTypeId || !createForm.origin.trim() || !createForm.destination.trim()) {
      setError('Preencha tipo de veículo, origem e destino.');
      return;
    }
    if (createForm.tripType === 'TRANSFER') {
      if (!createForm.destHubId) {
        setError('Selecione o hub destino para transferência entre hubs.');
        return;
      }
      if (createForm.hubId && createForm.destHubId === createForm.hubId) {
        setError('Hub destino não pode ser igual ao hub de origem.');
        return;
      }
    }
    setError(null);
    try {
      await manifestsApi.create({
        vehicleTypeId: createForm.vehicleTypeId,
        origin: createForm.origin,
        destination: createForm.destination,
        tripType: createForm.tripType,
        hubId: createForm.hubId || undefined,
        destHubId: createForm.tripType === 'TRANSFER' ? createForm.destHubId : undefined,
      });
      setSuccess('Viagem criada.');
      setShowCreate(false);
      setCreateForm({
        vehicleTypeId: '',
        origin: '',
        destination: '',
        hubId: '',
        tripType: 'TRANSFER',
        destHubId: '',
      });
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao criar viagem');
    }
  };

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
      listActive: !showCreate && !gestaoFilterOpen,
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
        setShowCreate(false);
        void load();
        document.getElementById('manifests-lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      onNew: isHub ? undefined : () => setShowCreate(true),
      disabled: { new: isHub } as const,
      labels: { new: isHub ? 'Novas viagens são criadas pela central.' : 'Nova viagem' },
    }),
    [showCreate, gestaoFilterOpen, filterStatus, filterQ, isHub]
  );

  useRegisterGestaoModuleActions(() => manifestGestao, [manifestGestao]);

  return (
    <div>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-sm text-tower-600 dark:text-tower-400">Consolide demandas, atribua motorista e acompanhe o ciclo da viagem.</p>
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
      {success && (
        <div className="mb-4">
          <InlineNotice variant="success" message={success} onDismiss={() => setSuccess(null)} />
        </div>
      )}

      {showCreate && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-6 shadow-sm dark:shadow-none">
          <h3 className="text-base font-bold text-tower-800 dark:text-tower-100 mb-4">Nova viagem</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de viagem</label>
              <select
                value={createForm.tripType}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    tripType: e.target.value as 'TRANSFER' | 'DELIVERY',
                    destHubId: e.target.value === 'DELIVERY' ? '' : f.destHubId,
                  }))
                }
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              >
                <option value="TRANSFER">Transferência entre hubs</option>
                <option value="DELIVERY">Entrega final</option>
              </select>
            </div>
            {createForm.tripType === 'TRANSFER' && (
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Hub destino</label>
                <select
                  value={createForm.destHubId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, destHubId: e.target.value }))}
                  className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                  required
                >
                  <option value="">Selecione</option>
                  {hubs
                    .filter((h) => h.id !== createForm.hubId)
                    .map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.code})
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de veículo</label>
              <select
                value={createForm.vehicleTypeId}
                onChange={(e) => setCreateForm((f) => ({ ...f, vehicleTypeId: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                required
              >
                <option value="">Selecione</option>
                {vehicleTypes.filter((vt) => vt.active).map((vt) => (
                  <option key={vt.id} value={vt.id}>{vt.name} ({vt.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Hub origem (opcional)</label>
              <select
                value={createForm.hubId}
                onChange={(e) => setCreateForm((f) => ({ ...f, hubId: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              >
                <option value="">Nenhum</option>
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Origem</label>
              <CityAutocomplete
                value={createForm.origin}
                onChange={(v) => setCreateForm((f) => ({ ...f, origin: v }))}
                placeholder="Ex: São Paulo, SP"
                required
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Destino</label>
              <CityAutocomplete
                value={createForm.destination}
                onChange={(v) => setCreateForm((f) => ({ ...f, destination: v }))}
                placeholder="Ex: Imperatriz, MA"
                required
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Criar</button>
              <button type="button" onClick={() => { setShowCreate(false); setError(null); }} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Cancelar</button>
            </div>
          </form>
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
                  {m.link && <span className="text-sm text-tower-600 dark:text-tower-300">· Motorista: {m.link.name}</span>}
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
