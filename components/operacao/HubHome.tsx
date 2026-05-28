import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { linksApi, manifestsApi, ordersApi, intakeDemandsApi, vehicleTypesApi } from '../../lib/api';
import { demandStatusLabels, demandStatusTones, orderStatusLabels, orderStatusTones, type StatusTone } from '../../lib/demandStatusUi';
import { useAuthStore } from '../../store/authStore';
import type { Link, Manifest, OrderStatus, VehicleType } from '../../types/index';
import EntradaTab from '../admin/EntradaTab';
import ThemeToggle from '../ui/ThemeToggle';
import BottomNav, { type BottomNavItem } from './BottomNav';
import HubAwaitingArrivalTab from './HubAwaitingArrivalTab';
import { HubNavIconHome, HubNavIconInbox, HubNavIconManifest, HubNavIconOrders, HubNavIconPlus } from './hubNavIcons';

type Tab = 'inicio' | 'recebimento' | 'entrada' | 'pedidos' | 'manifestos';

interface Order {
  id: string;
  status: OrderStatus;
  nfNumber?: string;
  demand?: {
    id?: string;
    status?: keyof typeof demandStatusLabels;
    nfNumber?: string;
    origin?: string;
    destination?: string;
    commodity?: string;
    weight?: number;
    volume?: number;
  };
  attachments?: unknown[];
  [key: string]: any;
}

const ACTIVE_MANIFEST_STATUSES = ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'];

const MANIFEST_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
};

const MANIFEST_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_ACCEPT: 'warning',
  ACCEPTED: 'info',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const toneClassMap: Record<StatusTone, string> = {
  neutral: 'tone-neutral',
  info: 'tone-info',
  warning: 'tone-warning',
  success: 'tone-success',
  danger: 'tone-danger',
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const shortId = (id?: string): string => (id ? id.slice(0, 8).toUpperCase() : '--------');

const toDateLabel = (order: Order): string => {
  const createdAt = order.createdAt ? new Date(order.createdAt) : null;
  if (!createdAt) return 'Sem data';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(createdAt, today)) return 'Hoje';
  if (sameDay(createdAt, yesterday)) return 'Ontem';
  return 'Esta semana';
};

function extractArray(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.data)) return res.data;
  return [];
}

