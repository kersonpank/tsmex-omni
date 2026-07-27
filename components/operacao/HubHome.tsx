import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { linksApi, manifestsApi, ordersApi, intakeDemandsApi, vehicleTypesApi, hubsApi } from '../../lib/api';
import { demandStatusLabels, demandStatusTones, orderStatusLabels, orderStatusTones, type StatusTone } from '../../lib/demandStatusUi';
import { manifestStatusLabels as MANIFEST_STATUS_LABEL, manifestStatusTone as MANIFEST_STATUS_TONE } from '../../lib/manifestStatusUi';
import { useAuthStore } from '../../store/authStore';
import type { Link, Manifest, OrderAggregateSummary, OrderStatus, ResolvedOrderSummary, VehicleType } from '../../types/index';
import EntradaTab from '../admin/EntradaTab';
import InlineNotice from '../ui/InlineNotice';
import OrderScanInput from '../ui/OrderScanInput';
import ThemeToggle from '../ui/ThemeToggle';
import BottomNav, { type BottomNavItem } from './BottomNav';
import HubAwaitingArrivalTab from './HubAwaitingArrivalTab';
import NfeDistribuicaoTriagemTab from './NfeDistribuicaoTriagemTab';
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
    units?: number;
    cubedWeight?: number;
    nfValue?: number;
  };
  attachments?: unknown[];
  [key: string]: any;
}

const ACTIVE_MANIFEST_STATUSES = ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'];

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

const getOrderCustody = (order: any): string => {
  if (order.status === 'AT_HUB') {
    return `No HUB ${order.currentHub?.name ?? order.currentHub?.code ?? '—'}`;
  }
  if (order.status === 'IN_TRANSIT') {
    const activeLeg = order.legs?.find((leg: any) => leg.startedAt && !leg.completedAt);
    if (activeLeg) {
      const origin = activeLeg.legType === 'COLETA'
        ? (order.origemPrestacao ?? order.demand?.origin ?? 'Origem')
        : (activeLeg.manifest?.hub?.name ?? activeLeg.manifest?.hub?.code ?? 'HUB Origem');
      const dest = activeLeg.legType === 'ENTREGA'
        ? (order.fimPrestacao ?? order.demand?.destination ?? 'Destino')
        : (activeLeg.manifest?.destHub?.name ?? activeLeg.manifest?.destHub?.code ?? 'HUB Destino');
      return `Em trânsito na perna: ${origin} → ${dest}`;
    }
    if (order.manifest) {
      return `Em trânsito (${order.manifest.origin} → ${order.manifest.destination})`;
    }
    return 'Em trânsito';
  }
  if (order.status === 'PENDING') {
    return 'Aguardando coleta';
  }
  if (order.status === 'OUT_FOR_DELIVERY') {
    return 'Saiu para entrega final';
  }
  if (order.status === 'DELIVERED') {
    return 'Entregue';
  }
  if (order.status === 'CANCELLED') {
    return 'Cancelado';
  }
  return '—';
};

