import React, { useEffect, useMemo, useState } from 'react';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { ordersApi, hubsApi } from '../../lib/api';
import type { StatusTone } from '../../lib/demandStatusUi';
import type { OrderListItem, OrderStatus, PaginatedResponse } from '../../types/index';
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

const PAGE_SIZE = 20;
const FILTERS_STORAGE_KEY = 'pedidos-tab-filters-v2';

type CollectionFilterValue = '' | 'COLLECTED' | 'NOT_COLLECTED' | 'WITH_COLLECTION_DATA' | 'WITHOUT_COLLECTION_DATA' | 'INCONSISTENT';

type PedidosFilters = {
  q: string;
  status: string;
  hubId: string;
  collectionStatus: CollectionFilterValue;
  originState: string;
  originCity: string;
  destinationState: string;
  destinationCity: string;
  senderState: string;
  senderCity: string;
  recipientState: string;
  recipientCity: string;
};

type SortDirection = 'asc' | 'desc';
type SortKey =
  | 'updatedAt'
  | 'status'
  | 'nfNumber'
  | 'currentHubName'
  | 'origin'
  | 'destination'
  | 'senderCity'
  | 'recipientCity'
  | 'coleta'
  | 'anexos';

const defaultFilters: PedidosFilters = {
  q: '',
  status: '',
  hubId: '',
  collectionStatus: '',
  originState: '',
  originCity: '',
  destinationState: '',
  destinationCity: '',
  senderState: '',
  senderCity: '',
  recipientState: '',
  recipientCity: '',
};

const SERVER_SORT_KEYS: Exclude<SortKey, 'coleta' | 'anexos'>[] = [
  'updatedAt',
  'status',
  'nfNumber',
  'currentHubName',
  'origin',
  'destination',
  'senderCity',
  'recipientCity',
];

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const parseRouteCityState = (value?: string | null): { city: string; state: string } => {
  if (!value) return { city: '-', state: '-' };
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts[0], state: parts[parts.length - 1].toUpperCase() };
  }
  return { city: value, state: '-' };
};

const getCollectionLabel = (order: OrderListItem): { label: string; tone: StatusTone } => {
  const demandStatus = order.demand?.status ?? '';
  const hasCollectionData = !!order.collectionData && Object.keys(order.collectionData).length > 0;
  const isCollected = demandStatus === 'COLLECTED';
  if (isCollected && hasCollectionData) return { label: 'Coletado', tone: 'success' };
  if (isCollected && !hasCollectionData) return { label: 'Coleta inconsistente', tone: 'danger' };
  if (!isCollected && hasCollectionData) return { label: 'Coleta pendente', tone: 'warning' };
  return { label: 'Sem coleta', tone: 'neutral' };
};