const ManifestModal: React.FC<{
  selectedOrders: Order[];
  links: Link[];
  vehicleTypes: VehicleType[];
  onClose: () => void;
  onCreated: () => void;
}> = ({ selectedOrders, links, vehicleTypes, onClose, onCreated }) => {
  const [linkId, setLinkId] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [notes, setNotes] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = selectedOrders[0]?.demand?.origin ?? selectedOrders[0]?.origin ?? '';
  const destination = [...new Set(selectedOrders.map((o) => o.demand?.destination ?? o.destination ?? 'Sem destino'))].join(', ');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkId || !vehicleTypeId) {
      setError('Selecione motorista e tipo de veículo.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const demandIds = selectedOrders.map((o) => o.demand?.id ?? o.demandId ?? o.id).filter(Boolean) as string[];
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
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="mobile-enter relative max-h-[90vh] overflow-y-auto rounded-t-2xl border border-tower-200 bg-[var(--app-surface)] dark:border-tower-700 dark:bg-tower-900">
        <div className="flex items-center justify-between border-b border-tower-200 px-4 py-3 dark:border-tower-700">
          <h2 className="font-display text-base font-semibold text-tower-900 dark:text-white">Criar manifesto ({selectedOrders.length})</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-tower-500 hover:bg-tower-100 dark:hover:bg-tower-800" aria-label="Fechar modal">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {error && <div className="mobile-enter rounded-lg border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">{error}</div>}
          <div className="rounded-xl border border-tower-200 bg-tower-50 p-3 text-xs dark:border-tower-700 dark:bg-tower-800">
            {selectedOrders.map((o) => (
              <div key={o.id} className="text-tower-700 dark:text-tower-300">NF {o.nfNumber ?? o.demand?.nfNumber ?? '—'} para {o.demand?.destination ?? 'Sem destino'}</div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-tower-600 dark:text-tower-300">
              Origem
              <input value={origin} readOnly className="mt-1 w-full rounded-lg border border-tower-300 bg-tower-50 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
            </label>
            <label className="text-xs text-tower-600 dark:text-tower-300">
              Destino
              <input value={destination} readOnly className="mt-1 w-full rounded-lg border border-tower-300 bg-tower-50 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
            </label>
          </div>
          <label className="block text-xs text-tower-600 dark:text-tower-300">
            Motorista
            <select value={linkId} onChange={(e) => setLinkId(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" required>
              <option value="">Selecione</option>
              {links.map((l) => <option key={l.id} value={l.id}>{l.name} - {l.vehiclePlate}</option>)}
            </select>
          </label>
          <label className="block text-xs text-tower-600 dark:text-tower-300">
            Tipo de veículo
            <select value={vehicleTypeId} onChange={(e) => setVehicleTypeId(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" required>
              <option value="">Selecione</option>
              {vehicleTypes.map((vt) => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
            </select>
          </label>
          <label className="block text-xs text-tower-600 dark:text-tower-300">
            Data prevista
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
          </label>
          <label className="block text-xs text-tower-600 dark:text-tower-300">
            Observações
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full resize-none rounded-lg border border-tower-300 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
          </label>
          <button type="submit" disabled={saving} className="min-h-[44px] w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Criando manifesto...' : 'Criar manifesto'}
          </button>
        </form>
      </div>
    </div>
  );
};

const HubHome: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [tab, setTab] = useState<Tab>('inicio');
  const [orders, setOrders] = useState<Order[]>([]);
  const [manifestos, setManifestos] = useState<Manifest[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [attachmentUploadingOrderId, setAttachmentUploadingOrderId] = useState<string | null>(null);
  const [awaitingRecebimentoCount, setAwaitingRecebimentoCount] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const apiErr = (e: unknown): string => {
      if (e && typeof e === 'object' && 'response' in e) {
        const res = (e as { response?: { data?: { error?: string } } }).response;
        return res?.data?.error || 'Erro ao carregar dados';
      }
      return e instanceof Error ? e.message : 'Erro ao carregar dados';
    };

    const [ordersSettled, manifestsSettled, linksSettled, vtSettled, intakeSettled] =
      await Promise.allSettled([
        ordersApi.list({ limit: 200, statuses: 'AT_HUB,IN_TRANSIT,ASSIGNED,COLLECTED,OUT_FOR_DELIVERY' }),
        manifestsApi.list({}),
        linksApi.list({ approvalStatus: 'APPROVED' }),
        vehicleTypesApi.list(),
        intakeDemandsApi.list({ status: 'AWAITING_ARRIVAL', limit: 1, offset: 0 }),
      ]);

    const criticalErrors: string[] = [];

    if (ordersSettled.status === 'fulfilled') {
      setOrders(extractArray(ordersSettled.value));
    } else {
      setOrders([]);
      criticalErrors.push(apiErr(ordersSettled.reason));
    }

    if (manifestsSettled.status === 'fulfilled') {
      setManifestos(extractArray(manifestsSettled.value));
    } else {
      setManifestos([]);
      criticalErrors.push(apiErr(manifestsSettled.reason));
    }

    if (linksSettled.status === 'fulfilled') {
      setLinks(extractArray(linksSettled.value));
    } else {
      setLinks([]);
    }

    if (vtSettled.status === 'fulfilled') {
      setVehicleTypes(extractArray(vtSettled.value));
    } else {
      setVehicleTypes([]);
    }

    if (intakeSettled.status === 'fulfilled') {
      const intakeCountRes = intakeSettled.value;
      if (intakeCountRes && typeof intakeCountRes === 'object' && 'pagination' in intakeCountRes) {
        setAwaitingRecebimentoCount(
          (intakeCountRes as { pagination?: { total?: number } }).pagination?.total ?? 0,
        );
      } else {
        setAwaitingRecebimentoCount(0);
      }
    } else {
      setAwaitingRecebimentoCount(0);
    }

    if (criticalErrors.length > 0) {
      setError(criticalErrors[0]);
    }

    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const manifestosAtivos = useMemo(() => manifestos.filter((m) => ACTIVE_MANIFEST_STATUSES.includes(m.status)), [manifestos]);
  const orderIdsInManifest = useMemo(() => new Set(manifestosAtivos.flatMap((m) => (m.demands ?? []).map((d) => d.id))), [manifestosAtivos]);
  const pedidosSemManifesto = useMemo(() => orders.filter((o) => !orderIdsInManifest.has(o.demand?.id ?? o.id)), [orders, orderIdsInManifest]);
  const selectedOrders = useMemo(() => orders.filter((o) => selectedOrderIds.has(o.id)), [orders, selectedOrderIds]);

  const kpi = useMemo(() => ({
    aConsolidar: pedidosSemManifesto.length,
    aguardamCotacao: orders.filter((o) => o.status === 'PENDING').length,
    emTransito: orders.filter((o) => o.status === 'IN_TRANSIT').length,
    noHub: orders.filter((o) => o.status === 'AT_HUB').length,
  }), [orders, pedidosSemManifesto.length]);

  const recentDemandsGrouped = useMemo(() => {
    const sorted = [...orders].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()).slice(0, 8);
    return sorted.reduce<Record<string, Order[]>>((acc, order) => {
      const label = toDateLabel(order);
      if (!acc[label]) acc[label] = [];
      acc[label].push(order);
      return acc;
    }, {});
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (!debouncedQuery) return orders;
    return orders.filter((o) => {
      const haystack = `${o.id} ${o.nfNumber ?? ''} ${o.demand?.nfNumber ?? ''} ${o.demand?.origin ?? ''} ${o.demand?.destination ?? ''}`.toLowerCase();
      return haystack.includes(debouncedQuery);
    });
  }, [debouncedQuery, orders]);

  const toggleOrder = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const handleOrderAttachmentUpload = async (orderId: string, file: File) => {
    setAttachmentUploadingOrderId(orderId);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      await ordersApi.addAttachment(orderId, {
        file: base64,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        category: 'HUB_HOME',
      });
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao anexar arquivo');
    } finally {
      setAttachmentUploadingOrderId(null);
    }
  };

  const navItems: BottomNavItem[] = [
    { key: 'inicio', label: 'Início', icon: <HubNavIconHome />, badge: pedidosSemManifesto.length },
    { key: 'recebimento', label: 'Receber', icon: <HubNavIconInbox />, badge: awaitingRecebimentoCount > 0 ? awaitingRecebimentoCount : undefined },
    { key: 'entrada', label: 'Entrada', icon: <HubNavIconPlus /> },
    { key: 'pedidos', label: 'Pedidos', icon: <HubNavIconOrders /> },
    { key: 'manifestos', label: 'Manifestos', icon: <HubNavIconManifest />, badge: manifestosAtivos.length },
  ];

  return (
    <div className="min-h-screen bg-[var(--app-page-bg)] pb-24">
      <header className="sticky top-0 z-30 border-b border-tower-200 bg-[var(--app-nav-bg)] shadow-[0_1px_0_rgb(15_23_42/0.04)] dark:border-tower-700 dark:bg-brand-950 dark:shadow-none">
        <div className="flex items-center justify-between px-4 py-3 safe-area-top">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">TSM EX</span>
            <h1 className="font-display text-lg font-semibold text-tower-900 dark:text-white">Dashboard</h1>
          </div>
          <button type="button" className="h-11 min-w-11 rounded-full bg-brand-700 px-3 text-sm font-semibold text-white" onClick={() => setShowProfileSheet(true)} aria-label="Abrir perfil">
            {(user?.email?.[0] ?? 'U').toUpperCase()}
          </button>
        </div>
      </header>

      {selectedOrderIds.size > 0 && (
        <div className="fab-up fixed bottom-[74px] left-0 right-0 z-30 px-4 pb-2">
          <button type="button" onClick={() => setShowModal(true)} className="min-h-[48px] w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-700">
            Manifesto ({selectedOrderIds.size})
          </button>
        </div>
      )}

      <main key={tab} className="mobile-enter p-4">
        {error && (
          <div className="mobile-enter mb-4 flex items-center justify-between gap-3 rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="rounded-lg px-2 py-1 text-xs font-semibold underline">Tentar novamente</button>
          </div>
        )}
        {loading && <div className="py-16 text-center text-sm text-tower-600 dark:text-tower-300">Carregando...</div>}

        {!loading && tab === 'recebimento' && (
          <HubAwaitingArrivalTab
            onGoEntrada={() => setTab('entrada')}
            onConfirmed={() => void load()}
            onViewOrder={(orderId) => {
              window.location.hash = `#/orders/${orderId}`;
            }}
          />
        )}

        {!loading && tab === 'inicio' && (
          <section className="space-y-4">
            <div className="card-surface border-brand-500/25 p-4 dark:border-brand-500/20 dark:bg-brand-900/40">
              <p className="font-display text-[10px] uppercase tracking-[0.14em] text-tower-600 dark:text-tower-300">Cenário agora</p>
              <button type="button" className="mt-2 w-full text-left" onClick={() => { setTab('pedidos'); setQuery(''); }}>
                <p className="font-display text-sm text-tower-700 dark:text-tower-200">A consolidar (sem manifesto)</p>
                <p className="font-display text-4xl font-bold tabular-nums text-brand-600 dark:text-brand-300">{kpi.aConsolidar}</p>
              </button>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-tower-200 pt-3 sm:grid-cols-4 dark:border-tower-700">
                <KpiInline label="Aguardam cotação" value={kpi.aguardamCotacao} />
                <KpiInline label="Em trânsito" value={kpi.emTransito} />
                <KpiInline label="No hub" value={kpi.noHub} />
                <button type="button" onClick={() => setTab('recebimento')} className="min-h-[64px] rounded-lg border border-brand-500/30 bg-brand-500/5 px-2 py-2 text-center transition-colors hover:bg-brand-500/10 dark:border-brand-400/30 dark:bg-brand-900/40">
                  <p className="text-[11px] text-tower-600 dark:text-tower-400">Aguardando chegada</p>
                  <p className="font-display text-xl font-semibold tabular-nums text-brand-600 dark:text-brand-300">{awaitingRecebimentoCount}</p>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <p className="font-display text-[10px] uppercase tracking-[0.14em] text-tower-600 dark:text-tower-300">Demandas recentes</p>
              {(Object.entries(recentDemandsGrouped) as [string, Order[]][]).map(([label, list]) => (
                <div key={label} className="space-y-2">
                  <p className="font-display text-[10px] uppercase tracking-[0.14em] text-tower-600 dark:text-tower-400">{label}</p>
                  {list.map((order) => (
                    <button key={order.id} type="button" onClick={() => (window.location.hash = `#/orders/${order.id}`)} className="card-surface w-full cursor-pointer p-3 text-left transition-colors duration-200 hover:bg-[var(--app-surface-muted)] dark:hover:bg-tower-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono-ids text-xs text-tower-600 dark:text-tower-300">{shortId(order.id)}</span>
                        <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${toneClassMap[orderStatusTones[order.status] ?? 'neutral']}`}>
                          {orderStatusLabels[order.status] ?? order.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-tower-800 dark:text-tower-100">{order.demand?.origin ?? 'Origem'} → {order.demand?.destination ?? 'Destino'}</p>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && tab === 'entrada' && (
          <>
            <div className="md:hidden">
              <EntradaTab mobileWizard />
            </div>
            <div className="hidden md:block">
              <EntradaTab />
            </div>
          </>
        )}

        {!loading && tab === 'pedidos' && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar pedidos..." className="h-11 w-full rounded-xl border border-tower-300 bg-white px-3 text-sm text-tower-900 placeholder:text-tower-500 ring-brand-500/30 focus:border-brand-500 focus:outline-none focus:ring-2 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100 dark:placeholder:text-tower-400" />
              <button type="button" onClick={() => setTab('entrada')} className="h-11 min-w-11 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white">+ Nova entrada</button>
            </div>
            {filteredOrders.length === 0 && <div className="rounded-xl border border-dashed border-tower-300 p-6 text-center text-sm text-tower-600 dark:border-tower-600 dark:text-tower-300">Nenhum pedido encontrado.</div>}
            {filteredOrders.map((order) => (
              <button key={order.id} type="button" onClick={() => (window.location.hash = `#/orders/${order.id}`)} className="card-surface w-full cursor-pointer p-4 text-left transition-colors duration-200 hover:bg-[var(--app-surface-muted)] dark:hover:bg-tower-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono-ids text-xs text-tower-600 dark:text-tower-300">{shortId(order.id)}</p>
                    <p className="mt-1 text-sm font-semibold text-tower-800 dark:text-tower-100">{order.demand?.origin ?? 'Origem'} → {order.demand?.destination ?? 'Destino'}</p>
                    <p className="text-xs text-tower-600 dark:text-tower-400">NF {order.nfNumber ?? order.demand?.nfNumber ?? '—'}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${toneClassMap[orderStatusTones[order.status] ?? 'neutral']}`}>{orderStatusLabels[order.status] ?? order.status}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-tower-600 dark:text-tower-400">
                  <label className="cursor-pointer font-medium text-brand-600 hover:underline dark:text-brand-300">
                    {attachmentUploadingOrderId === order.id ? 'Enviando...' : 'Anexar evidência'}
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                      disabled={attachmentUploadingOrderId === order.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleOrderAttachmentUpload(order.id, file);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedOrderIds.has(order.id)} onChange={(e) => { e.stopPropagation(); toggleOrder(order.id); }} onClick={(e) => e.stopPropagation()} className="h-4 w-4 rounded border-tower-300 text-brand-600" />
                    Selecionar
                  </label>
                </div>
              </button>
            ))}
          </section>
        )}

        {!loading && tab === 'manifestos' && (
          <section className="space-y-3">
            {manifestosAtivos.length === 0 && <div className="rounded-xl border border-dashed border-tower-300 p-6 text-center text-sm text-tower-600 dark:border-tower-600 dark:text-tower-300">Nenhum manifesto ativo.</div>}
            {manifestos.map((m) => (
              <div key={m.id} className="card-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-tower-800 dark:text-tower-100">{m.link?.name ?? 'Sem motorista'}</p>
                    <p className="text-xs text-tower-600 dark:text-tower-400">{m.origin} → {m.destination}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${toneClassMap[MANIFEST_STATUS_TONE[m.status] ?? 'neutral']}`}>{MANIFEST_STATUS_LABEL[m.status] ?? m.status}</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </main>

      {showModal && (
        <ManifestModal
          selectedOrders={selectedOrders}
          links={links}
          vehicleTypes={vehicleTypes}
          onClose={() => setShowModal(false)}
          onCreated={async () => {
            setShowModal(false);
            setSelectedOrderIds(new Set());
            await load();
          }}
        />
      )}

      {showProfileSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <button type="button" className="absolute inset-0 bg-black/50" onClick={() => setShowProfileSheet(false)} aria-label="Fechar perfil" />
          <div className="mobile-enter relative rounded-t-2xl border border-tower-200 bg-[var(--app-surface)] p-4 dark:border-tower-700 dark:bg-tower-900">
            <p className="font-display text-sm font-semibold text-tower-900 dark:text-white">Perfil</p>
            <p className="mt-1 text-xs text-tower-600 dark:text-tower-300">{user?.email}</p>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-tower-200 p-2 dark:border-tower-700">
              <span className="text-sm text-tower-700 dark:text-tower-200">Tema</span>
              <ThemeToggle />
            </div>
            <button type="button" className="mt-3 min-h-[44px] w-full rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 py-3 text-sm font-semibold text-brand-red-600 dark:text-brand-red-400" onClick={logout}>Sair</button>
          </div>
        </div>
      )}

      <BottomNav items={navItems} active={tab} onChange={(key) => setTab(key as Tab)} />
    </div>
  );
};

const KpiInline: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="min-h-[64px] rounded-lg border border-tower-200 bg-[var(--app-surface-muted)] px-2 py-2 text-center transition-colors duration-200 dark:border-tower-700 dark:bg-tower-800/80">
    <p className="text-[11px] text-tower-600 dark:text-tower-400">{label}</p>
    <p className="font-display text-xl font-semibold tabular-nums text-tower-800 dark:text-tower-100">{value}</p>
  </div>
);

export default HubHome;
