import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { manifestsApi } from '../../lib/api';
import type { Manifest } from '../../types/index';
import BottomNav, { type BottomNavItem } from './BottomNav';

type Tab = 'ofertas' | 'viagens' | 'historico';

const statusLabel: Record<string, string> = {
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
};

// ─── Icons (inline SVGs, no extra dep) ──────────────────────────────────────

const PackageIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const ArrowsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

const ClockIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const SpinnerIcon = () => (
  <svg className="animate-spin h-8 w-8 text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
  </svg>
);

// ─── ManifestCard ────────────────────────────────────────────────────────────

interface ManifestCardProps {
  manifest: Manifest;
  tab: Tab;
  actionLoading: string | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onUpdateStatus: (id: string, status: 'IN_PROGRESS' | 'COMPLETED') => void;
  onCompleteStop: (manifestId: string, stopId: string) => void;
}

const ManifestCard: React.FC<ManifestCardProps> = ({
  manifest: m,
  tab,
  actionLoading,
  onAccept,
  onReject,
  onUpdateStatus,
  onCompleteStop,
}) => {
  const busy = actionLoading === m.id;
  const orderCount = m.demands?.length ?? 0;
  const scheduledDate = m.offeredAt ?? m.createdAt;

  return (
    <div className="bg-white dark:bg-tower-800 rounded-2xl p-4 shadow-sm border border-tower-200 dark:border-tower-700">
      {/* Route */}
      <div className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-tower-900 dark:text-tower-100 text-base leading-tight">
          {m.origin}
        </span>
        <svg className="shrink-0 text-tower-400" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
        </svg>
        <span className="font-semibold text-tower-900 dark:text-tower-100 text-base leading-tight">
          {m.destination}
        </span>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-2 text-xs mb-3">
        <span className="bg-tower-100 dark:bg-tower-700 text-tower-600 dark:text-tower-300 rounded-full px-2.5 py-1">
          {orderCount} {orderCount === 1 ? 'pedido' : 'pedidos'}
        </span>
        {m.totalWeight > 0 && (
          <span className="bg-tower-100 dark:bg-tower-700 text-tower-600 dark:text-tower-300 rounded-full px-2.5 py-1">
            {m.totalWeight.toLocaleString('pt-BR')} kg
          </span>
        )}
        {m.totalVolume > 0 && (
          <span className="bg-tower-100 dark:bg-tower-700 text-tower-600 dark:text-tower-300 rounded-full px-2.5 py-1">
            {m.totalVolume.toLocaleString('pt-BR')} m³
          </span>
        )}
        {m.vehicleType?.name && (
          <span className="bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 rounded-full px-2.5 py-1">
            {m.vehicleType.name}
          </span>
        )}
      </div>

      {/* Status + date */}
      <div className="flex items-center justify-between text-xs text-tower-500 dark:text-tower-400 mb-3">
        <span>{statusLabel[m.status] ?? m.status}</span>
        {scheduledDate && (
          <span>
            {new Date(scheduledDate).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit',
            })}
          </span>
        )}
      </div>

      {/* Action buttons */}
      {tab === 'ofertas' && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject(m.id)}
            className="flex-1 py-2.5 bg-tower-100 dark:bg-tower-700 text-tower-700 dark:text-tower-200 text-sm font-medium rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
          >
            Recusar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAccept(m.id)}
            className="flex-1 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
          >
            {busy ? '...' : 'Aceitar Carga'}
          </button>
        </div>
      )}

      {tab === 'viagens' && m.status === 'ACCEPTED' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdateStatus(m.id, 'IN_PROGRESS')}
          className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
        >
          {busy ? '...' : 'Iniciar Viagem'}
        </button>
      )}

      {tab === 'viagens' && m.status === 'IN_PROGRESS' && (m.tripStops?.length ?? 0) === 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdateStatus(m.id, 'COMPLETED')}
          className="w-full py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
        >
          {busy ? '...' : 'Concluir Entrega'}
        </button>
      )}

      {tab === 'viagens' && m.status === 'IN_PROGRESS' && (m.tripStops?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-semibold text-tower-500 uppercase">Paradas da viagem</span>
          {m.tripStops!.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl bg-tower-50 dark:bg-tower-900/40 px-3 py-2">
              <span className="text-sm text-tower-700 dark:text-tower-200">
                #{s.sequence} — {s.destHub ? `${s.destHub.name} (${s.destHub.code})` : (s.destinationLabel ?? s.destCity ?? 'Parada')}
                {s.completedAt ? ' · Concluída' : ''}
              </span>
              {!s.completedAt && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onCompleteStop(m.id, s.id)}
                  className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 active:scale-95 transition-transform"
                >
                  {busy ? '...' : 'Concluir'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── EmptyState ──────────────────────────────────────────────────────────────

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="py-16 flex flex-col items-center gap-3 text-tower-400 dark:text-tower-500">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
    <p className="text-sm text-center">{message}</p>
  </div>
);

// ─── LinkHome ────────────────────────────────────────────────────────────────

const LinkHome: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [tab, setTab] = useState<Tab>('ofertas');
  const [ofertas, setOfertas] = useState<Manifest[]>([]);
  const [viagens, setViagens] = useState<Manifest[]>([]);
  const [historico, setHistorico] = useState<Manifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await manifestsApi.list({});
      const all = ((res as any).data ?? res) as Manifest[];
      const list = Array.isArray(all) ? all : [];
      setOfertas(list.filter((m) => m.status === 'PENDING_ACCEPT'));
      setViagens(list.filter((m) => m.status === 'ACCEPTED' || m.status === 'IN_PROGRESS'));
      setHistorico(list.filter((m) => m.status === 'COMPLETED'));
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar dados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAccept = async (id: string) => {
    setActionLoading(id);
    try {
      await manifestsApi.accept(id);
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = window.prompt('Motivo da recusa (opcional):') ?? '';
    setActionLoading(id);
    try {
      await manifestsApi.reject(id, reason);
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: 'IN_PROGRESS' | 'COMPLETED') => {
    if (newStatus === 'COMPLETED') {
      const confirmed = window.confirm('Confirmar conclusão da entrega?');
      if (!confirmed) return;
    }
    setActionLoading(id);
    try {
      if (newStatus === 'IN_PROGRESS') {
        const kmStr = window.prompt('Km de saída (opcional):');
        const kmSaida = kmStr && !Number.isNaN(Number(kmStr)) ? Number(kmStr) : undefined;
        await manifestsApi.start(id, { kmSaida });
      } else {
        const kmStr = window.prompt('Km de chegada (opcional):');
        const kmChegada = kmStr && !Number.isNaN(Number(kmStr)) ? Number(kmStr) : undefined;
        await manifestsApi.complete(id, { kmChegada });
      }
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCompleteStop = async (manifestId: string, stopId: string) => {
    const confirmed = window.confirm('Confirmar conclusão desta parada?');
    if (!confirmed) return;
    setActionLoading(manifestId);
    try {
      await manifestsApi.completeStop(manifestId, stopId);
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const navItems: BottomNavItem[] = [
    {
      key: 'ofertas',
      label: 'Ofertas',
      icon: <PackageIcon />,
      badge: ofertas.length,
    },
    {
      key: 'viagens',
      label: 'Viagens',
      icon: <ArrowsIcon />,
      badge: viagens.length,
    },
    {
      key: 'historico',
      label: 'Histórico',
      icon: <ClockIcon />,
    },
  ];

  const emptyMessages: Record<Tab, string> = {
    ofertas: 'Nenhuma oferta disponível no momento.',
    viagens: 'Nenhuma viagem em andamento.',
    historico: 'Nenhuma entrega concluída ainda.',
  };

  const currentList: Manifest[] =
    tab === 'ofertas' ? ofertas : tab === 'viagens' ? viagens : historico;

  return (
    <div className="min-h-screen bg-tower-100 dark:bg-tower-900 pb-24">
      {/* Header */}
      <header className="bg-white dark:bg-tower-800 border-b border-tower-200 dark:border-tower-700 sticky top-0 z-10 safe-area-top">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-tower-900 dark:text-tower-100 leading-none">
              TSM Link
            </h1>
            <p className="text-xs text-tower-500 dark:text-tower-400 mt-0.5">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-tower-500 hover:text-red-600 dark:hover:text-red-400 transition-colors px-2 py-1"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="px-4 pt-4">
        {/* Error banner */}
        {error && (
          <div className="mb-4 flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-sm">
            <span>{error}</span>
            <button
              type="button"
              onClick={load}
              className="ml-3 shrink-0 font-semibold underline"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="py-20 flex flex-col items-center gap-3">
            <SpinnerIcon />
            <p className="text-sm text-tower-500 dark:text-tower-400">Carregando...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {currentList.length === 0 ? (
              <EmptyState message={emptyMessages[tab]} />
            ) : (
              currentList.map((m) => (
                <ManifestCard
                  key={m.id}
                  manifest={m}
                  tab={tab}
                  actionLoading={actionLoading}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onUpdateStatus={handleUpdateStatus}
                  onCompleteStop={handleCompleteStop}
                />
              ))
            )}
          </div>
        )}
      </main>

      {/* Bottom navigation */}
      <BottomNav
        items={navItems}
        active={tab}
        onChange={(key) => setTab(key as Tab)}
      />
    </div>
  );
};

export default LinkHome;