const PedidosTab: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const hubId = (user as { hubId?: string })?.hubId ?? (user?.profile as { hub?: { hubId?: string } })?.hub?.hubId;

  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [hubs, setHubs] = useState<any[]>([]);
  const [filters, setFilters] = useState<PedidosFilters>(() => {
    if (typeof window === 'undefined') return defaultFilters;
    try {
      const raw = window.sessionStorage.getItem(FILTERS_STORAGE_KEY);
      if (!raw) return defaultFilters;
      return { ...defaultFilters, ...(JSON.parse(raw) as Partial<PedidosFilters>) };
    } catch {
      return defaultFilters;
    }
  });
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [toolbarSelOrderId, setToolbarSelOrderId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState<string | null>(null);
  const [chegouHubId, setChegouHubId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    if (!isHub) hubsApi.list().then((r: any) => setHubs((r?.data ?? r) || [])).catch(() => setHubs([]));
  }, [isHub]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.hubId ? { hubId: filters.hubId } : {}),
        ...(filters.collectionStatus ? { collectionStatus: filters.collectionStatus } : {}),
        ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
        ...(filters.originState ? { originState: filters.originState } : {}),
        ...(filters.originCity.trim() ? { originCity: filters.originCity.trim() } : {}),
        ...(filters.destinationState ? { destinationState: filters.destinationState } : {}),
        ...(filters.destinationCity.trim() ? { destinationCity: filters.destinationCity.trim() } : {}),
        ...(filters.senderState ? { senderState: filters.senderState } : {}),
        ...(filters.senderCity.trim() ? { senderCity: filters.senderCity.trim() } : {}),
        ...(filters.recipientState ? { recipientState: filters.recipientState } : {}),
        ...(filters.recipientCity.trim() ? { recipientCity: filters.recipientCity.trim() } : {}),
        ...(SERVER_SORT_KEYS.includes(sortBy as any) ? { sortBy, sortDir } : { sortBy: 'updatedAt', sortDir: 'desc' }),
      };
      const res = (await ordersApi.list(query)) as PaginatedResponse<OrderListItem>;
      const data = Array.isArray(res?.data) ? res.data : [];
      setOrders(data);
      setTotal(res?.pagination?.total ?? data.length);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar pedidos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [page, filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((prev) => ({ ...prev, q: searchDraft }));
      setPage(0);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const setFilter = <K extends keyof PedidosFilters>(key: K, value: PedidosFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  };

  const handleStatusUpdate = async (orderId: string, newStatus: OrderStatus, currentHubId?: string) => {
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

  const clearFilters = () => {
    setFilters(defaultFilters);
    setSearchDraft('');
    setPage(0);
  };

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: keyof PedidosFilters; label: string }> = [];
    if (filters.status) chips.push({ key: 'status', label: `Status: ${statusLabels[filters.status] ?? filters.status}` });
    if (filters.hubId) {
      const hub = hubs.find((h) => h.id === filters.hubId);
      chips.push({ key: 'hubId', label: `Hub: ${hub?.name ?? 'Selecionado'}` });
    }
    if (filters.collectionStatus) chips.push({ key: 'collectionStatus', label: `Coleta: ${filters.collectionStatus}` });
    if (filters.q.trim()) chips.push({ key: 'q', label: `Busca: ${filters.q.trim()}` });
    if (filters.originState) chips.push({ key: 'originState', label: `Origem UF: ${filters.originState}` });
    if (filters.originCity.trim()) chips.push({ key: 'originCity', label: `Origem cidade: ${filters.originCity.trim()}` });
    if (filters.destinationState) chips.push({ key: 'destinationState', label: `Destino UF: ${filters.destinationState}` });
    if (filters.destinationCity.trim()) chips.push({ key: 'destinationCity', label: `Destino cidade: ${filters.destinationCity.trim()}` });
    if (filters.senderState) chips.push({ key: 'senderState', label: `Remetente UF: ${filters.senderState}` });
    if (filters.senderCity.trim()) chips.push({ key: 'senderCity', label: `Remetente cidade: ${filters.senderCity.trim()}` });
    if (filters.recipientState) chips.push({ key: 'recipientState', label: `Destinatário UF: ${filters.recipientState}` });
    if (filters.recipientCity.trim()) chips.push({ key: 'recipientCity', label: `Destinatário cidade: ${filters.recipientCity.trim()}` });
    return chips;
  }, [filters, hubs]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sortedOrders = useMemo(() => {
    if (sortBy !== 'coleta' && sortBy !== 'anexos') return orders;
    const dirFactor = sortDir === 'asc' ? 1 : -1;
    const copy = [...orders];
    copy.sort((a, b) => {
      if (sortBy === 'anexos') {
        const av = a.attachments?.length ?? 0;
        const bv = b.attachments?.length ?? 0;
        return (av - bv) * dirFactor;
      }
      const aCollection = getCollectionLabel(a).label;
      const bCollection = getCollectionLabel(b).label;
      return aCollection.localeCompare(bCollection, 'pt-BR') * dirFactor;
    });
    return copy;
  }, [orders, sortBy, sortDir]);

  const handleSortClick = (key: SortKey) => {
    setPage(0);
    if (sortBy === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(key);
    setSortDir('asc');
  };

  const sortIndicator = (key: SortKey) => {
    if (sortBy !== key) return '↕';
    return sortDir === 'asc' ? '↑' : '↓';
  };

  const pedidosGestao = useMemo(
    () => ({
      listActive: !showAdvancedFilters,
      filterOpen: showAdvancedFilters,
      filterCount: activeFilterChips.length,
      pills: activeFilterChips.map((c) => ({
        id: String(c.key),
        label: c.label,
        onRemove: () => {
          setFilter(c.key, defaultFilters[c.key]);
        },
      })),
      onList: () => {
        setShowAdvancedFilters(false);
        void load();
        document.getElementById('pedidos-tabela-topo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setShowAdvancedFilters((v) => !v),
      onEdit: toolbarSelOrderId
        ? () =>
            navigate(`/orders/${toolbarSelOrderId}`, {
              state: { fromPedidos: true, backSearch: window.location.hash },
            })
        : undefined,
      disabled: {
        edit: !toolbarSelOrderId,
        new: true,
      } as const,
      labels: {
        new: 'Novo pedido: use Entrada ou fluxos de demanda.',
        edit: toolbarSelOrderId ? 'Abrir pedido selecionado na tabela' : 'Clique em uma linha da tabela para selecionar o pedido',
      },
    }),
    [showAdvancedFilters, activeFilterChips, toolbarSelOrderId, navigate]
  );

  useRegisterGestaoModuleActions(() => pedidosGestao, [pedidosGestao]);

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-tower-200 bg-white p-4 dark:border-tower-700 dark:bg-tower-900/40">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Buscar NF, cliente, cidade, pedido..."
            className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100 lg:col-span-2"
          />
          <select
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
          >
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={filters.hubId}
            disabled={isHub}
            onChange={(e) => setFilter('hubId', e.target.value)}
            className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm text-tower-900 disabled:opacity-60 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
          >
            <option value="">{isHub ? 'Hub atual' : 'Todos os hubs'}</option>
            {hubs.filter((h: { active?: boolean }) => h.active !== false).map((h: { id: string; name: string }) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          <select
            value={filters.collectionStatus}
            onChange={(e) => setFilter('collectionStatus', e.target.value as CollectionFilterValue)}
            className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
          >
            <option value="">Coleta (todos)</option>
            <option value="COLLECTED">Coletado</option>
            <option value="NOT_COLLECTED">Não coletado</option>
            <option value="WITH_COLLECTION_DATA">Com dados de coleta</option>
            <option value="WITHOUT_COLLECTION_DATA">Sem dados de coleta</option>
            <option value="INCONSISTENT">Inconsistente</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdvancedFilters((v) => !v)}
            className="admin-focus rounded-xl border border-tower-200 px-3 py-2 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
          >
            {showAdvancedFilters ? 'Ocultar filtros avançados' : 'Mostrar filtros avançados'}
          </button>
          <button
            type="button"
            onClick={load}
            className="admin-focus rounded-xl border border-tower-200 px-4 py-2 text-sm font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
          >
            Atualizar
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="admin-focus rounded-xl border border-tower-200 px-3 py-2 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
          >
            Limpar filtros
          </button>
          <p className="ml-auto text-xs text-tower-500 dark:text-tower-400">
            {total} pedido(s) encontrado(s)
          </p>
        </div>

        {showAdvancedFilters ? (
          <div className="mt-3 grid gap-3 border-t border-tower-100 pt-3 md:grid-cols-2 lg:grid-cols-4 dark:border-tower-700">
            <input value={filters.originCity} onChange={(e) => setFilter('originCity', e.target.value)} placeholder="Cidade origem (rota)" className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
            <input value={filters.originState} onChange={(e) => setFilter('originState', e.target.value.toUpperCase())} placeholder="UF origem (rota)" maxLength={2} className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm uppercase dark:border-tower-600 dark:bg-tower-800" />
            <input value={filters.destinationCity} onChange={(e) => setFilter('destinationCity', e.target.value)} placeholder="Cidade destino (rota)" className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
            <input value={filters.destinationState} onChange={(e) => setFilter('destinationState', e.target.value.toUpperCase())} placeholder="UF destino (rota)" maxLength={2} className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm uppercase dark:border-tower-600 dark:bg-tower-800" />
            <input value={filters.senderCity} onChange={(e) => setFilter('senderCity', e.target.value)} placeholder="Cidade remetente" className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
            <input value={filters.senderState} onChange={(e) => setFilter('senderState', e.target.value.toUpperCase())} placeholder="UF remetente" maxLength={2} className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm uppercase dark:border-tower-600 dark:bg-tower-800" />
            <input value={filters.recipientCity} onChange={(e) => setFilter('recipientCity', e.target.value)} placeholder="Cidade destinatário" className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
            <input value={filters.recipientState} onChange={(e) => setFilter('recipientState', e.target.value.toUpperCase())} placeholder="UF destinatário" maxLength={2} className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm uppercase dark:border-tower-600 dark:bg-tower-800" />
          </div>
        ) : null}

        {activeFilterChips.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key, defaultFilters[chip.key])}
                className="admin-focus rounded-full border border-tower-300 px-3 py-1 text-xs text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
              >
                {chip.label} ×
              </button>
            ))}
          </div>
        ) : null}
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
        <DataTable id="pedidos-tabela-topo">
          <thead className="border-b border-tower-200 bg-tower-50/90 dark:border-tower-700 dark:bg-tower-800/80">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300"><button type="button" onClick={() => handleSortClick('nfNumber')} className="admin-focus inline-flex items-center gap-1">Pedido/NF <span>{sortIndicator('nfNumber')}</span></button></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300"><button type="button" onClick={() => handleSortClick('status')} className="admin-focus inline-flex items-center gap-1">Status <span>{sortIndicator('status')}</span></button></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300"><button type="button" onClick={() => handleSortClick('coleta')} className="admin-focus inline-flex items-center gap-1">Coleta <span>{sortIndicator('coleta')}</span></button></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300"><button type="button" onClick={() => handleSortClick('currentHubName')} className="admin-focus inline-flex items-center gap-1">HUB atual <span>{sortIndicator('currentHubName')}</span></button></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300"><button type="button" onClick={() => handleSortClick('origin')} className="admin-focus inline-flex items-center gap-1">Origem (rota) <span>{sortIndicator('origin')}</span></button></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300"><button type="button" onClick={() => handleSortClick('destination')} className="admin-focus inline-flex items-center gap-1">Destino (rota) <span>{sortIndicator('destination')}</span></button></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300"><button type="button" onClick={() => handleSortClick('senderCity')} className="admin-focus inline-flex items-center gap-1">Remetente <span>{sortIndicator('senderCity')}</span></button></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300"><button type="button" onClick={() => handleSortClick('recipientCity')} className="admin-focus inline-flex items-center gap-1">Destinatário <span>{sortIndicator('recipientCity')}</span></button></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300"><button type="button" onClick={() => handleSortClick('anexos')} className="admin-focus inline-flex items-center gap-1">Anexos <span>{sortIndicator('anexos')}</span></button></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-tower-100 dark:divide-tower-800">
            {sortedOrders.map((o) => {
              const trackingId = o.demand?.id ?? o.demandId ?? o.id;
              const origin = parseRouteCityState(o.demand?.origin ?? o.origemPrestacao);
              const destination = parseRouteCityState(o.demand?.destination ?? o.fimPrestacao);
              const senderCity = o.remetentePerson?.city ?? '-';
              const senderState = o.remetentePerson?.state ?? '-';
              const recipientCity = o.destinatarioPerson?.city ?? '-';
              const recipientState = o.destinatarioPerson?.state ?? '-';
              const collection = getCollectionLabel(o);
              return (
                <tr
                  key={o.id}
                  className={`cursor-pointer hover:bg-tower-50/80 dark:hover:bg-tower-800/40 ${
                    toolbarSelOrderId === o.id ? 'bg-brand-50/80 dark:bg-brand-950/25' : ''
                  }`}
                  onClick={() => {
                    setToolbarSelOrderId(o.id);
                    navigate(`/orders/${o.id}`, { state: { fromPedidos: true, backSearch: window.location.hash } });
                  }}
                >
                  <td className="px-4 py-3 font-mono-ids text-sm font-medium text-tower-900 dark:text-tower-100">
                    <div className="flex flex-col">
                      <span>{o.nfNumber || o.demand?.nfNumber || o.id.slice(0, 8)}</span>
                      <span className="font-sans text-xs text-tower-500 dark:text-tower-400">
                        {o.demand?.client?.companyName ?? 'Sem cliente'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge label={statusLabels[o.status] ?? o.status} tone={orderStatusTones[o.status] ?? 'neutral'} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge label={collection.label} tone={collection.tone} />
                  </td>
                  <td className="px-4 py-3 text-sm text-tower-600 dark:text-tower-300">{o.currentHub?.name ?? o.currentHub?.code ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-200">{origin.city} / {origin.state}</td>
                  <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-200">{destination.city} / {destination.state}</td>
                  <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-200">{senderCity} / {senderState}</td>
                  <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-200">{recipientCity} / {recipientState}</td>
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
                    <div className="flex flex-wrap items-center gap-1" onClick={(event) => event.stopPropagation()}>
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
                      <RouterLink to={`/orders/${o.id}`} state={{ fromPedidos: true, backSearch: window.location.hash }} className="admin-focus px-2 py-1 text-xs font-semibold text-brand-700 hover:text-brand-500 dark:text-brand-300">
                        Abrir pedido
                      </RouterLink>
                      <RouterLink to={`/tracking/${trackingId}`} className="admin-focus px-2 py-1 text-xs text-brand-600 hover:text-brand-500 dark:text-brand-300">
                        Tracking
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

      {!loading ? (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-tower-500 dark:text-tower-400">
            Página {page + 1} de {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0}
              className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 disabled:opacity-50 dark:border-tower-600 dark:text-tower-200"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages}
              className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 disabled:opacity-50 dark:border-tower-600 dark:text-tower-200"
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PedidosTab;