const orderCargoLine = (order: Order): React.ReactNode => {
  const parts: string[] = [];
  if (typeof order.demand?.units === 'number') parts.push(`${order.demand.units} vol`);
  if (typeof order.demand?.weight === 'number') parts.push(`${order.demand.weight.toLocaleString('pt-BR')} kg`);
  if (typeof order.demand?.cubedWeight === 'number') parts.push(`cubado ${order.demand.cubedWeight.toLocaleString('pt-BR')} kg`);
  if (typeof order.demand?.nfValue === 'number') parts.push(`R$ ${order.demand.nfValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  if (parts.length === 0) return null;
  return <div className="mt-1 text-xs text-tower-600 dark:text-tower-400">{parts.join(' · ')}</div>;
};

function extractArray(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.data)) return res.data;
  return [];
}

interface HubOption { id: string; name: string; code: string; }

const ManifestModal: React.FC<{
  selectedOrders: Order[];
  links: Link[];
  vehicleTypes: VehicleType[];
  onClose: () => void;
  onCreated: (manifestId: string) => void;
}> = ({ selectedOrders, links, vehicleTypes, onClose, onCreated }) => {
  const [tripType, setTripType] = useState<'TRANSFER' | 'DELIVERY'>('TRANSFER');
  const [destHubId, setDestHubId] = useState('');
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [linkId, setLinkId] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = selectedOrders[0]?.demand?.origin ?? selectedOrders[0]?.origin ?? '';
  const destination = [...new Set(selectedOrders.map((o) => o.demand?.destination ?? o.destination ?? 'Sem destino'))].join(', ');

  useEffect(() => {
    hubsApi.list().then((r: any) => setHubs((r?.data ?? r) || [])).catch(() => setHubs([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleTypeId) {
      setError('Selecione o tipo de veículo.');
      return;
    }
    if (tripType === 'TRANSFER' && !destHubId) {
      setError('Selecione o hub destino para transferência.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await manifestsApi.create({
        vehicleTypeId,
        origin,
        destination,
        tripType,
        ...(tripType === 'TRANSFER' ? { destHubId } : {}),
      });
      const manifestId = (created as any)?.data?.id ?? (created as any)?.id;
      if (!manifestId) throw new Error('Manifesto criado sem id retornado.');

      const failedOrders: string[] = [];
      for (const order of selectedOrders) {
        try {
          await manifestsApi.addDemand(manifestId, { orderId: order.id });
        } catch {
          failedOrders.push(order.nfNumber ?? order.demand?.nfNumber ?? order.id.slice(0, 8));
        }
      }

      // Só atribui o Link se um foi escolhido E todos os pedidos entraram — senão o
      // manifesto fica em DRAFT de propósito, pra dar tempo do operador bipar o
      // pedido que faltou na tela de detalhe (a seção Pedidos só é editável em DRAFT).
      let assignError: string | null = null;
      if (linkId && failedOrders.length === 0) {
        try {
          await manifestsApi.assignLink(manifestId, linkId);
        } catch (e: any) {
          assignError = e.response?.data?.error || e.message || 'Erro desconhecido';
        }
      }

      if (failedOrders.length > 0) {
        const linkSuffix = linkId
          ? ' O motorista não foi atribuído ainda — resolva os pedidos pendentes e atribua o Link na tela do manifesto (seção "Motorista").'
          : '';
        window.alert(
          `Manifesto criado (rascunho), mas ${failedOrders.length} pedido(s) não entraram: ${failedOrders.join(', ')}. Abra o manifesto e use a bipagem para adicioná-los.${linkSuffix}`
        );
      } else if (assignError) {
        window.alert(
          `Manifesto e pedidos criados, mas houve um erro ao atribuir o motorista: ${assignError}. Tente novamente na tela do manifesto, seção "Motorista".`
        );
      }
      onCreated(manifestId);
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
          <h2 className="font-display text-base font-semibold text-tower-900 dark:text-white">
            {selectedOrders.length > 0 ? `Criar manifesto (${selectedOrders.length})` : 'Nova viagem'}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-tower-500 hover:bg-tower-100 dark:hover:bg-tower-800" aria-label="Fechar modal">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {error && <div className="mobile-enter rounded-lg border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">{error}</div>}
          {selectedOrders.length > 0 ? (
            <div className="rounded-xl border border-tower-200 bg-tower-50 p-3 text-xs dark:border-tower-700 dark:bg-tower-800">
              {selectedOrders.map((o) => (
                <div key={o.id} className="text-tower-700 dark:text-tower-300">NF {o.nfNumber ?? o.demand?.nfNumber ?? '—'} para {o.demand?.destination ?? 'Sem destino'}</div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-tower-500 dark:text-tower-400">Nenhum pedido selecionado ainda — bipe depois de criar.</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-tower-600 dark:text-tower-300">
              Origem
              <input value={origin} readOnly className="mt-1 w-full rounded-lg border border-tower-300 bg-tower-50 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
            </label>
            <label className="text-xs text-tower-600 dark:text-tower-300">
              Destino final
              <input value={destination} readOnly className="mt-1 w-full rounded-lg border border-tower-300 bg-tower-50 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" />
            </label>
          </div>
          <label className="block text-xs text-tower-600 dark:text-tower-300">
            Tipo de viagem
            <select value={tripType} onChange={(e) => { setTripType(e.target.value as 'TRANSFER' | 'DELIVERY'); setDestHubId(''); }} className="mt-1 w-full rounded-lg border border-tower-300 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800">
              <option value="TRANSFER">Transferência (Hub → Hub)</option>
              <option value="DELIVERY">Entrega final (Hub → Cliente)</option>
            </select>
          </label>
          {tripType === 'TRANSFER' && (
            <label className="block text-xs text-tower-600 dark:text-tower-300">
              Hub destino
              <select value={destHubId} onChange={(e) => setDestHubId(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800" required>
                <option value="">Selecione o hub destino</option>
                {hubs.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
              </select>
            </label>
          )}
          <label className="block text-xs text-tower-600 dark:text-tower-300">
            Transportador (Link) — opcional, pode atribuir depois
            <select value={linkId} onChange={(e) => setLinkId(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800">
              <option value="">Selecione (ou deixe em branco)</option>
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
          <button type="submit" disabled={saving} className="min-h-[44px] w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Criando manifesto...' : 'Criar manifesto'}
          </button>
        </form>
      </div>
    </div>
  );
};

const ManifestCard: React.FC<{ m: any; children?: React.ReactNode }> = ({ m, children }) => (
  <div className="card-surface p-4">
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-sm font-semibold text-tower-800 dark:text-tower-100">{m.link?.name ?? 'Sem motorista'}</p>
        <p className="text-xs text-tower-600 dark:text-tower-400">{m.origin} → {m.destination}</p>
      </div>
      <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${toneClassMap[MANIFEST_STATUS_TONE[m.status] ?? 'neutral']}`}>{MANIFEST_STATUS_LABEL[m.status] ?? m.status}</span>
    </div>
    {m.tripStops && m.tripStops.length > 0 && (
      <ul className="mt-2 space-y-1 text-xs text-tower-600 dark:text-tower-300">
        {m.tripStops.map((s: any) => (
          <li key={s.id}>
            #{s.sequence} — {s.destHub ? `${s.destHub.name} (${s.destHub.code})` : (s.destinationLabel ?? s.destCity ?? 'Parada')}
            {s.completedAt ? ' · Concluída' : ' · Pendente'}
          </li>
        ))}
      </ul>
    )}
    <div className="mt-3 flex items-center justify-between text-xs pt-2 border-t border-tower-100 dark:border-tower-800">
      <span className="text-tower-500 dark:text-tower-400">Margem:</span>
      {m.costComplete ? (
        <span className={`font-semibold ${(m.margin ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(m.margin ?? 0)} ({m.marginPercent?.toFixed(1) ?? '0.0'}%)
        </span>
      ) : (
        <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
          Custo não definido
        </span>
      )}
    </div>
    <button
      type="button"
      onClick={() => { window.location.hash = `#/manifests/${m.id}`; }}
      className="mt-3 w-full rounded-lg border border-tower-300 py-2 text-sm font-semibold text-tower-700 hover:bg-tower-50 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
    >
      Ver detalhes →
    </button>
    {children}
  </div>
);

const HubHome: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [tab, setTab] = useState<Tab>('inicio');
  const [orders, setOrders] = useState<Order[]>([]);
  const [manifestos, setManifestos] = useState<Manifest[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [attachmentUploadingOrderId, setAttachmentUploadingOrderId] = useState<string | null>(null);
  const [awaitingRecebimentoCount, setAwaitingRecebimentoCount] = useState(0);
  const [orderSummary, setOrderSummary] = useState<OrderAggregateSummary | null>(null);

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
        ordersApi.list({ limit: 200, statuses: 'AT_HUB,IN_TRANSIT,PENDING,OUT_FOR_DELIVERY' }),
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

  useEffect(() => {
    let cancelled = false;
    ordersApi.aggregate({ statuses: 'AT_HUB,IN_TRANSIT,PENDING,OUT_FOR_DELIVERY' })
      .then((res) => {
        if (!cancelled) setOrderSummary(res?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setOrderSummary(null);
      });
    return () => { cancelled = true; };
  }, []);

  const manifestosAtivos = useMemo(() => manifestos.filter((m) => ACTIVE_MANIFEST_STATUSES.includes(m.status)), [manifestos]);
  const myHubId = user?.hubId;
  const manifestosSaindo = useMemo(() => manifestosAtivos.filter((m) => m.hubId === myHubId), [manifestosAtivos, myHubId]);
  const manifestosRascunho = useMemo(
    () => manifestos.filter((m) => m.status === 'DRAFT' && m.hubId === myHubId),
    [manifestos, myHubId]
  );
  const manifestosChegando = useMemo(
    () =>
      manifestosAtivos.filter(
        (m) => m.hubId !== myHubId && (m.destHubId === myHubId || (m.tripStops ?? []).some((s) => s.destHubId === myHubId))
      ),
    [manifestosAtivos, myHubId]
  );
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

  const flashSuccess = (msg: string) => {
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    setSuccess(msg);
    successTimeoutRef.current = setTimeout(() => setSuccess(null), 3000);
  };

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

  const handleReceiveStop = async (manifestId: string, stopId: string) => {
    if (!window.confirm('Confirmar recebimento desta carga no seu hub?')) return;
    setError(null);
    try {
      await manifestsApi.completeStop(manifestId, stopId);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao confirmar recebimento');
    }
  };

  const handleReceiveManifest = async (manifestId: string) => {
    if (!window.confirm('Confirmar recebimento desta viagem no seu hub?')) return;
    setError(null);
    try {
      await manifestsApi.complete(manifestId);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao confirmar recebimento');
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

      {(tab === 'manifestos' || selectedOrderIds.size > 0) && (
        <div className="fab-up fixed bottom-[74px] left-0 right-0 z-30 px-4 pb-2">
          <button type="button" onClick={() => setShowModal(true)} className="min-h-[48px] w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-700">
            {selectedOrderIds.size > 0 ? `Manifesto (${selectedOrderIds.size})` : '+ Nova viagem'}
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
        {success && (
          <div className="mobile-enter mb-4">
            <InlineNotice variant="success" message={success} onDismiss={() => setSuccess(null)} />
          </div>
        )}
        {loading && <div className="py-16 text-center text-sm text-tower-600 dark:text-tower-300">Carregando...</div>}

        {!loading && tab === 'recebimento' && (
          <div className="space-y-6">
            <HubAwaitingArrivalTab
              onGoEntrada={() => setTab('entrada')}
              onConfirmed={() => void load()}
              onViewOrder={(orderId) => {
                window.location.hash = `#/orders/${orderId}`;
              }}
            />
            <NfeDistribuicaoTriagemTab onConverted={() => void load()} />
          </div>
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
                      
                      <div className="mt-2 text-xs text-tower-600 dark:text-tower-400">
                        <span className="font-semibold text-brand-600 dark:text-brand-400">Custódia:</span> {getOrderCustody(order)}
                      </div>

                      {order.legs && order.legs.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-tower-100 pt-2 dark:border-tower-800">
                          <p className="text-[10px] uppercase font-bold tracking-wider text-tower-500">Jornada de Pernas</p>
                          <div className="space-y-0.5">
                            {order.legs.map((leg: any, idx: number) => {
                              const origin = leg.legType === 'COLETA'
                                ? (order.origemPrestacao ?? order.demand?.origin ?? 'Origem')
                                : (leg.manifest?.hub?.name ?? leg.manifest?.hub?.code ?? 'HUB Origem');
                              const dest = leg.legType === 'ENTREGA'
                                ? (order.fimPrestacao ?? order.demand?.destination ?? 'Destino')
                                : (leg.manifest?.destHub?.name ?? leg.manifest?.destHub?.code ?? 'HUB Destino');
                              const legStatus = leg.completedAt ? 'Concluído' : leg.startedAt ? 'Em andamento' : 'Pendente';
                              const legStatusColor = leg.completedAt ? 'text-green-600 dark:text-green-400' : leg.startedAt ? 'text-brand-600 dark:text-brand-400' : 'text-tower-400';
                              const legTypeName = leg.legType === 'COLETA' ? 'Coleta' : leg.legType === 'TRANSFERENCIA' ? 'Transferência' : 'Entrega';
                              
                              return (
                                <div key={leg.id} className="flex items-center justify-between text-[11px]">
                                  <span className="text-tower-700 dark:text-tower-300">
                                    {idx + 1}. {legTypeName}: {origin} → {dest}
                                  </span>
                                  <span className={`font-medium ${legStatusColor}`}>{legStatus}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
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
            {orderSummary && (
              <p className="text-xs text-tower-600 dark:text-tower-400">
                {orderSummary.totalOrders} pedido(s) · {orderSummary.totalWeightKg.toLocaleString('pt-BR')} kg · {orderSummary.totalVolumeM3.toLocaleString('pt-BR')} m³ · R$ {orderSummary.totalValueBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            )}
            <div className="flex items-center gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar pedidos..." className="h-11 w-full rounded-xl border border-tower-300 bg-white px-3 text-sm text-tower-900 placeholder:text-tower-500 ring-brand-500/30 focus:border-brand-500 focus:outline-none focus:ring-2 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100 dark:placeholder:text-tower-400" />
              <button type="button" onClick={() => setTab('entrada')} className="h-11 min-w-11 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white">+ Nova entrada</button>
            </div>
            <div className="rounded-xl border border-tower-200 bg-tower-50 p-3 dark:border-tower-700 dark:bg-tower-800">
              <p className="mb-2 text-xs font-semibold text-tower-600 dark:text-tower-300">Ou bipe/digite pra selecionar direto:</p>
              <OrderScanInput
                onResolved={(resolved: ResolvedOrderSummary) => {
                  setSelectedOrderIds((prev) => new Set(prev).add(resolved.id));
                  flashSuccess(`Pedido adicionado à seleção (${resolved.id.slice(0, 8)}).`);
                }}
              />
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
                
                <div className="mt-2 text-xs text-tower-600 dark:text-tower-400">
                  <span className="font-semibold text-brand-600 dark:text-brand-400">Custódia:</span> {getOrderCustody(order)}
                </div>

                {orderCargoLine(order)}

                {order.legs && order.legs.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-tower-100 pt-2.5 dark:border-tower-800">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-tower-500">Jornada de Pernas</p>
                    <div className="space-y-1">
                      {order.legs.map((leg: any, idx: number) => {
                        const origin = leg.legType === 'COLETA'
                          ? (order.origemPrestacao ?? order.demand?.origin ?? 'Origem')
                          : (leg.manifest?.hub?.name ?? leg.manifest?.hub?.code ?? 'HUB Origem');
                        const dest = leg.legType === 'ENTREGA'
                          ? (order.fimPrestacao ?? order.demand?.destination ?? 'Destino')
                          : (leg.manifest?.destHub?.name ?? leg.manifest?.destHub?.code ?? 'HUB Destino');
                        const legStatus = leg.completedAt ? 'Concluído' : leg.startedAt ? 'Em andamento' : 'Pendente';
                        const legStatusColor = leg.completedAt ? 'text-green-600 dark:text-green-400' : leg.startedAt ? 'text-brand-600 dark:text-brand-400' : 'text-tower-400';
                        const legTypeName = leg.legType === 'COLETA' ? 'Coleta' : leg.legType === 'TRANSFERENCIA' ? 'Transferência' : 'Entrega';
                        
                        return (
                          <div key={leg.id} className="flex items-center justify-between text-xs">
                            <span className="text-tower-700 dark:text-tower-300">
                              {idx + 1}. {legTypeName}: {origin} → {dest}
                            </span>
                            <span className={`font-medium ${legStatusColor}`}>{legStatus}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
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
          <section className="space-y-6">
            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold text-tower-800 dark:text-tower-100">Rascunhos (aguardando motorista)</h3>
              {manifestosRascunho.length === 0 && (
                <div className="rounded-xl border border-dashed border-tower-300 p-6 text-center text-sm text-tower-600 dark:border-tower-600 dark:text-tower-300">
                  Nenhum manifesto em rascunho.
                </div>
              )}
              {manifestosRascunho.map((m: any) => (
                <ManifestCard key={m.id} m={m} />
              ))}
            </div>

            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold text-tower-800 dark:text-tower-100">Saindo do seu hub</h3>
              {manifestosSaindo.length === 0 && <div className="rounded-xl border border-dashed border-tower-300 p-6 text-center text-sm text-tower-600 dark:border-tower-600 dark:text-tower-300">Nenhuma viagem saindo.</div>}
              {manifestosSaindo.map((m: any) => (
                <ManifestCard key={m.id} m={m} />
              ))}
            </div>

            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold text-tower-800 dark:text-tower-100">Chegando ao seu hub</h3>
              {manifestosChegando.length === 0 && <div className="rounded-xl border border-dashed border-tower-300 p-6 text-center text-sm text-tower-600 dark:border-tower-600 dark:text-tower-300">Nenhuma viagem chegando.</div>}
              {manifestosChegando.map((m: any) => {
                const pendingStopHere = (m.tripStops ?? []).find((s: any) => s.destHubId === myHubId && !s.completedAt);
                const canReceiveLegacy = (!m.tripStops || m.tripStops.length === 0) && m.status === 'IN_PROGRESS';
                return (
                  <ManifestCard key={m.id} m={m}>
                    {m.status === 'IN_PROGRESS' && pendingStopHere && (
                      <button
                        type="button"
                        onClick={() => handleReceiveStop(m.id, pendingStopHere.id)}
                        className="mt-3 w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                      >
                        Marcar recebido
                      </button>
                    )}
                    {canReceiveLegacy && (
                      <button
                        type="button"
                        onClick={() => handleReceiveManifest(m.id)}
                        className="mt-3 w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                      >
                        Marcar recebido
                      </button>
                    )}
                  </ManifestCard>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {showModal && (
        <ManifestModal
          selectedOrders={selectedOrders}
          links={links}
          vehicleTypes={vehicleTypes}
          onClose={() => setShowModal(false)}
          onCreated={(manifestId) => {
            setShowModal(false);
            setSelectedOrderIds(new Set());
            window.location.hash = `#/manifests/${manifestId}`;
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
