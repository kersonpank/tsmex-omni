import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { hubCargoApi, manifestsApi } from '../../lib/api';
import { hubOrderEditPath, isSafeAppPath, parseHubOrderEditId } from '../../lib/hubOrderEditing';
import { manifestStatusLabels, manifestStatusTone } from '../../lib/manifestStatusUi';
import { useAuthStore } from '../../store/authStore';
import { useHubCargoStore } from '../../store/hubCargoStore';
import type { HubCargoCapabilities, HubCargoSummary, Manifest } from '../../types/index';
import EntradaTab from '../admin/EntradaTab';
import InlineNotice from '../ui/InlineNotice';
import BottomNav, { type BottomNavItem } from './BottomNav';
import HubOrdersWorkspace from './hub/HubOrdersWorkspace';
import { HubNavIconHome, HubNavIconManifest, HubNavIconOrders } from './hubNavIcons';

type Tab = 'inicio' | 'pedidos' | 'viagens';
type TripView = 'drafts' | 'outbound' | 'inbound';
type TripFilter = 'all' | 'today' | 'unassigned';
type TripSort = 'recent' | 'schedule' | 'route';

const ACTIVE_MANIFEST_STATUSES = ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'];
const TRIP_PAGE_SIZE = 20;
const TRIP_VIEWS: Array<{ key: TripView; mobileLabel: string; label: string }> = [
  { key: 'drafts', mobileLabel: 'Rascunhos', label: 'Rascunhos' },
  { key: 'outbound', mobileLabel: 'Saindo', label: 'Saindo deste Hub' },
  { key: 'inbound', mobileLabel: 'Chegando', label: 'Chegando a este Hub' },
];
const TRIP_SCROLL_KEY = 'hub-trip-scroll';

const toneClasses: Record<string, string> = {
  neutral: 'tone-neutral',
  info: 'tone-info',
  warning: 'tone-warning',
  success: 'tone-success',
  danger: 'tone-danger',
};

const EMPTY_SUMMARY: HubCargoSummary = {
  stock: {
    orders: 0,
    invoices: 0,
    units: 0,
    realWeightKg: 0,
    cubedWeightKg: 0,
    effectiveWeightKg: 0,
    volumeM3: 0,
    fiscalValueBRL: 0,
    withoutActiveTrip: 0,
  },
  incoming: { orders: 0, trips: 0 },
  awaiting: { demands: 0 },
  triage: { documents: 0 },
};
const EMPTY_CAPABILITIES: HubCargoCapabilities = {
  canViewOrders: false,
  canReceive: false,
  canCreateTrip: false,
};

type HubNavigationState = {
  returnTo?: unknown;
  returnState?: unknown;
  cargoScrollY?: number;
};

