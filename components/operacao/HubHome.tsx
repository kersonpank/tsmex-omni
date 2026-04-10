import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { ordersApi, manifestsApi, linksApi, vehicleTypesApi } from '../../lib/api';
import type { Manifest, Link, VehicleType } from '../../types/index';
import BottomNav, { type BottomNavItem } from './BottomNav';
import EntradaTab from '../admin/EntradaTab';

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = 'inicio' | 'entrada' | 'pedidos' | 'manifestos';

interface Order {
  id: string;
  status: string;
  nfNumber?: string;
  demand?: {
    id?: string;
    nfNumber?: string;
    origin?: string;
    destination?: string;
    commodity?: string;
    weight?: number;
    volume?: number;
  };
  [key: string]: any;
}

// ── Constants ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  AT_HUB: 'No Hub',
  IN_TRANSIT: 'Em trânsito',
  OUT_FOR_DELIVERY: 'Saiu p/ entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  AT_HUB: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  IN_TRANSIT: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  OUT_FOR_DELIVERY: 'bg-purple-100 text-purple-700',
  DELIVERED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  CANCELLED: 'bg-red-100 text-red-700',
};

const MANIFEST_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Ag. aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
};

const MANIFEST_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PENDING_ACCEPT: 'bg-amber-100 text-amber-700',
  ACCEPTED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-indigo-100 text-indigo-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const ACTIVE_MANIFEST_STATUSES = ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'];

// ── Icons ─────────────────────────────────────────────────────────────────

const IconHome = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.75L12 3l9 6.75V21a.75.75 0 01-.75.75H15.75a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H3.75A.75.75 0 013 21V9.75z" />
  </svg>
);

const IconPlus = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const IconClipboard = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
);

const IconTruck = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
  </svg>
);

const IconX = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const IconRefresh = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────

function getOrderDestination(order: Order): string {
  return order.demand?.destination ?? order.destination ?? 'Destino desconhecido';
}

function getOrderNf(order: Order): string {
  return order.nfNumber ?? order.demand?.nfNumber ?? '—';
}

function extractArray(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.data)) return res.data;
  return [];
}

// ── Manifest Modal ─────────────────────────────────────────────────────────

interface ManifestModalProps {
  selectedOrders: Order[];
  links: Link[];
  vehicleTypes: VehicleType[];
  onClose: () => void;
  onCreated: () => void;
}

