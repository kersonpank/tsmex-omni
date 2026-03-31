import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { ordersApi, hubsApi, clientsApi } from '../../lib/api';
import type { Order } from '../../types/index';
import type { Client } from '../../types/index';

type Tab = 'entrada' | 'pedidos';

const HubHome: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [tab, setTab] = useState<Tab>('pedidos');
  const [pedidos, setPedidos] = useState<Order[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [form, setForm] = useState({
    clientId: '',
    nfNumber: '',
    nfValue: '',
    origin: '',
    destination: '',
    commodity: '',
    weight: '',
    volume: '',
    units: 1,
    riskClass: 'B' as 'A' | 'B' | 'C',
  });
  const [formSaving, setFormSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ordersRes, clientsRes] = await Promise.all([
        ordersApi.list({ status: 'AT_HUB', limit: 100 }),
        clientsApi.list(),
      ]);
      setPedidos(Array.isArray((ordersRes as any).data) ? (ordersRes as any).data : Array.isArray(ordersRes) ? ordersRes : []);
      setClients(Array.isArray((clientsRes as any).data) ? (clientsRes as any).data : Array.isArray(clientsRes) ? clientsRes : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleEntrada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientId || !form.nfNumber || !form.origin || !form.destination || !form.commodity || !form.weight || !form.volume) {
      alert('Preencha todos os campos obrigatórios.');
      return;
    }
    setFormSaving(true);
    try {
      await hubsApi.entrada({
        clientId: form.clientId,
        nfNumber: form.nfNumber,
        nfValue: parseFloat(String(form.nfValue)) || 0,
        origin: form.origin,
        destination: form.destination,
        commodity: form.commodity,
        weight: parseFloat(String(form.weight)) || 0,
        volume: parseFloat(String(form.volume)) || 0,
        units: Number(form.units) || 1,
        riskClass: form.riskClass,
      });
      setForm({
        clientId: '',
        nfNumber: '',
        nfValue: '',
        origin: '',
        destination: '',
        commodity: '',
        weight: '',
        volume: '',
        units: 1,
        riskClass: 'B',
      });
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || 'Erro ao registrar entrada');
    } finally {
      setFormSaving(false);
    }
  };

  const handleOrderStatus = async (orderId: string, status: string) => {
    setActionLoading(orderId);
    try {
      await ordersApi.updateStatus(orderId, { status, description: `Status: ${status}` });
      await load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-20">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 sticky top-0 z-10">
        <div className="px-4 py-3 flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-slate-900">App Hub</h1>
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
          <button
            type="button"
            onClick={() => setTab('pedidos')}
            className={`flex-1 py-3 text-sm font-medium ${tab === 'pedidos' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-slate-500'}`}
          >
            Pedidos no hub
          </button>
          <button
            type="button"
            onClick={() => setTab('entrada')}
            className={`flex-1 py-3 text-sm font-medium ${tab === 'entrada' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-slate-500'}`}
          >
            Entrada
          </button>
        </div>
      </header>

      <main className="p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {tab === 'pedidos' && (
          <>
            {loading ? (
              <div className="py-12 text-center text-slate-500">Carregando...</div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">Pedidos no hub</h2>
                {pedidos.length === 0 ? (
                  <p className="text-slate-500 text-sm">Nenhum pedido no hub no momento.</p>
                ) : (
                  pedidos.map((o: any) => (
                    <div key={o.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200">
                      <p className="font-medium text-slate-900">NF {o.nfNumber || o.demand?.nfNumber}</p>
                      <p className="text-xs text-slate-500 mt-1">{o.demand?.origin} → {o.demand?.destination}</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button
                          type="button"
                          disabled={!!actionLoading}
                          onClick={() => handleOrderStatus(o.id, 'IN_TRANSIT')}
                          className="px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-lg"
                        >
                          Saiu (trânsito)
                        </button>
                        <button
                          type="button"
                          disabled={!!actionLoading}
                          onClick={() => handleOrderStatus(o.id, 'OUT_FOR_DELIVERY')}
                          className="px-3 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-lg"
                        >
                          Saiu para entrega
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {tab === 'entrada' && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Registrar entrada de mercadoria</h2>
            <form onSubmit={handleEntrada} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cliente *</label>
                <select
                  value={form.clientId}
                  onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  required
                >
                  <option value="">Selecione</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.companyName}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nº NF *</label>
                  <input
                    type="text"
                    value={form.nfNumber}
                    onChange={e => setForm(f => ({ ...f, nfNumber: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Valor NF</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.nfValue}
                    onChange={e => setForm(f => ({ ...f, nfValue: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Origem *</label>
                <input
                  type="text"
                  value={form.origin}
                  onChange={e => setForm(f => ({ ...f, origin: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Destino *</label>
                <input
                  type="text"
                  value={form.destination}
                  onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mercadoria *</label>
                <input
                  type="text"
                  value={form.commodity}
                  onChange={e => setForm(f => ({ ...f, commodity: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Peso (kg) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.weight}
                    onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Volume (m³) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.volume}
                    onChange={e => setForm(f => ({ ...f, volume: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={formSaving}
                className="w-full py-3 bg-amber-600 text-white font-medium rounded-lg disabled:opacity-50"
              >
                {formSaving ? 'Registrando...' : 'Registrar entrada'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
};

export default HubHome;
