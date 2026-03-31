import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { manifestsApi, ordersApi, demandsApi, hubsApi } from '../../lib/api';
import type { Manifest, Order } from '../../types/index';
import type { Hub } from '../../types/index';

type Tab = 'ofertas' | 'viagens' | 'pedidos';

const LinkHome: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [tab, setTab] = useState<Tab>('ofertas');
  const [ofertas, setOfertas] = useState<Manifest[]>([]);
  const [viagens, setViagens] = useState<Manifest[]>([]);
  const [pedidos, setPedidos] = useState<Order[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [manifestsRes, ordersRes, hubsRes] = await Promise.all([
        manifestsApi.list({}),
        ordersApi.list({ limit: 100 }),
        hubsApi.list(),
      ]);
      const all = ((manifestsRes as any).data ?? manifestsRes) as Manifest[];
      setOfertas(Array.isArray(all) ? all.filter((m: Manifest) => m.status === 'PENDING_ACCEPT') : []);
      setViagens(Array.isArray(all) ? all.filter((m: Manifest) => ['ACCEPTED', 'IN_PROGRESS'].includes(m.status)) : []);
      setPedidos(Array.isArray((ordersRes as any).data) ? (ordersRes as any).data : Array.isArray(ordersRes) ? ordersRes : []);
      setHubs(Array.isArray((hubsRes as any).data) ? (hubsRes as any).data : Array.isArray(hubsRes) ? hubsRes : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar');
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
    const reason = window.prompt('Motivo da recusa (opcional):') || '';
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

  const handleStart = async (id: string) => {
    setActionLoading(id);
    try {
      await manifestsApi.start(id);
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleComplete = async (id: string) => {
    setActionLoading(id);
    try {
      await manifestsApi.complete(id);
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDemandCollected = async (demandId: string) => {
    setActionLoading(demandId);
    try {
      await demandsApi.updateStatus(demandId, { status: 'COLLECTED', description: 'Coleta confirmada pelo motorista' });
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleOrderStatus = async (orderId: string, status: string, currentHubId?: string) => {
    setActionLoading(orderId);
    try {
      await ordersApi.updateStatus(orderId, { status, currentHubId, description: `Status: ${status}` });
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'ofertas', label: 'Ofertas' },
    { key: 'viagens', label: 'Viagens' },
    { key: 'pedidos', label: 'Pedidos' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 pb-20">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10 safe-area-top">
        <div className="px-4 py-3 flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-slate-900">App Motorista</h1>
            <p className="text-xs text-slate-500">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-slate-600 hover:text-red-600"
          >
            Sair
          </button>
        </div>
        <div className="flex border-t border-slate-100">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 py-3 text-sm font-medium ${tab === key ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
        )}
        {loading ? (
          <div className="py-12 text-center text-slate-500">Carregando...</div>
        ) : (
          <>
            {tab === 'ofertas' && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">Manifestos oferecidos</h2>
                {ofertas.length === 0 ? (
                  <p className="text-slate-500 text-sm">Nenhuma oferta no momento.</p>
                ) : (
                  ofertas.map((m) => (
                    <div key={m.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
                      <p className="font-medium text-slate-900">{m.origin} → {m.destination}</p>
                      <p className="text-xs text-slate-500 mt-1">{m.demands?.length || 0} demanda(s)</p>
                      <div className="flex gap-2 mt-3">
                        <button
                          type="button"
                          disabled={actionLoading === m.id}
                          onClick={() => handleAccept(m.id)}
                          className="flex-1 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                        >
                          {actionLoading === m.id ? '...' : 'Aceitar'}
                        </button>
                        <button
                          type="button"
                          disabled={actionLoading === m.id}
                          onClick={() => handleReject(m.id)}
                          className="flex-1 py-2 bg-slate-200 text-slate-700 text-sm font-medium rounded-lg disabled:opacity-50"
                        >
                          Recusar
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'viagens' && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">Minhas viagens</h2>
                {viagens.length === 0 ? (
                  <p className="text-slate-500 text-sm">Nenhuma viagem em andamento.</p>
                ) : (
                  viagens.map((m) => (
                    <div key={m.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
                      <p className="font-medium text-slate-900">{m.origin} → {m.destination}</p>
                      <p className="text-xs text-slate-500 mt-1">Status: {m.status}</p>
                      {m.status === 'ACCEPTED' && (
                        <button
                          type="button"
                          disabled={actionLoading === m.id}
                          onClick={() => handleStart(m.id)}
                          className="mt-3 w-full py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                        >
                          {actionLoading === m.id ? '...' : 'Iniciar viagem'}
                        </button>
                      )}
                      {m.status === 'IN_PROGRESS' && (
                        <button
                          type="button"
                          disabled={actionLoading === m.id}
                          onClick={() => handleComplete(m.id)}
                          className="mt-3 w-full py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                        >
                          {actionLoading === m.id ? '...' : 'Finalizar viagem'}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'pedidos' && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">Pedidos em trânsito</h2>
                {pedidos.length === 0 ? (
                  <p className="text-slate-500 text-sm">Nenhum pedido.</p>
                ) : (
                  pedidos.map((o: any) => (
                    <div key={o.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
                      <p className="font-medium text-slate-900">NF {o.nfNumber || o.demand?.nfNumber} · {o.status}</p>
                      <p className="text-xs text-slate-500 mt-1">{o.demand?.origin} → {o.demand?.destination}</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {o.demand?.status === 'ASSIGNED' && (
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => handleDemandCollected(o.demand.id)}
                            className="px-3 py-1.5 bg-cyan-600 text-white text-xs font-medium rounded-lg"
                          >
                            Confirmar coleta
                          </button>
                        )}
                        {['PENDING', 'IN_TRANSIT'].includes(o.status) && (
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => {
                              const hubId = hubs.length === 1 ? hubs[0].id : window.prompt('ID do hub (ou deixe em branco):');
                              handleOrderStatus(o.id, 'AT_HUB', hubId || undefined);
                            }}
                            className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg"
                          >
                            Chegou no hub
                          </button>
                        )}
                        {o.status === 'OUT_FOR_DELIVERY' && (
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => handleOrderStatus(o.id, 'DELIVERED')}
                            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg"
                          >
                            Entregue
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default LinkHome;