function extractArray(response: any): Manifest[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function manifestRoute(manifest: Manifest): string {
  return `${manifest.origin || 'Origem'} → ${manifest.destination || 'Destino'}`;
}

function isTab(value: string | null): value is Tab {
  return value === 'inicio' || value === 'pedidos' || value === 'viagens';
}

function isTripView(value: string | null): value is TripView {
  return value === 'drafts' || value === 'outbound' || value === 'inbound';
}

function isTripFilter(value: string | null): value is TripFilter {
  return value === 'all' || value === 'today' || value === 'unassigned';
}

function isTripSort(value: string | null): value is TripSort {
  return value === 'recent' || value === 'schedule' || value === 'route';
}

function normalizedSearch(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function manifestSchedule(manifest: Manifest, view: TripView): string | null | undefined {
  return view === 'inbound' ? manifest.plannedArrivalAt : manifest.plannedDepartureAt;
}

function isToday(value?: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
}

function filterAndSortTrips(
  manifests: Manifest[],
  view: TripView,
  search: string,
  filter: TripFilter,
  sort: TripSort,
): Manifest[] {
  const term = normalizedSearch(search.trim());
  return manifests
    .filter((manifest) => {
      if (filter === 'today' && !isToday(manifestSchedule(manifest, view))) return false;
      if (filter === 'unassigned' && manifest.driver?.name) return false;
      if (!term) return true;

      const searchable = [
        manifest.id,
        manifest.origin,
        manifest.originCity,
        manifest.originState,
        manifest.destination,
        manifest.destinationCity,
        manifest.destinationState,
        manifest.driver?.name,
        manifest.driver?.document,
        manifest.link?.name,
        manifest.link?.document,
        manifest.link?.vehiclePlate,
        manifest.link?.trailerPlate,
        manifest.link?.trailer2Plate,
        manifest.link?.trailer3Plate,
        ...(manifest.tripStops ?? []).flatMap((stop) => [
          stop.destinationLabel,
          stop.destCity,
          stop.destState,
          stop.destHub?.name,
        ]),
      ];
      return normalizedSearch(searchable.filter(Boolean).join(' ')).includes(term);
    })
    .sort((left, right) => {
      if (sort === 'route') return manifestRoute(left).localeCompare(manifestRoute(right), 'pt-BR');
      if (sort === 'schedule') {
        const leftDate = manifestSchedule(left, view);
        const rightDate = manifestSchedule(right, view);
        if (!leftDate && !rightDate) return 0;
        if (!leftDate) return 1;
        if (!rightDate) return -1;
        return new Date(leftDate).getTime() - new Date(rightDate).getTime();
      }
      return new Date(right.updatedAt ?? right.createdAt).getTime() - new Date(left.updatedAt ?? left.createdAt).getTime();
    });
}

const ManifestCard: React.FC<{
  manifest: Manifest;
  onOpen: () => void;
  onReceiveStop?: (stopId: string) => void;
  onReceiveTrip?: () => void;
}> = ({ manifest, onOpen, onReceiveStop, onReceiveTrip }) => {
  const tone = manifestStatusTone[manifest.status] ?? 'neutral';
  const pendingStop = manifest.tripStops?.find((stop) => !stop.completedAt);
  return (
    <article className="rounded-2xl border border-tower-200 bg-white p-4 dark:border-tower-700 dark:bg-tower-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-tower-950 dark:text-white">
            {manifest.driver?.name ?? manifest.link?.name ?? 'Responsável ainda não definido'}
          </p>
          <p className="mt-1 truncate text-xs text-tower-600 dark:text-tower-300">{manifestRoute(manifest)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${toneClasses[tone]}`}>
          {manifestStatusLabels[manifest.status] ?? manifest.status}
        </span>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-y border-tower-100 py-3 text-xs dark:border-tower-800">
        <div>
          <dt className="text-tower-500">Pedidos</dt>
          <dd className="font-bold text-tower-800 dark:text-tower-100">{manifest.demands?.length ?? 0}</dd>
        </div>
        <div>
          <dt className="text-tower-500">Paradas declaradas</dt>
          <dd className="font-bold text-tower-800 dark:text-tower-100">{manifest.tripStops?.length ?? 0}</dd>
        </div>
        {manifest.plannedDepartureAt && (
          <div>
            <dt className="text-tower-500">Saída programada</dt>
            <dd className="font-bold text-tower-800 dark:text-tower-100">
              {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(manifest.plannedDepartureAt))}
            </dd>
          </div>
        )}
      </dl>

      {pendingStop && (
        <p className="mt-3 text-xs text-tower-600 dark:text-tower-300">
          Próximo ponto: {pendingStop.destHub?.name ?? pendingStop.destinationLabel ?? pendingStop.destCity ?? 'A conferir'}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="admin-focus min-h-11 flex-1 rounded-xl border border-tower-300 px-3 text-sm font-semibold text-tower-700 dark:border-tower-600 dark:text-tower-200"
        >
          Ver viagem
        </button>
        {pendingStop && onReceiveStop && (
          <button type="button" onClick={() => onReceiveStop(pendingStop.id)} className="admin-focus min-h-11 flex-1 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white">
            Confirmar recebimento
          </button>
        )}
        {!pendingStop && onReceiveTrip && (
          <button type="button" onClick={onReceiveTrip} className="admin-focus min-h-11 flex-1 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white">
            Confirmar recebimento
          </button>
        )}
      </div>
    </article>
  );
};

const HubHome: React.FC = () => {
  const { user } = useAuthStore();
  const { setBucket } = useHubCargoStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const viewParam = searchParams.get('view');
  const filterParam = searchParams.get('tripFilter');
  const sortParam = searchParams.get('tripSort');
  const tab: Tab = isTab(tabParam) ? tabParam : 'inicio';
  const tripView: TripView = isTripView(viewParam) ? viewParam : 'drafts';
  const tripFilter: TripFilter = isTripFilter(filterParam) ? filterParam : 'all';
  const tripSort: TripSort = isTripSort(sortParam) ? sortParam : 'recent';
  const tripSearch = searchParams.get('tripSearch') ?? '';
  const requestedEditOrderId = parseHubOrderEditId(searchParams);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [summary, setSummary] = useState<HubCargoSummary>(EMPTY_SUMMARY);
  const [capabilities, setCapabilities] = useState<HubCargoCapabilities>(EMPTY_CAPABILITIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState<{ open: boolean; initialCode?: string }>({ open: false });
  const [visibleLimits, setVisibleLimits] = useState<Record<TripView, number>>({
    drafts: TRIP_PAGE_SIZE,
    outbound: TRIP_PAGE_SIZE,
    inbound: TRIP_PAGE_SIZE,
  });
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<Partial<Record<TripView, HTMLElement | null>>>({});
  const tabButtonRefs = useRef<Partial<Record<TripView, HTMLButtonElement | null>>>({});
  const pagerScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profileHubId = (user?.profile as { hub?: { hubId?: string } } | undefined)?.hub?.hubId;
  const hubId = user?.hubId ?? profileHubId ?? null;

  const updateQuery = useCallback((updates: Record<string, string | null>, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(updates).forEach(([key, value]) => {
        if (value == null || value === '') next.delete(key);
        else next.set(key, value);
      });
      return next;
    }, { replace });
  }, [setSearchParams]);

  const changeTab = useCallback((nextTab: Tab) => {
    updateQuery({ tab: nextTab === 'inicio' ? null : nextTab });
  }, [updateQuery]);

  const changeTripView = useCallback((nextView: TripView, focusTab = false) => {
    updateQuery({ tab: 'viagens', view: nextView === 'drafts' ? null : nextView });
    if (focusTab) window.requestAnimationFrame(() => tabButtonRefs.current[nextView]?.focus());
  }, [updateQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [manifestResult, summaryResult] = await Promise.allSettled([
      manifestsApi.list({}),
      hubCargoApi.summary(hubId ?? undefined),
    ]);
    if (manifestResult.status === 'fulfilled') {
      setManifests(extractArray(manifestResult.value));
    } else {
      setManifests([]);
      setError((manifestResult.reason as any)?.response?.data?.error || 'Não foi possível carregar as viagens.');
    }
    if (summaryResult.status === 'fulfilled') {
      setSummary(summaryResult.value.data);
      setCapabilities(summaryResult.value.capabilities ?? EMPTY_CAPABILITIES);
    } else {
      setCapabilities(EMPTY_CAPABILITIES);
      setError((summaryResult.reason as any)?.response?.data?.error || 'Não foi possível carregar a operação do Hub.');
    }
    setLoading(false);
  }, [hubId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeManifests = useMemo(
    () => manifests.filter((manifest) => ACTIVE_MANIFEST_STATUSES.includes(manifest.status)),
    [manifests],
  );
  const drafts = useMemo(
    () => manifests.filter((manifest) => manifest.status === 'DRAFT' && manifest.hubId === hubId),
    [hubId, manifests],
  );
  const outbound = useMemo(
    () => activeManifests.filter((manifest) => manifest.hubId === hubId),
    [activeManifests, hubId],
  );
  const inbound = useMemo(
    () =>
      activeManifests.filter(
        (manifest) =>
          manifest.hubId !== hubId &&
          (manifest.destHubId === hubId ||
            (manifest.tripStops ?? []).some((stop) => stop.destHubId === hubId && !stop.completedAt)),
      ),
    [activeManifests, hubId],
  );

  const tripsByView = useMemo<Record<TripView, Manifest[]>>(() => ({
    drafts,
    outbound,
    inbound,
  }), [drafts, inbound, outbound]);

  const filteredTripsByView = useMemo<Record<TripView, Manifest[]>>(() => ({
    drafts: filterAndSortTrips(drafts, 'drafts', tripSearch, tripFilter, tripSort),
    outbound: filterAndSortTrips(outbound, 'outbound', tripSearch, tripFilter, tripSort),
    inbound: filterAndSortTrips(inbound, 'inbound', tripSearch, tripFilter, tripSort),
  }), [drafts, inbound, outbound, tripFilter, tripSearch, tripSort]);

  useEffect(() => {
    setVisibleLimits({
      drafts: TRIP_PAGE_SIZE,
      outbound: TRIP_PAGE_SIZE,
      inbound: TRIP_PAGE_SIZE,
    });
  }, [tripFilter, tripSearch, tripSort]);

  useEffect(() => {
    if (tab !== 'viagens' || loading) return;
    const returnedScrollPositions = (
      location.state as { tripScrollPositions?: Partial<Record<TripView, number>> } | null
    )?.tripScrollPositions;
    const pager = pagerRef.current;
    const index = TRIP_VIEWS.findIndex((item) => item.key === tripView);
    if (pager && index >= 0) {
      pager.scrollTo({ left: pager.clientWidth * index, behavior: 'auto' });
    }

    TRIP_VIEWS.forEach(({ key }) => {
      const panel = panelRefs.current[key];
      const saved = returnedScrollPositions?.[key]
        ?? Number(window.sessionStorage.getItem(`${TRIP_SCROLL_KEY}:${key}`) ?? 0);
      if (panel && saved > 0) panel.scrollTop = saved;
    });
  }, [loading, location.state, tab, tripView]);

  useEffect(() => () => {
    if (pagerScrollTimerRef.current) clearTimeout(pagerScrollTimerRef.current);
  }, []);

  const saveTripScrollPositions = useCallback((): Partial<Record<TripView, number>> => {
    const positions: Partial<Record<TripView, number>> = {};
    TRIP_VIEWS.forEach(({ key }) => {
      const panel = panelRefs.current[key];
      if (panel) {
        positions[key] = panel.scrollTop;
        window.sessionStorage.setItem(`${TRIP_SCROLL_KEY}:${key}`, String(panel.scrollTop));
      }
    });
    return positions;
  }, []);

  const currentReturnTo = `${location.pathname}${location.search}`;
  const editOrderId = capabilities.canReceive ? requestedEditOrderId : null;
  const entryContextOpen = manualEntry.open || Boolean(editOrderId);

  useEffect(() => {
    if (loading || !requestedEditOrderId || capabilities.canReceive) return;
    setError('Você não tem permissão de Entrada para editar pedidos neste Hub.');
    updateQuery({ mode: null, orderId: null });
  }, [capabilities.canReceive, loading, requestedEditOrderId, updateQuery]);

  useEffect(() => {
    if (loading || tab !== 'pedidos' || entryContextOpen) return;
    const state = (location.state ?? null) as HubNavigationState | null;
    if (typeof state?.cargoScrollY !== 'number') return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: state.cargoScrollY, behavior: 'auto' });
    });
  }, [entryContextOpen, loading, location.state, tab]);

  const openOrder = useCallback((orderId: string) => {
    navigate(`/orders/${orderId}`, {
      state: {
        returnTo: currentReturnTo,
        cargoScrollY: window.scrollY,
      },
    });
  }, [currentReturnTo, navigate]);

  // Pós-"Confirmar entrada física": pula "Ver pedido" → "Editar pedido" (2 cliques) e vai direto
  // pra edição — o pedido acabou de nascer com origem/destino/pessoas pré-preenchidos da NF-e,
  // só falta o humano conferir/completar o que a varredura não trouxe.
  const editOrderAfterArrival = useCallback((orderId: string) => {
    navigate(hubOrderEditPath(orderId), {
      state: {
        returnTo: currentReturnTo,
        cargoScrollY: window.scrollY,
      },
    });
  }, [currentReturnTo, navigate]);

  const closeEntryContext = useCallback(() => {
    setManualEntry({ open: false });
    if (!editOrderId) return;

    const state = (location.state ?? null) as HubNavigationState | null;
    if (isSafeAppPath(state?.returnTo)) {
      navigate(state.returnTo, {
        replace: true,
        state: state.returnState,
      });
      return;
    }
    updateQuery({ tab: 'pedidos', mode: null, orderId: null });
  }, [editOrderId, location.state, navigate, updateQuery]);

  const openManifest = useCallback((manifestId: string) => {
    const tripScrollPositions = saveTripScrollPositions();
    navigate(`/manifests/${manifestId}`, {
      state: { returnTo: currentReturnTo, tripScrollPositions },
    });
  }, [currentReturnTo, navigate, saveTripScrollPositions]);

  const goToCargo = (bucket: 'stock' | 'incoming' | 'awaiting' | 'triage') => {
    setBucket(bucket);
    changeTab('pedidos');
  };

  const createTrip = (orderIds: string[] = []) => {
    const suffix = orderIds.length > 0 ? `?orders=${encodeURIComponent(orderIds.join(','))}` : '';
    const tripScrollPositions = saveTripScrollPositions();
    navigate(`/manifests/new${suffix}`, {
      state: { returnTo: currentReturnTo, tripScrollPositions },
    });
  };

  const scrollToTripView = (nextView: TripView, focusTab = false) => {
    const pager = pagerRef.current;
    const index = TRIP_VIEWS.findIndex((item) => item.key === nextView);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (pager && index >= 0) {
      pager.scrollTo({
        left: pager.clientWidth * index,
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    }
    changeTripView(nextView, focusTab);
  };

  const handlePagerScroll = () => {
    if (pagerScrollTimerRef.current) clearTimeout(pagerScrollTimerRef.current);
    pagerScrollTimerRef.current = setTimeout(() => {
      const pager = pagerRef.current;
      if (!pager?.clientWidth) return;
      const index = Math.max(0, Math.min(TRIP_VIEWS.length - 1, Math.round(pager.scrollLeft / pager.clientWidth)));
      const nextView = TRIP_VIEWS[index].key;
      if (nextView !== tripView) changeTripView(nextView);
    }, 100);
  };

  const handleTripTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentView: TripView) => {
    const currentIndex = TRIP_VIEWS.findIndex((item) => item.key === currentView);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      scrollToTripView(TRIP_VIEWS[(currentIndex + 1) % TRIP_VIEWS.length].key, true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      scrollToTripView(TRIP_VIEWS[(currentIndex - 1 + TRIP_VIEWS.length) % TRIP_VIEWS.length].key, true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      scrollToTripView(TRIP_VIEWS[0].key, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      scrollToTripView(TRIP_VIEWS[TRIP_VIEWS.length - 1].key, true);
    }
  };

  const receiveStop = async (manifestId: string, stopId: string) => {
    if (!window.confirm('Confirmar que esta carga chegou fisicamente ao seu Hub?')) return;
    setError(null);
    try {
      await manifestsApi.completeStop(manifestId, stopId);
      setSuccess('Recebimento da parada confirmado.');
      await load();
    } catch (cause: any) {
      setError(cause.response?.data?.error || cause.message || 'Não foi possível confirmar o recebimento.');
    }
  };

  const receiveManifest = async (manifestId: string) => {
    if (!window.confirm('Confirmar que esta viagem chegou fisicamente ao seu Hub?')) return;
    setError(null);
    try {
      await manifestsApi.complete(manifestId);
      setSuccess('Recebimento da viagem confirmado.');
      await load();
    } catch (cause: any) {
      setError(cause.response?.data?.error || cause.message || 'Não foi possível confirmar o recebimento.');
    }
  };

  const navItems: BottomNavItem[] = [
    { key: 'inicio', label: 'Início', icon: <HubNavIconHome /> },
    {
      key: 'pedidos',
      label: 'Pedidos',
      icon: <HubNavIconOrders />,
      badge: summary.awaiting.demands + summary.triage.documents || undefined,
    },
    { key: 'viagens', label: 'Viagens', icon: <HubNavIconManifest />, badge: activeManifests.length || undefined },
  ];

  return (
    <div className="min-h-screen bg-[var(--app-page-bg)] pb-24">
      <main key={`${tab}-${entryContextOpen ? editOrderId ?? 'new' : 'list'}`} className="mobile-enter mx-auto max-w-6xl p-4">
        {error && <div className="mb-4"><InlineNotice variant="error" message={error} onDismiss={() => setError(null)} /></div>}
        {success && <div className="mb-4"><InlineNotice variant="success" message={success} onDismiss={() => setSuccess(null)} /></div>}
        {loading && <div className="py-20 text-center text-sm text-tower-500">Carregando operação...</div>}

        {!loading && tab === 'inicio' && (
          <section className="space-y-6" aria-labelledby="home-title">
            <header>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-300">Cenário agora</p>
              <h1 id="home-title" className="mt-1 text-2xl font-bold tracking-tight text-tower-950 dark:text-white">O que precisa da sua atenção</h1>
            </header>

            <div className="overflow-hidden rounded-2xl border border-tower-200 bg-white dark:border-tower-700 dark:bg-tower-900">
              <button type="button" onClick={() => goToCargo('stock')} className="admin-focus flex min-h-[76px] w-full items-center justify-between gap-4 border-b border-tower-200 px-4 py-3 text-left hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-800">
                <span>
                  <span className="block text-sm font-bold text-tower-900 dark:text-tower-100">Estoque disponível</span>
                  <span className="mt-0.5 block text-xs text-tower-500">{summary.stock.withoutActiveTrip} sem viagem ativa · {summary.stock.realWeightKg.toLocaleString('pt-BR')} kg</span>
                </span>
                <span className="text-2xl font-extrabold tabular-nums text-brand-700 dark:text-brand-300">{summary.stock.orders}</span>
              </button>
              <button type="button" onClick={() => goToCargo('incoming')} className="admin-focus flex min-h-[76px] w-full items-center justify-between gap-4 border-b border-tower-200 px-4 py-3 text-left hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-800">
                <span>
                  <span className="block text-sm font-bold text-tower-900 dark:text-tower-100">Cargas a caminho</span>
                  <span className="mt-0.5 block text-xs text-tower-500">{summary.incoming.trips} {summary.incoming.trips === 1 ? 'viagem prevista' : 'viagens previstas'}</span>
                </span>
                <span className="text-2xl font-extrabold tabular-nums text-blue-700 dark:text-blue-300">{summary.incoming.orders}</span>
              </button>
              <button type="button" onClick={() => goToCargo('awaiting')} className="admin-focus flex min-h-[76px] w-full items-center justify-between gap-4 border-b border-tower-200 px-4 py-3 text-left hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-800">
                <span>
                  <span className="block text-sm font-bold text-tower-900 dark:text-tower-100">Aguardando entrada física</span>
                  <span className="mt-0.5 block text-xs text-tower-500">Notas conhecidas que ainda não entraram no estoque</span>
                </span>
                <span className="text-2xl font-extrabold tabular-nums text-amber-700 dark:text-amber-300">{summary.awaiting.demands}</span>
              </button>
              <button type="button" onClick={() => goToCargo('triage')} className="admin-focus flex min-h-[76px] w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-tower-50 dark:hover:bg-tower-800">
                <span>
                  <span className="block text-sm font-bold text-tower-900 dark:text-tower-100">Pendências fiscais</span>
                  <span className="mt-0.5 block text-xs text-tower-500">Documentos que precisam ser preparados para entrada</span>
                </span>
                <span className="text-2xl font-extrabold tabular-nums text-rose-700 dark:text-rose-300">{summary.triage.documents}</span>
              </button>
            </div>

            <div>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-tower-900 dark:text-tower-100">Próximas viagens</h2>
                  <p className="text-xs text-tower-500">Saídas e chegadas que movimentam este Hub.</p>
                </div>
                <button type="button" onClick={() => changeTab('viagens')} className="admin-focus min-h-11 rounded-xl px-2 text-sm font-semibold text-brand-700 dark:text-brand-300">Ver todas</button>
              </div>
              {activeManifests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-tower-300 p-6 text-center dark:border-tower-600">
                  <p className="text-sm font-semibold text-tower-700 dark:text-tower-200">Nenhuma viagem ativa agora.</p>
                  <button type="button" onClick={() => createTrip()} className="admin-focus mt-3 min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">Criar viagem</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeManifests.slice(0, 3).map((manifest) => (
                    <ManifestCard key={manifest.id} manifest={manifest} onOpen={() => openManifest(manifest.id)} />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {!loading && tab === 'pedidos' && !entryContextOpen && (
          <HubOrdersWorkspace
            hubId={hubId}
            onOpenOrder={openOrder}
            onEditOrderAfterArrival={editOrderAfterArrival}
            onOpenTrip={openManifest}
            onCreateTrip={createTrip}
            onOpenManualEntry={(initialCode) => setManualEntry({ open: true, initialCode })}
            onSummaryChanged={setSummary}
          />
        )}

        {!loading && tab === 'pedidos' && entryContextOpen && (
          <EntradaTab
            mobileWizard
            startCreating={manualEntry.open}
            initialOrderId={editOrderId ?? undefined}
            initialNfeCode={manualEntry.initialCode}
            onCancelContext={closeEntryContext}
            onCreated={() => setSuccess('Pedido-base criado. Continue nesta tela para completar os dados da carga.')}
          />
        )}

        {!loading && tab === 'viagens' && (
          <section className="space-y-4 pb-20" aria-labelledby="trips-title">
            <header className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-300">Programação</p>
                <h1 id="trips-title" className="mt-1 text-2xl font-bold tracking-tight text-tower-950 dark:text-white">Viagens</h1>
                <p className="mt-1 text-sm text-tower-500">Acompanhe cada movimento sem perder o contexto.</p>
              </div>
              <button type="button" onClick={() => createTrip()} className="admin-focus hidden min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white sm:block">+ Nova viagem</button>
            </header>

            <div
              role="tablist"
              aria-label="Situação das viagens"
              className="grid grid-cols-3 rounded-2xl border border-tower-200 bg-tower-100/80 p-1 dark:border-tower-700 dark:bg-tower-900"
            >
              {TRIP_VIEWS.map((item) => {
                const active = tripView === item.key;
                return (
                  <button
                    key={item.key}
                    ref={(element) => { tabButtonRefs.current[item.key] = element; }}
                    id={`trip-tab-${item.key}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`trip-panel-${item.key}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => scrollToTripView(item.key)}
                    onKeyDown={(event) => handleTripTabKeyDown(event, item.key)}
                    className={`admin-focus relative min-h-12 rounded-xl px-2 text-xs font-bold transition-[background-color,color,box-shadow] sm:text-sm ${
                      active
                        ? 'bg-white text-brand-700 shadow-sm dark:bg-tower-800 dark:text-brand-300'
                        : 'text-tower-500 hover:text-tower-800 dark:text-tower-400 dark:hover:text-tower-100'
                    }`}
                  >
                    <span className="sm:hidden">{item.mobileLabel}</span>
                    <span className="hidden sm:inline">{item.label}</span>
                    <span className={`ml-1.5 inline-flex min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                      active
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200'
                        : 'bg-tower-200/80 text-tower-600 dark:bg-tower-700 dark:text-tower-300'
                    }`}>
                      {tripsByView[item.key].length > 99 ? '99+' : tripsByView[item.key].length}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-3 rounded-2xl border border-tower-200 bg-white p-3 dark:border-tower-700 dark:bg-tower-900">
              <div className="flex gap-2">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Buscar viagens</span>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tower-400">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    value={tripSearch}
                    onChange={(event) => updateQuery({ tripSearch: event.target.value || null })}
                    placeholder="Buscar rota, motorista ou placa"
                    className="admin-focus min-h-11 w-full rounded-xl border border-tower-200 bg-tower-50 py-2 pl-9 pr-3 text-sm text-tower-900 placeholder:text-tower-400 dark:border-tower-700 dark:bg-tower-950 dark:text-tower-100"
                  />
                </label>
                <label>
                  <span className="sr-only">Ordenar viagens</span>
                  <select
                    value={tripSort}
                    onChange={(event) => updateQuery({ tripSort: event.target.value === 'recent' ? null : event.target.value })}
                    className="admin-focus min-h-11 max-w-[8.75rem] rounded-xl border border-tower-200 bg-tower-50 px-2 text-xs font-semibold text-tower-700 dark:border-tower-700 dark:bg-tower-950 dark:text-tower-200 sm:max-w-none sm:text-sm"
                  >
                    <option value="recent">Mais recentes</option>
                    <option value="schedule">Por programação</option>
                    <option value="route">Por percurso</option>
                  </select>
                </label>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar" aria-label="Filtros rápidos">
                {([
                  ['all', 'Todas'],
                  ['today', 'Programadas hoje'],
                  ['unassigned', 'Sem motorista'],
                ] as Array<[TripFilter, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={tripFilter === key}
                    onClick={() => updateQuery({ tripFilter: key === 'all' ? null : key })}
                    className={`admin-focus min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold ${
                      tripFilter === key
                        ? 'border-brand-600 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-200'
                        : 'border-tower-200 text-tower-600 hover:border-tower-300 dark:border-tower-700 dark:text-tower-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div
              ref={pagerRef}
              onScroll={handlePagerScroll}
              className="no-scrollbar flex h-[calc(100dvh-20rem)] min-h-80 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
            >
              {TRIP_VIEWS.map((item) => {
                const filtered = filteredTripsByView[item.key];
                const visible = filtered.slice(0, visibleLimits[item.key]);
                return (
                  <section
                    key={item.key}
                    ref={(element) => { panelRefs.current[item.key] = element; }}
                    id={`trip-panel-${item.key}`}
                    role="tabpanel"
                    aria-labelledby={`trip-tab-${item.key}`}
                    aria-hidden={tripView !== item.key}
                    inert={tripView !== item.key}
                    tabIndex={tripView === item.key ? 0 : -1}
                    onScroll={(event) => {
                      window.sessionStorage.setItem(`${TRIP_SCROLL_KEY}:${item.key}`, String(event.currentTarget.scrollTop));
                    }}
                    className="h-full w-full shrink-0 snap-start snap-always overflow-y-auto overscroll-y-contain px-0.5 pb-28 pt-1"
                  >
                    <TripGroup
                      empty={
                        item.key === 'drafts'
                          ? 'Nenhuma viagem em preparação.'
                          : item.key === 'outbound'
                            ? 'Nenhuma saída ativa.'
                            : 'Nenhuma viagem a caminho.'
                      }
                      filtered={visible}
                      filteredTotal={filtered.length}
                      categoryTotal={tripsByView[item.key].length}
                      onOpen={openManifest}
                      onLoadMore={
                        visible.length < filtered.length
                          ? () => setVisibleLimits((current) => ({
                            ...current,
                            [item.key]: current[item.key] + TRIP_PAGE_SIZE,
                          }))
                          : undefined
                      }
                      render={item.key === 'inbound' ? (manifest) => {
                        const pendingStop = manifest.tripStops?.find((stop) => stop.destHubId === hubId && !stop.completedAt);
                        const legacyArrival = (!manifest.tripStops || manifest.tripStops.length === 0) && manifest.status === 'IN_PROGRESS';
                        return (
                          <ManifestCard
                            key={manifest.id}
                            manifest={manifest}
                            onOpen={() => openManifest(manifest.id)}
                            onReceiveStop={pendingStop ? (stopId) => void receiveStop(manifest.id, stopId) : undefined}
                            onReceiveTrip={legacyArrival ? () => void receiveManifest(manifest.id) : undefined}
                          />
                        );
                      } : undefined}
                    />
                  </section>
                );
              })}
            </div>

            <button type="button" onClick={() => createTrip()} className="admin-focus fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-4 right-4 z-30 min-h-12 rounded-xl bg-brand-600 text-sm font-bold text-white shadow-xl sm:hidden">
              + Nova viagem
            </button>
          </section>
        )}
      </main>

      <BottomNav items={navItems} active={tab} onChange={(key) => {
        setManualEntry({ open: false });
        updateQuery({
          tab: key === 'inicio' ? null : key,
          mode: null,
          orderId: null,
        });
      }} />
    </div>
  );
};

const TripGroup: React.FC<{
  empty: string;
  filtered: Manifest[];
  filteredTotal: number;
  categoryTotal: number;
  onOpen: (manifestId: string) => void;
  onLoadMore?: () => void;
  render?: (manifest: Manifest) => React.ReactNode;
}> = ({ empty, filtered, filteredTotal, categoryTotal, onOpen, onLoadMore, render }) => (
  <div>
    <p className="mb-3 text-xs font-medium text-tower-500" aria-live="polite">
      {filteredTotal === categoryTotal
        ? `${categoryTotal} ${categoryTotal === 1 ? 'viagem' : 'viagens'}`
        : `${filteredTotal} de ${categoryTotal} viagens`}
    </p>
    {filtered.length === 0 ? (
      <div className="rounded-2xl border border-dashed border-tower-300 p-7 text-center dark:border-tower-600">
        <p className="text-sm font-semibold text-tower-700 dark:text-tower-200">
          {categoryTotal === 0 ? empty : 'Nenhuma viagem corresponde aos filtros.'}
        </p>
        {categoryTotal > 0 && <p className="mt-1 text-xs text-tower-500">Ajuste a busca ou os filtros rápidos.</p>}
      </div>
    ) : (
      <div className="space-y-3">
        {filtered.map((manifest) => render?.(manifest) ?? (
          <ManifestCard key={manifest.id} manifest={manifest} onOpen={() => onOpen(manifest.id)} />
        ))}
        {onLoadMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="admin-focus min-h-11 w-full rounded-xl border border-tower-300 bg-white px-4 text-sm font-bold text-tower-700 hover:bg-tower-50 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-200 dark:hover:bg-tower-800"
          >
            Carregar mais viagens
          </button>
        )}
      </div>
    )}
  </div>
);

export default HubHome;
