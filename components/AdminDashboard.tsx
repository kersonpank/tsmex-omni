import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { demandsApi } from '../lib/api';
import { demandStatusLabels, demandStatusTones } from '../lib/demandStatusUi';
import { useAuthStore } from '../store/authStore';
import type { Demand, DemandStatus, PaginatedResponse } from '../types/index';
import SettingsLLM from './settings/SettingsLLM';
import EspeciesTab from './admin/EspeciesTab';
import CommercialTab from './CommercialTab';
import TransportTab from './transport/TransportTab';
import PessoasTab from './admin/PessoasTab';
import HubsTab from './admin/HubsTab';
import ManifestsTab from './admin/ManifestsTab';
import PedidosTab from './admin/PedidosTab';
import ClientesTab from './admin/ClientesTab';
import MotoristasTab from './admin/MotoristasTab';
import FrotaTab from './admin/FrotaTab';
import FaturasTab from './admin/FaturasTab';
import EntradaTab from './admin/EntradaTab';
import TarifasTab from './commercial/TarifasTab';
import AdminShell from './admin/layout/AdminShell';
import {
  GestaoModuleActionsProvider,
  useRegisterGestaoModuleActions,
  type ModuleActionConfig,
} from './admin/layout/GestaoModuleActionsContext';
import { buildAdminNavSections } from './admin/layout/adminNavModel';
import {
  adminStateToSearchParams,
  canonicalSearchParamsForGestao,
  gestaoSearchParamsSignature,
  getAdminBreadcrumbs,
  getAdminPageTitle,
  parseAdminSearchParams,
  type AdminNavState,
} from './admin/layout/adminQuery';
import EmptyState from './ui/EmptyState';
import ErrorPanel from './ui/ErrorPanel';
import InlineNotice from './ui/InlineNotice';
import LoadingPanel from './ui/LoadingPanel';
import StatusBadge from './ui/StatusBadge';
import OperationsCockpit from './admin/dashboard/OperationsCockpit';
import { useOperationsSummary } from './admin/dashboard/useOperationsSummary';
import SistemaConfiguracoesLayout from './admin/SistemaConfiguracoesLayout';
import IdentidadeVisualTab from './admin/IdentidadeVisualTab';

const PAGE_SIZE = 15;

/** Registra ações da visão Demandas dentro do provider (hooks não podem ficar fora dele). */
function RegisterDemandsGestaoActions({ config }: { config: ModuleActionConfig | null }) {
  useRegisterGestaoModuleActions(() => config, [config]);
  return null;
}