const ManifestModal: React.FC<ManifestModalProps> = ({
  selectedOrders,
  links,
  vehicleTypes,
  onClose,
  onCreated,
}) => {
  const [linkId, setLinkId] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [notes, setNotes] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive origin/destination from selected orders
  const origin =
    selectedOrders[0]?.demand?.origin ?? selectedOrders[0]?.origin ?? '';
  const destinations = [
    ...new Set(selectedOrders.map((o) => getOrderDestination(o))),
  ];
  const destination = destinations.join(', ');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkId || !vehicleTypeId) {
      setError('Selecione um motorista e um tipo de veículo.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const demandIds = selectedOrders
        .map((o) => o.demand?.id ?? o.demandId ?? o.id)
        .filter(Boolean) as string[];

      await manifestsApi.create({
        vehicleTypeId,
        origin,
        destination,
        demandIds,
        linkId,
        ...(scheduledDate ? { scheduledDate } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      } as any);

      onCreated();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao criar manifesto');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-white dark:bg-slate-900 rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Criar Manifesto ({selectedOrders.length} pedido{selectedOrders.length !== 1 ? 's' : ''})
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <IconX />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
          )}

          {/* Orders summary */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 space-y-1">
            {selectedOrders.map((o) => (
              <div key={o.id} className="text-xs text-slate-600 dark:text-slate-300">
                NF {getOrderNf(o)} → {getOrderDestination(o)}
              </div>
            ))}
          </div>

          {/* Route */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Origem</label>
              <input
                type="text"
                value={origin}
                readOnly
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Destino</label>
              <input
                type="text"
                value={destination}
                readOnly
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-slate-50"
              />
            </div>
          </div>

          {/* Link */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Motorista (Link) *</label>
            <select
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              required
            >
              <option value="">Selecione o motorista</option>
              {links.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {l.vehiclePlate}
                </option>
              ))}
            </select>
          </div>

          {/* Vehicle Type */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de veículo *</label>
            <select
              value={vehicleTypeId}
              onChange={(e) => setVehicleTypeId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              required
            >
              <option value="">Selecione o veículo</option>
              {vehicleTypes.map((vt) => (
                <option key={vt.id} value={vt.id}>
                  {vt.name} — {vt.maxWeight}kg / {vt.maxVolume}m³
                </option>
              ))}
            </select>
          </div>

          {/* Scheduled date */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Data prevista de saída</label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="Observações sobre o manifesto..."
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Criando manifesto...' : 'Criar Manifesto'}
          </button>
        </form>
      </div>
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────

const HubHome: React.FC = () => {
  const { user, logout } = useAuthStore();

  const [tab, setTab] = useState<Tab>('inicio');
  const [orders, setOrders] = useState<Order[]>([]);
  const [manifestos, setManifestos] = useState<Manifest[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ordersRes, manifestsRes, linksRes, vtRes] = await Promise.all([
        ordersApi.list({ limit: 200 }),
        manifestsApi.list({}),
        linksApi.list({ approvalStatus: 'APPROVED' }),
        vehicleTypesApi.list(),
      ]);

      setOrders(extractArray(ordersRes));
      setManifestos(extractArray(manifestsRes));
      setLinks(extractArray(linksRes));
      setVehicleTypes(extractArray(vtRes));
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Derived state
  const manifestosAtivos = manifestos.filter((m) =>
    ACTIVE_MANIFEST_STATUSES.includes(m.status)
  );

  const orderIdsInManifest = new Set(
    manifestosAtivos.flatMap((m) => (m.demands ?? []).map((d) => d.id))
  );

  const pedidosSemManifesto = orders.filter(
    (o) => !orderIdsInManifest.has(o.demand?.id ?? o.id)
  );

  // Group orders without manifest by destination
  const groupedByDestination = pedidosSemManifesto.reduce<Record<string, Order[]>>(
    (acc, order) => {
      const dest = getOrderDestination(order);
      if (!acc[dest]) acc[dest] = [];
      acc[dest].push(order);
      return acc;
    },
    {}
  );

  const selectedOrders = orders.filter((o) => selectedOrderIds.has(o.id));

  const toggleOrder = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const handleManifestCreated = async () => {
    setShowModal(false);
    setSelectedOrderIds(new Set());
    await load();
  };

  // ── Nav items ──────────────────────────────────────────────────────────
  const navItems: BottomNavItem[] = [
    {
      key: 'inicio',
      label: 'Início',
      icon: <IconHome />,
      badge: pedidosSemManifesto.length,
    },
    {
      key: 'entrada',
      label: 'Entrada',
      icon: <IconPlus />,
    },
    {
      key: 'pedidos',
      label: 'Pedidos',
      icon: <IconClipboard />,
    },
    {
      key: 'manifestos',
      label: 'Manifestos',
      icon: <IconTruck />,
      badge: manifestosAtivos.length,
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 pb-20">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30">
        <div className="px-4 py-3 flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">TSM Hub</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 font-medium"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Manifest CTA button — floats above BottomNav when orders are selected */}
      {selectedOrderIds.size > 0 && (
        <div className="fixed bottom-[72px] left-0 right-0 z-30 px-4 pb-2">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-lg text-sm transition-colors"
          >
            Manifesto ({selectedOrderIds.size})
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="p-4">
        {/* Error state */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm flex items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={load}
              className="shrink-0 flex items-center gap-1 text-xs font-medium underline"
            >
              <IconRefresh /> Tentar novamente
            </button>
          </div>
        )}

        {/* Loading spinner */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
            <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            <span className="text-sm">Carregando...</span>
          </div>
        )}

        {!loading && (
          <>
            {/* ── Tab: início ─────────────────────────────────── */}
            {tab === 'inicio' && (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Para manifesto</p>
                    <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                      {pedidosSemManifesto.length}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">pedidos</p>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Em andamento</p>
                    <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                      {manifestosAtivos.length}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">manifestos</p>
                  </div>
                </div>

                {/* Grouped orders */}
                {pedidosSemManifesto.length === 0 ? (
                  <div className="bg-white dark:bg-slate-800 rounded-xl p-6 text-center text-slate-500 dark:text-slate-400 text-sm border border-slate-200 dark:border-slate-700">
                    Nenhum pedido aguardando manifesto.
                  </div>
                ) : (
                  <>
                    <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Pedidos por destino
                    </h2>
                    {(Object.entries(groupedByDestination) as [string, Order[]][]).map(([dest, destOrders]) => (
                      <div
                        key={dest}
                        className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden"
                      >
                        {/* Group header */}
                        <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {dest}
                          </span>
                          <span className="text-xs text-slate-500">
                            {destOrders.length} pedido{destOrders.length !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {/* Orders in group */}
                        <div className="divide-y divide-slate-100 dark:divide-slate-700">
                          {destOrders.map((order) => (
                            <label
                              key={order.id}
                              className="flex items-start gap-3 px-4 py-3 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedOrderIds.has(order.id)}
                                onChange={() => toggleOrder(order.id)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-900 dark:text-white">
                                  NF {getOrderNf(order)}
                                </p>
                                {order.demand?.commodity && (
                                  <p className="text-xs text-slate-500 truncate">
                                    {order.demand.commodity}
                                  </p>
                                )}
                                {order.demand?.weight && (
                                  <p className="text-xs text-slate-400">
                                    {order.demand.weight} kg
                                  </p>
                                )}
                              </div>
                              <span
                                className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                                  STATUS_COLOR[order.status] ?? 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {STATUS_LABEL[order.status] ?? order.status}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* ── Tab: entrada ────────────────────────────────── */}
            {tab === 'entrada' && <EntradaTab />}

            {/* ── Tab: pedidos ─────────────────────────────────── */}
            {tab === 'pedidos' && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Todos os pedidos ({orders.length})
                </h2>
                {orders.length === 0 ? (
                  <div className="bg-white dark:bg-slate-800 rounded-xl p-6 text-center text-slate-500 text-sm border border-slate-200 dark:border-slate-700">
                    Nenhum pedido encontrado.
                  </div>
                ) : (
                  orders.map((order) => (
                    <div
                      key={order.id}
                      className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-white text-sm">
                            NF {getOrderNf(order)}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {order.demand?.origin ?? '—'} → {getOrderDestination(order)}
                          </p>
                          {order.demand?.commodity && (
                            <p className="text-xs text-slate-400 mt-0.5 truncate">
                              {order.demand.commodity}
                            </p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${
                            STATUS_COLOR[order.status] ?? 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {STATUS_LABEL[order.status] ?? order.status}
                        </span>
                      </div>
                      {(order.demand?.weight || order.demand?.volume) && (
                        <p className="text-xs text-slate-400 mt-2">
                          {order.demand.weight ? `${order.demand.weight} kg` : ''}
                          {order.demand.weight && order.demand.volume ? ' · ' : ''}
                          {order.demand.volume ? `${order.demand.volume} m³` : ''}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── Tab: manifestos ──────────────────────────────── */}
            {tab === 'manifestos' && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Manifestos ativos ({manifestosAtivos.length})
                </h2>
                {manifestosAtivos.length === 0 ? (
                  <div className="bg-white dark:bg-slate-800 rounded-xl p-6 text-center text-slate-500 text-sm border border-slate-200 dark:border-slate-700">
                    Nenhum manifesto ativo no momento.
                  </div>
                ) : (
                  manifestosAtivos.map((m) => (
                    <div
                      key={m.id}
                      className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-white text-sm">
                            {m.link?.name ?? 'Sem motorista'}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {m.origin} → {m.destination}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {m.demands?.length ?? 0} pedido{(m.demands?.length ?? 0) !== 1 ? 's' : ''}
                            {m.vehicleType ? ` · ${m.vehicleType.name}` : ''}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${
                            MANIFEST_STATUS_COLOR[m.status] ?? 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {MANIFEST_STATUS_LABEL[m.status] ?? m.status}
                        </span>
                      </div>
                      <div className="mt-2 flex gap-2 text-xs text-slate-400">
                        <span>{m.totalWeight} kg</span>
                        <span>·</span>
                        <span>{m.totalVolume} m³</span>
                      </div>
                    </div>
                  ))
                )}

                {/* All manifests section */}
                {manifestos.filter((m) => !ACTIVE_MANIFEST_STATUSES.includes(m.status)).length >
                  0 && (
                  <>
                    <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider pt-2">
                      Histórico
                    </h2>
                    {manifestos
                      .filter((m) => !ACTIVE_MANIFEST_STATUSES.includes(m.status))
                      .map((m) => (
                        <div
                          key={m.id}
                          className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 opacity-70"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-700 dark:text-slate-300 text-sm">
                                {m.link?.name ?? 'Sem motorista'}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {m.origin} → {m.destination}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${
                                MANIFEST_STATUS_COLOR[m.status] ?? 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {MANIFEST_STATUS_LABEL[m.status] ?? m.status}
                            </span>
                          </div>
                        </div>
                      ))}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Manifest creation modal */}
      {showModal && (
        <ManifestModal
          selectedOrders={selectedOrders}
          links={links}
          vehicleTypes={vehicleTypes}
          onClose={() => setShowModal(false)}
          onCreated={handleManifestCreated}
        />
      )}

      {/* Bottom nav */}
      <BottomNav items={navItems} active={tab} onChange={(key) => setTab(key as Tab)} />
    </div>
  );
};

export default HubHome;
