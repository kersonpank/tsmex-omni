import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { hubCargoApi, manifestsApi } from '../../lib/api';
import { manifestStatusLabels, manifestStatusTone } from '../../lib/manifestStatusUi';
import { useAuthStore } from '../../store/authStore';
import { useHubCargoStore } from '../../store/hubCargoStore';
import type { HubCargoSummary, Manifest } from '../../types/index';
import EntradaTab from '../admin/EntradaTab';
import InlineNotice from '../ui/InlineNotice';
import BottomNav, { type BottomNavItem } from './BottomNav';
import HubOrdersWorkspace from './hub/HubOrdersWorkspace';
import { HubNavIconHome, HubNavIconManifest, HubNavIconOrders } from './hubNavIcons';

type Tab = 'inicio' | 'pedidos' | 'viagens';

const ACTIVE_MANIFEST_STATUSES = ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'];

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

function extractArray(response: any): Manifest[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function manifestRoute(manifest: Manifest): string {
  return `${manifest.origin || 'Origem'} → ${manifest.destination || 'Destino'}`;
}

const ManifestCard: React.FC<{
  manifest: Manifest;
  onReceiveStop?: (stopId: string) => void;
  onReceiveTrip?: () => void;
}> = ({ manifest, onReceiveStop, onReceiveTrip }) => {
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
          onClick={() => { window.location.hash = `#/manifests/${manifest.id}`; }}
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
  const [tab, setTab] = useState<Tab>('inicio');
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [summary, setSummary] = useState<HubCargoSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState<{ open: boolean; initialCode?: string }>({ open: false });

  const profileHubId = (user?.profile as { hub?: { hubId?: string } } | undefined)?.hub?.hubId;
  const hubId = user?.hubId ?? profileHubId ?? null;

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
    } else {
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

  const goToCargo = (bucket: 'stock' | 'incoming' | 'awaiting' | 'triage') => {
    setBucket(bucket);
    setTab('pedidos');
  };

  const createTrip = (orderIds: string[] = []) => {
    const suffix = orderIds.length > 0 ? `?orders=${encodeURIComponent(orderIds.join(','))}` : '';
    window.location.hash = `#/manifests/new${suffix}`;
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
      <main key={`${tab}-${manualEntry.open}`} className="mobile-enter mx-auto max-w-6xl p-4">
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
                <button type="button" onClick={() => setTab('viagens')} className="admin-focus min-h-11 rounded-xl px-2 text-sm font-semibold text-brand-700 dark:text-brand-300">Ver todas</button>
              </div>
              {activeManifests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-tower-300 p-6 text-center dark:border-tower-600">
                  <p className="text-sm font-semibold text-tower-700 dark:text-tower-200">Nenhuma viagem ativa agora.</p>
                  <button type="button" onClick={() => createTrip()} className="admin-focus mt-3 min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">Criar viagem</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeManifests.slice(0, 3).map((manifest) => <ManifestCard key={manifest.id} manifest={manifest} />)}
                </div>
              )}
            </div>
          </section>
        )}

        {!loading && tab === 'pedidos' && !manualEntry.open && (
          <HubOrdersWorkspace
            hubId={hubId}
            onOpenOrder={(orderId) => { window.location.hash = `#/orders/${orderId}`; }}
            onOpenTrip={(manifestId) => { window.location.hash = `#/manifests/${manifestId}`; }}
            onCreateTrip={createTrip}
            onOpenManualEntry={(initialCode) => setManualEntry({ open: true, initialCode })}
            onSummaryChanged={setSummary}
          />
        )}

        {!loading && tab === 'pedidos' && manualEntry.open && (
          <EntradaTab
            mobileWizard
            startCreating
            initialNfeCode={manualEntry.initialCode}
            onCancelContext={() => setManualEntry({ open: false })}
            onCreated={() => setSuccess('Pedido-base criado. Continue nesta tela para completar os dados da carga.')}
          />
        )}

        {!loading && tab === 'viagens' && (
          <section className="space-y-6 pb-20" aria-labelledby="trips-title">
            <header className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-300">Programação</p>
                <h1 id="trips-title" className="mt-1 text-2xl font-bold tracking-tight text-tower-950 dark:text-white">Viagens</h1>
                <p className="mt-1 text-sm text-tower-500">Rascunhos, saídas e cargas chegando ao seu Hub.</p>
              </div>
              <button type="button" onClick={() => createTrip()} className="admin-focus hidden min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white sm:block">+ Nova viagem</button>
            </header>

            <TripGroup title="Rascunhos" empty="Nenhuma viagem em preparação." manifests={drafts} />
            <TripGroup title="Saindo deste Hub" empty="Nenhuma saída ativa." manifests={outbound} />
            <TripGroup
              title="Chegando a este Hub"
              empty="Nenhuma viagem a caminho."
              manifests={inbound}
              render={(manifest) => {
                const pendingStop = manifest.tripStops?.find((stop) => stop.destHubId === hubId && !stop.completedAt);
                const legacyArrival = (!manifest.tripStops || manifest.tripStops.length === 0) && manifest.status === 'IN_PROGRESS';
                return (
                  <ManifestCard
                    key={manifest.id}
                    manifest={manifest}
                    onReceiveStop={pendingStop ? (stopId) => void receiveStop(manifest.id, stopId) : undefined}
                    onReceiveTrip={legacyArrival ? () => void receiveManifest(manifest.id) : undefined}
                  />
                );
              }}
            />

            <button type="button" onClick={() => createTrip()} className="admin-focus fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-4 right-4 z-30 min-h-12 rounded-xl bg-brand-600 text-sm font-bold text-white shadow-xl sm:hidden">
              + Nova viagem
            </button>
          </section>
        )}
      </main>

      <BottomNav items={navItems} active={tab} onChange={(key) => {
        setManualEntry({ open: false });
        setTab(key as Tab);
      }} />
    </div>
  );
};

const TripGroup: React.FC<{
  title: string;
  empty: string;
  manifests: Manifest[];
  render?: (manifest: Manifest) => React.ReactNode;
}> = ({ title, empty, manifests, render }) => (
  <div>
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-bold text-tower-900 dark:text-tower-100">{title}</h2>
      <span className="text-xs tabular-nums text-tower-500">{manifests.length}</span>
    </div>
    {manifests.length === 0 ? (
      <div className="rounded-2xl border border-dashed border-tower-300 p-6 text-center text-sm text-tower-500 dark:border-tower-600">{empty}</div>
    ) : (
      <div className="space-y-3">{manifests.map((manifest) => render?.(manifest) ?? <ManifestCard key={manifest.id} manifest={manifest} />)}</div>
    )}
  </div>
);

export default HubHome;