const AdminDashboard: React.FC = () => {
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const isAdmin = user?.roles?.includes('ADMIN') ?? false;
  const canAccessCommercial = isAdmin && !isHub;
  const hubPermissions = (user?.profile as { hub?: { permissions?: string[] } })?.hub?.permissions ?? (user as { permissions?: string[] })?.permissions ?? [];
  const hasPermission = useCallback(
    (p: string) => !isHub || hubPermissions.length === 0 || hubPermissions.includes(p),
    [isHub, hubPermissions]
  );

  const location = useLocation();
  const navigate = useNavigate();

  const navState = useMemo(
    () => parseAdminSearchParams(new URLSearchParams(location.search), isHub, hasPermission),
    [location.search, isHub, hasPermission]
  );

  /** URL da barra pode ter `sub` inválido para HUB; parse cai no fallback mas query não — alinha com `navigate` (mesmo escritor que `setNavState`). */
  useLayoutEffect(() => {
    if (location.pathname !== '/gestao') return;
    const current = new URLSearchParams(location.search);
    const canonical = canonicalSearchParamsForGestao(current, isHub, hasPermission);
    if (gestaoSearchParamsSignature(current) !== gestaoSearchParamsSignature(canonical)) {
      const q = canonical.toString();
      navigate({ pathname: '/gestao', search: q ? `?${q}` : '' }, { replace: true });
    }
  }, [location.pathname, location.search, isHub, hasPermission, navigate]);

  const setNavState = useCallback(
    (patch: Partial<AdminNavState>) => {
      const current = parseAdminSearchParams(new URLSearchParams(location.search), isHub, hasPermission);
      let next: AdminNavState = { ...current, ...patch };
      if (next.category !== 'transport' || next.transportSubTab !== 'entrada') {
        next = { ...next, entradaOrderId: null };
      }
      const sp = adminStateToSearchParams(next, isHub);
      const q = sp.toString();
      navigate({ pathname: '/gestao', search: q ? `?${q}` : '' }, { replace: true });
    },
    [isHub, hasPermission, location.search, navigate]
  );

  const hubContextLine = useMemo(() => {
    if (!isHub) return null;
    const hub = (user?.profile as { hub?: { name?: string; code?: string } })?.hub;
    const name = hub?.name ?? hub?.code;
    return name ? `Depósito: ${name}` : 'Modo operador de hub';
  }, [isHub, user?.profile]);

  const navSections = useMemo(
    () =>
      buildAdminNavSections({
        navState,
        isHub,
        hasPermission,
        onOrderDetailPage: false,
        onSelectNav: (patch) => setNavState(patch),
      }),
    [navState, isHub, hasPermission, setNavState]
  );

  const isDemandsView = navState.category === 'transport' && navState.transportSubTab === 'demands';

  const [demands, setDemands] = useState<Demand[]>([]);
  const [totalDemands, setTotalDemands] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDemand, setSelectedDemand] = useState<Demand | null>(null);
  const [quotePrice, setQuotePrice] = useState('');
  const [apiStatus, setApiStatus] = useState<string>('');
  const [intentType, setIntentType] = useState<'' | 'QUOTE_ONLY' | 'COLLECT' | 'DROP_AT_HUB'>('');
  const [destFilter, setDestFilter] = useState('');
  const [textQ, setTextQ] = useState('');
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<{ variant: 'error' | 'success' | 'info'; message: string } | null>(null);
  const [demandasGestaoFilterOpen, setDemandasGestaoFilterOpen] = useState(false);
  const [demandasGestaoSelectedId, setDemandasGestaoSelectedId] = useState<string | null>(null);

  const {
    data: operationsSummary,
    loading: summaryLoading,
    error: summaryError,
    refresh: refreshOperationsSummary,
  } = useOperationsSummary(isDemandsView);

  useEffect(() => {
    setPage(0);
  }, [apiStatus, destFilter, intentType]);

  const loadDemands = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = (await demandsApi.list({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(apiStatus ? { status: apiStatus } : {}),
        ...(intentType ? { intentType } : {}),
        ...(destFilter.trim() ? { destination: destFilter.trim() } : {}),
      })) as PaginatedResponse<Demand>;
      const list = Array.isArray(res?.data) ? res.data : [];
      const total = res?.pagination?.total ?? list.length;
      setDemands(list);
      setTotalDemands(total);
    } catch (err: unknown) {
      console.error(err);
      const msg = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data?.error : undefined;
      setError(msg || 'Erro ao carregar demandas');
    } finally {
      setLoading(false);
    }
  }, [page, apiStatus, destFilter, intentType]);

  useEffect(() => {
    if (isDemandsView) void loadDemands();
  }, [isDemandsView, loadDemands]);

  const displayedDemands = useMemo(() => {
    const q = textQ.trim().toLowerCase();
    if (!q) return demands;
    return demands.filter((d) => {
      const clientName = d.client?.companyName?.toLowerCase() ?? '';
      return (
        d.origin.toLowerCase().includes(q) ||
        d.destination.toLowerCase().includes(q) ||
        d.commodity.toLowerCase().includes(q) ||
        d.nfNumber.toLowerCase().includes(q) ||
        clientName.includes(q)
      );
    });
  }, [demands, textQ]);

  const stats = useMemo(() => {
    const src = displayedDemands;
    return {
      inTransit: src.filter((d) => d.status === 'IN_TRANSIT').length,
      highRisk: src.filter((d) => d.riskClass === 'A').length,
      pending: src.filter((d) => d.status === 'PENDING').length,
      totalValue: src.reduce((acc, d) => acc + (d.quotedPrice || 0), 0),
      count: src.length,
    };
  }, [displayedDemands]);

  const totalPages = Math.max(1, Math.ceil(totalDemands / PAGE_SIZE));

  const handleQuote = async () => {
    if (!selectedDemand || !quotePrice) return;
    try {
      await demandsApi.quote(selectedDemand.id, { price: parseFloat(quotePrice) });
      setSelectedDemand(null);
      setQuotePrice('');
      setDemandasGestaoSelectedId(null);
      setNotice({ variant: 'success', message: 'Cotação enviada com sucesso.' });
      await loadDemands();
      void refreshOperationsSummary();
    } catch (err: unknown) {
      console.error(err);
      const msg =
        err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data?.error : undefined;
      setNotice({ variant: 'error', message: msg || 'Erro ao enviar cotação.' });
    }
  };

  const advanceStatus = async (demand: Demand) => {
    const statusFlow: DemandStatus[] = [
      'QUOTED',
      'APPROVED',
      'COLLECTED',
      'IN_TRANSIT',
      'AT_HUB',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ];
    const currentIndex = statusFlow.indexOf(demand.status);
    if (currentIndex < statusFlow.length - 1) {
      const nextStatus = statusFlow[currentIndex + 1];
      try {
        await demandsApi.updateStatus(demand.id, {
          status: nextStatus,
          description: `Status atualizado para ${demandStatusLabels[nextStatus]}`,
        });
        setNotice({ variant: 'success', message: `Status: ${demandStatusLabels[nextStatus]}.` });
        await loadDemands();
        void refreshOperationsSummary();
      } catch (err: unknown) {
        console.error(err);
        const msg =
          err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data?.error : undefined;
        setNotice({ variant: 'error', message: msg || 'Erro ao atualizar status.' });
      }
    }
  };

  const { title: pageTitle, subtitle: pageSubtitle } = getAdminPageTitle(navState, isHub);
  const breadcrumbs = getAdminBreadcrumbs(navState, isHub);

  const listLoading = isDemandsView && loading;
  const listError = isDemandsView && error;

  const intentFilterLabels: Record<string, string> = {
    QUOTE_ONLY: 'Cotação',
    COLLECT: 'Coleta',
    DROP_AT_HUB: 'Entrega no hub',
  };

  const demandsGestaoConfig = useMemo(() => {
    if (!isDemandsView) return null;
    const selectedRow = displayedDemands.find((d) => d.id === demandasGestaoSelectedId);
    const canQuoteFromBar = Boolean(!isHub && selectedRow && selectedRow.status === 'PENDING');
    const filterCount =
      (apiStatus ? 1 : 0) + (intentType ? 1 : 0) + (destFilter.trim() ? 1 : 0) + (textQ.trim() ? 1 : 0);
    const pills = [
      ...(apiStatus
        ? [
            {
              id: 'api-st',
              label: `Status: ${demandStatusLabels[apiStatus as DemandStatus] ?? apiStatus}`,
              onRemove: () => setApiStatus(''),
            },
          ]
        : []),
      ...(intentType
        ? [
            {
              id: 'int',
              label: `Intenção: ${intentFilterLabels[intentType] ?? intentType}`,
              onRemove: () => setIntentType(''),
            },
          ]
        : []),
      ...(destFilter.trim()
        ? [{ id: 'dest', label: `Destino: ${destFilter.trim()}`, onRemove: () => setDestFilter('') }]
        : []),
      ...(textQ.trim()
        ? [{ id: 'tx', label: `Texto: ${textQ.trim()}`, onRemove: () => setTextQ('') }]
        : []),
    ];
    return {
      listActive: !demandasGestaoFilterOpen && !selectedDemand,
      filterOpen: demandasGestaoFilterOpen,
      filterCount,
      pills,
      hidden: isHub ? ({ new: true } as const) : undefined,
      onList: () => {
        setDemandasGestaoFilterOpen(false);
        setSelectedDemand(null);
        setQuotePrice('');
        setPage(0);
        void loadDemands();
        document.getElementById('demandas-lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setDemandasGestaoFilterOpen((v) => !v),
      onEdit: canQuoteFromBar
        ? () => {
            if (selectedRow) setSelectedDemand(selectedRow);
          }
        : undefined,
      onNew: !isHub
        ? () => {
            window.location.hash = '#/chat/demo';
          }
        : undefined,
      disabled: {
        edit: !canQuoteFromBar,
      } as const,
      labels: {
        edit: canQuoteFromBar
          ? 'Cotar demanda selecionada (pendente)'
          : demandasGestaoSelectedId
            ? isHub
              ? 'No hub, use os botões do card (avançar status, tracking).'
              : 'Só demandas pendentes podem ser cotadas pela barra; use Cotar no card.'
            : 'Selecione uma demanda na lista (clique no card).',
        new: 'Abrir chat para nova solicitação',
      },
    };
  }, [
    isDemandsView,
    displayedDemands,
    demandasGestaoSelectedId,
    demandasGestaoFilterOpen,
    selectedDemand,
    apiStatus,
    intentType,
    destFilter,
    textQ,
    isHub,
    loadDemands,
  ]);

  const statusOptions: { value: string; label: string }[] = [
    { value: '', label: 'Todos (API)' },
    { value: 'PENDING', label: 'Pendente' },
    { value: 'QUOTED', label: 'Cotado' },
    { value: 'APPROVED', label: 'Aprovado' },
    { value: 'ASSIGNED', label: 'Em manifesto' },
    { value: 'COLLECTED', label: 'Coletado' },
    { value: 'IN_TRANSIT', label: 'Em trânsito' },
    { value: 'AT_HUB', label: 'No hub' },
    { value: 'OUT_FOR_DELIVERY', label: 'Saiu p/ entrega' },
    { value: 'DELIVERED', label: 'Entregue' },
    { value: 'CANCELLED', label: 'Cancelado' },
  ];

  const mainPanel = (
    <>
      {navState.category === 'pessoas' && <PessoasTab />}
      {navState.category === 'general' && (
        <SistemaConfiguracoesLayout
          activeTab={navState.generalSubTab}
          onSelectTab={(t) => setNavState({ category: 'general', generalSubTab: t })}
        >
          {navState.generalSubTab === 'settings' && <SettingsLLM />}
          {navState.generalSubTab === 'especies' && <EspeciesTab />}
          {navState.generalSubTab === 'identidade' && <IdentidadeVisualTab />}
        </SistemaConfiguracoesLayout>
      )}
      {navState.category === 'fleet' && <FrotaTab />}
      {navState.category === 'finance' && <FaturasTab />}
      {navState.category === 'transport' && navState.transportSubTab === 'entrada' && <EntradaTab />}
      {navState.category === 'transport' && navState.transportSubTab === 'viagens' && <ManifestsTab />}
      {navState.category === 'transport' && navState.transportSubTab === 'pedidos' && <PedidosTab />}
      {navState.category === 'transport' && navState.transportSubTab === 'motoristas' && <MotoristasTab />}
      {navState.category === 'transport' && navState.transportSubTab === 'rotas' && <TransportTab />}
      {navState.category === 'transport' && navState.transportSubTab === 'hubs' && <HubsTab />}
      {navState.category === 'commercial' && navState.commercialSubTab === 'cotacoes' && <CommercialTab forceSubTab="pipeline" />}
      {navState.category === 'commercial' && navState.commercialSubTab === 'clientes' && <ClientesTab />}
      {navState.category === 'commercial' && navState.commercialSubTab === 'tarifas' && <TarifasTab />}

      {isDemandsView && (
        <>
          {notice && (
            <div className="mb-4">
              <InlineNotice variant={notice.variant} message={notice.message} onDismiss={() => setNotice(null)} />
            </div>
          )}

          <OperationsCockpit
            isHub={isHub}
            canAccessCommercial={canAccessCommercial}
            showEntradaLink={!isHub || hasPermission('entrada')}
            data={operationsSummary}
            loading={summaryLoading}
            error={summaryError}
            onRetry={() => void refreshOperationsSummary()}
            onRefreshSummary={() => void refreshOperationsSummary()}
            onQuickDemandFilter={(patch) => {
              if (patch.apiStatus !== undefined) setApiStatus(patch.apiStatus);
              if (patch.intentType !== undefined) setIntentType(patch.intentType);
              setPage(0);
            }}
          />

          {listLoading && <LoadingPanel label="Carregando demandas…" />}
          {listError ? <ErrorPanel message={error!} onRetry={() => void loadDemands()} /> : null}
          {!listLoading && !listError && (
            <>
              {demandasGestaoFilterOpen && (
                <div className="mb-4 rounded-2xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
                  <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                    <div className="flex flex-1 flex-wrap gap-2">
                      <label className="sr-only" htmlFor="adm-status">
                        Status na API
                      </label>
                      <select
                        id="adm-status"
                        value={apiStatus}
                        onChange={(e) => setApiStatus(e.target.value)}
                        className="admin-focus rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                      >
                        {statusOptions.map((o) => (
                          <option key={o.value || 'all'} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor="adm-intent">
                        Intenção na API
                      </label>
                      <select
                        id="adm-intent"
                        value={intentType}
                        onChange={(e) => setIntentType(e.target.value as '' | 'QUOTE_ONLY' | 'COLLECT' | 'DROP_AT_HUB')}
                        className="admin-focus min-w-[140px] rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                      >
                        <option value="">Todas intenções</option>
                        <option value="QUOTE_ONLY">Cotação</option>
                        <option value="COLLECT">Coleta</option>
                        <option value="DROP_AT_HUB">Entrega no hub</option>
                      </select>
                      <input
                        type="search"
                        placeholder="Destino (contém, API)"
                        value={destFilter}
                        onChange={(e) => setDestFilter(e.target.value)}
                        className="admin-focus min-w-[160px] flex-1 rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                      />
                      <input
                        type="search"
                        placeholder="Filtrar nesta página (origem, NF, cliente…)"
                        value={textQ}
                        onChange={(e) => setTextQ(e.target.value)}
                        className="admin-focus min-w-[200px] flex-1 rounded-xl border border-tower-200 bg-white px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadDemands()}
                      className="admin-focus rounded-xl border border-tower-200 px-4 py-2 text-sm font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
                    >
                      Atualizar
                    </button>
                  </div>
                </div>
              )}

              <p className="mb-3 text-xs text-tower-700 dark:text-tower-300">
                <strong>Topo</strong> = visão geral (totais da API). <strong>Lista abaixo</strong> = filtros (ícone na barra), paginação {PAGE_SIZE}/página, total na API:{' '}
                {totalDemands}. Refino de texto aplica-se só à página.
              </p>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <div id="demandas-lista" className="space-y-4 lg:col-span-2">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-tower-700 dark:text-tower-300">Monitor de demandas</h2>
                  </div>

                  {displayedDemands.length === 0 ? (
                    <EmptyState
                      title="Nenhuma demanda nesta visão"
                      description="Ajuste filtros ou aguarde novas solicitações."
                      action={
                        <RouterLink
                          to="/chat/demo"
                          className="admin-focus inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-500"
                        >
                          Abrir chat
                        </RouterLink>
                      }
                    />
                  ) : (
                    displayedDemands.map((demand) => (
                      <article
                        key={demand.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setDemandasGestaoSelectedId(demand.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDemandasGestaoSelectedId(demand.id);
                          }
                        }}
                        className={`cursor-pointer rounded-2xl border border-tower-200 bg-white/95 p-5 shadow-sm transition hover:shadow-md dark:border-tower-700 dark:bg-tower-900/80 ${
                          demand.riskClass === 'A' ? 'border-l-4 border-l-red-500' : ''
                        } ${demandasGestaoSelectedId === demand.id ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-white dark:ring-brand-500 dark:ring-offset-tower-900' : ''}`}
                      >
                        <div className="flex flex-col justify-between gap-4 md:flex-row">
                          <div className="min-w-0 flex-grow">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="font-mono-ids text-[10px] font-semibold text-tower-600 dark:text-tower-400">#{demand.id.slice(0, 8)}</span>
                              <StatusBadge label={demandStatusLabels[demand.status]} tone={demandStatusTones[demand.status]} />
                              {demand.quotedPrice != null && (
                                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-800 dark:bg-brand-900/60 dark:text-brand-100">
                                  R$ {demand.quotedPrice.toLocaleString('pt-BR')}
                                </span>
                              )}
                              <span className="rounded bg-tower-100 px-2 py-0.5 text-[10px] text-tower-600 dark:bg-tower-800 dark:text-tower-300">via {demand.sourceType}</span>
                            </div>
                            <h3 className="text-lg font-bold text-tower-900 dark:text-tower-50">
                              {demand.origin} <span className="mx-1 text-tower-300 dark:text-tower-600">→</span> {demand.destination}
                            </h3>
                            <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
                              <div className="text-xs">
                                <span className="block text-tower-700 dark:text-tower-300">Mercadoria</span>
                                <span className="block truncate font-medium text-tower-800 dark:text-tower-200">{demand.commodity}</span>
                              </div>
                              <div className="text-xs">
                                <span className="block text-tower-700 dark:text-tower-300">Valor NF</span>
                                <span className="font-medium text-tower-800 dark:text-tower-200">R$ {demand.nfValue.toLocaleString('pt-BR')}</span>
                              </div>
                              <div className="text-xs">
                                <span className="block text-tower-700 dark:text-tower-300">Peso</span>
                                <span className="font-medium text-tower-800 dark:text-tower-200">{demand.weight} kg</span>
                              </div>
                              <div className="text-xs">
                                <span className="block text-tower-700 dark:text-tower-300">Risco</span>
                                <span className={`font-bold ${demand.riskClass === 'A' ? 'text-red-500' : 'text-brand-600 dark:text-brand-300'}`}>Classe {demand.riskClass}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-row gap-2 md:flex-col md:justify-end">
                            {!isHub && demand.status === 'PENDING' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDemandasGestaoSelectedId(demand.id);
                                  setSelectedDemand(demand);
                                }}
                                className="admin-focus rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-500"
                              >
                                Cotar
                              </button>
                            )}
                            {demand.status !== 'PENDING' && demand.status !== 'DELIVERED' && demand.status !== 'CANCELLED' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void advanceStatus(demand);
                                }}
                                className="admin-focus rounded-xl border border-tower-200 bg-tower-50 px-4 py-2 text-sm font-bold text-tower-800 hover:bg-tower-100 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100 dark:hover:bg-tower-700"
                              >
                                Avançar status
                              </button>
                            )}
                            <RouterLink
                              to={`/tracking/${demand.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="admin-focus px-4 py-2 text-center text-sm font-medium text-tower-700 hover:text-brand-600 dark:text-tower-300"
                            >
                              Ver tracking
                            </RouterLink>
                          </div>
                        </div>
                        {demand.events && demand.events.length > 0 && (
                          <div className="no-scrollbar mt-4 flex items-center gap-4 overflow-x-auto border-t border-tower-100 pt-4 dark:border-tower-800">
                            {demand.events.slice(-3).map((event) => (
                              <div key={event.id} className="flex flex-shrink-0 items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-brand-500" />
                                <div className="text-[10px]">
                                  <span className="block font-bold uppercase text-tower-700 dark:text-tower-200">{demandStatusLabels[event.status]}</span>
                                  <span className="text-tower-600 dark:text-tower-400">
                                    {new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    ))
                  )}

                  {totalPages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                      <p className="text-sm text-tower-600 dark:text-tower-400">
                        Página {page + 1} de {totalPages}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={page <= 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                          className="admin-focus rounded-xl border border-tower-200 bg-white px-4 py-2 text-sm font-semibold text-tower-800 hover:bg-tower-50 disabled:opacity-40 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100 dark:hover:bg-tower-700"
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          disabled={page >= totalPages - 1}
                          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                          className="admin-focus rounded-xl border border-tower-200 bg-white px-4 py-2 text-sm font-semibold text-tower-800 hover:bg-tower-50 disabled:opacity-40 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100 dark:hover:bg-tower-700"
                        >
                          Próxima
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  {!isHub && (
                    <div className="rounded-2xl border border-tower-200 bg-white/95 p-6 shadow-sm dark:border-tower-700 dark:bg-tower-900/80">
                      <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-tower-700 dark:text-tower-300">Ações rápidas</h2>
                      <RouterLink
                        to="/chat/demo"
                        className="admin-focus block w-full rounded-xl bg-brand-600 py-3 text-center text-sm font-bold text-white hover:bg-brand-500"
                      >
                        Novo via chat
                      </RouterLink>
                    </div>
                  )}
                  <div className="rounded-2xl border border-tower-800 bg-tower-900 p-6 text-tower-100 dark:border-tower-700">
                    <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-tower-100">Resumo da lista</h3>
                    <div className="space-y-3 text-xs">
                      <div className="flex justify-between">
                        <span>Itens na página (filtro local)</span>
                        <span className="font-bold">{stats.count}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Aguardando cotação</span>
                        <span className="font-bold">{stats.pending}</span>
                      </div>
                      <div className="flex justify-between border-t border-tower-700 pt-3">
                        <span className="text-tower-600 dark:text-tower-400">Atualizado</span>
                        <span className="font-medium text-brand-200">{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {selectedDemand && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-tower-950/80 p-4 backdrop-blur-md">
              <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-tower-200 bg-white shadow-2xl dark:border-tower-700 dark:bg-tower-900">
                <div className="bg-brand-600 p-6 text-white">
                  <h2 className="text-xl font-bold">Cotar demanda</h2>
                  <p className="text-sm text-white/90">
                    {selectedDemand.origin} → {selectedDemand.destination}
                  </p>
                </div>
                <div className="space-y-6 p-8">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="block text-tower-700 dark:text-tower-300">Mercadoria</span>
                      <span className="font-medium text-tower-900 dark:text-tower-100">{selectedDemand.commodity}</span>
                    </div>
                    <div>
                      <span className="block text-tower-700 dark:text-tower-300">Peso</span>
                      <span className="font-medium text-tower-900 dark:text-tower-100">{selectedDemand.weight} kg</span>
                    </div>
                    <div>
                      <span className="block text-tower-700 dark:text-tower-300">Valor NF</span>
                      <span className="font-medium text-tower-900 dark:text-tower-100">R$ {selectedDemand.nfValue.toLocaleString('pt-BR')}</span>
                    </div>
                    <div>
                      <span className="block text-tower-700 dark:text-tower-300">Volume</span>
                      <span className="font-medium text-tower-900 dark:text-tower-100">{selectedDemand.volume} m³</span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-tower-700 dark:text-tower-300" htmlFor="quote-input">
                      Valor da cotação (R$)
                    </label>
                    <input
                      id="quote-input"
                      type="number"
                      className="admin-focus w-full rounded-xl border border-tower-200 bg-tower-50 p-3 text-2xl font-bold text-brand-600 outline-none dark:border-tower-600 dark:bg-tower-800 dark:text-brand-300"
                      value={quotePrice}
                      onChange={(e) => setQuotePrice(e.target.value)}
                      placeholder="0,00"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50/90 p-4 dark:border-brand-700/50 dark:bg-brand-950/50">
                    <p className="text-xs leading-relaxed text-tower-800 dark:text-tower-200">
                      Risco <strong>{selectedDemand.riskClass}</strong> · Intenção <strong>{selectedDemand.intentType}</strong>
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 border-t border-tower-100 bg-tower-50/80 p-6 dark:border-tower-800 dark:bg-tower-950/50">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDemand(null);
                      setQuotePrice('');
                      setDemandasGestaoSelectedId(null);
                    }}
                    className="admin-focus flex-1 rounded-2xl py-3 text-sm font-bold text-tower-600 dark:text-tower-300"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!quotePrice}
                    onClick={() => void handleQuote()}
                    className="admin-focus flex-1 rounded-2xl bg-brand-600 py-3 text-sm font-bold text-white shadow-lg disabled:opacity-50 hover:bg-brand-500"
                  >
                    Enviar cotação
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );

  const showGestaoActionBar = navState.category !== 'general';

  const gestaoPanelKey = useMemo(
    () =>
      [
        navState.category,
        navState.transportSubTab,
        navState.commercialSubTab,
        navState.generalSubTab,
        navState.entradaOrderId ?? '',
      ].join('|'),
    [navState]
  );

  return (
    <GestaoModuleActionsProvider>
      {isDemandsView ? <RegisterDemandsGestaoActions config={demandsGestaoConfig} /> : null}
      <AdminShell
        isHub={isHub}
        hubContextLine={hubContextLine}
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        breadcrumbs={breadcrumbs}
        navSections={navSections}
        showGestaoActionBar={showGestaoActionBar}
        gestaoPanelKey={gestaoPanelKey}
      >
        {mainPanel}
      </AdminShell>
    </GestaoModuleActionsProvider>
  );
};

export default AdminDashboard;
