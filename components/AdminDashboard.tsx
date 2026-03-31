import React, { useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { demandsApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import type { Demand, DemandStatus, RiskClass } from '../types/index';
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

// Mapear status do backend para labels em português
const statusLabels: Record<DemandStatus, string> = {
  PENDING: 'Pendente',
  QUOTED: 'Cotado',
  APPROVED: 'Aprovado',
  ASSIGNED: 'Em Manifesto',
  COLLECTED: 'Coletado',
  IN_TRANSIT: 'Em Trânsito',
  AT_HUB: 'No HUB',
  OUT_FOR_DELIVERY: 'Saiu para Entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

const statusColors: Record<DemandStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
  QUOTED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200',
  APPROVED: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200',
  ASSIGNED: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200',
  COLLECTED: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-200',
  IN_TRANSIT: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200',
  AT_HUB: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200',
  OUT_FOR_DELIVERY: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200',
  DELIVERED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
  CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200',
};

type Category = 'pessoas' | 'transport' | 'commercial' | 'fleet' | 'finance' | 'general';
type TransportSubTab = 'demands' | 'viagens' | 'pedidos' | 'motoristas' | 'rotas' | 'hubs' | 'entrada';
type CommercialSubTab = 'cotacoes' | 'clientes' | 'tarifas';
type GeneralSubTab = 'settings' | 'especies';

const HUB_PERMISSIONS = ['entrada', 'pedidos', 'manifestos', 'demandas'] as const;

const AdminDashboard: React.FC = () => {
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const hubPermissions = (user?.profile as { hub?: { permissions?: string[] } })?.hub?.permissions ?? (user as { permissions?: string[] })?.permissions ?? [];
  const hasPermission = (p: string) => !isHub || hubPermissions.length === 0 || hubPermissions.includes(p);

  const [category, setCategory] = useState<Category>('transport');
  const [transportSubTab, setTransportSubTab] = useState<TransportSubTab>('demands');
  const [commercialSubTab, setCommercialSubTab] = useState<CommercialSubTab>('cotacoes');
  const [generalSubTab, setGeneralSubTab] = useState<GeneralSubTab>('settings');
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDemand, setSelectedDemand] = useState<Demand | null>(null);
  const [quotePrice, setQuotePrice] = useState<string>('');

  const isDemandsView = category === 'transport' && transportSubTab === 'demands';

  useEffect(() => {
    if (isDemandsView) loadDemands();
  }, [isDemandsView]);

  useEffect(() => {
    if (isHub && hasPermission('entrada') && transportSubTab === 'demands') {
      setTransportSubTab('entrada');
    }
  }, [isHub]);

  const loadDemands = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await demandsApi.list({ limit: 50 });
      const data = (response as any)?.data ?? response;
      setDemands(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Erro ao carregar demandas:', err);
      setError(err.response?.data?.error || 'Erro ao carregar demandas');
    } finally {
      setLoading(false);
    }
  };

  const handleQuote = async () => {
    if (!selectedDemand || !quotePrice) return;

    try {
      await demandsApi.quote(selectedDemand.id, {
        price: parseFloat(quotePrice),
      });
      setSelectedDemand(null);
      setQuotePrice('');
      loadDemands(); // Recarregar lista
    } catch (err: any) {
      console.error('Erro ao cotar:', err);
      alert(err.response?.data?.error || 'Erro ao enviar cotação');
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
          description: `Status atualizado para ${statusLabels[nextStatus]}`,
        });
        loadDemands();
      } catch (err: any) {
        console.error('Erro ao atualizar status:', err);
        alert(err.response?.data?.error || 'Erro ao atualizar status');
      }
    }
  };

  // Estatísticas
  const stats = {
    inTransit: demands.filter(d => d.status === 'IN_TRANSIT').length,
    highRisk: demands.filter(d => d.riskClass === 'A').length,
    pending: demands.filter(d => d.status === 'PENDING').length,
    totalValue: demands.reduce((acc, d) => acc + (d.quotedPrice || 0), 0),
  };

  const showGlobalLoading = isDemandsView && loading;
  const showGlobalError = isDemandsView && !!error;

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{isHub ? 'Operação do Depósito' : 'Torre de Controle TSM'}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">{isHub ? 'Entrada, pedidos e viagens do seu depósito.' : 'Orquestração de demandas e controle de risco.'}</p>
        </div>
      </div>

      {/* Categorias (menu principal) - HUB vê só Transporte */}
      <div className="flex flex-wrap border-b border-slate-200 dark:border-slate-700 mb-2">
        {!isHub && (
          <>
            <button onClick={() => setCategory('pessoas')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${category === 'pessoas' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>👤 Pessoas</button>
            <button onClick={() => setCategory('transport')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${category === 'transport' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>🚚 Transporte</button>
            <button onClick={() => setCategory('commercial')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${category === 'commercial' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>💼 Comercial</button>
            <button onClick={() => setCategory('fleet')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${category === 'fleet' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>🚛 Frota</button>
            <button onClick={() => setCategory('finance')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${category === 'finance' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>💰 Finanças</button>
            <button onClick={() => setCategory('general')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${category === 'general' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>⚙️ Gerais</button>
          </>
        )}
        {isHub && (
          <button onClick={() => setCategory('transport')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${category === 'transport' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>🚚 Operação</button>
        )}
      </div>

      {/* Sub-abas Transporte */}
      {category === 'transport' && (
        <div className="flex flex-wrap gap-1 mb-6">
          {(!isHub || hasPermission('entrada')) && (
            <button onClick={() => setTransportSubTab('entrada')} className={`px-3 py-2 text-sm rounded-lg ${transportSubTab === 'entrada' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Entrada</button>
          )}
          {(!isHub || hasPermission('demandas')) && (
            <button onClick={() => setTransportSubTab('demands')} className={`px-3 py-2 text-sm rounded-lg ${transportSubTab === 'demands' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Demandas</button>
          )}
          {(!isHub || hasPermission('manifestos')) && (
            <button onClick={() => setTransportSubTab('viagens')} className={`px-3 py-2 text-sm rounded-lg ${transportSubTab === 'viagens' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Viagens</button>
          )}
          {(!isHub || hasPermission('pedidos')) && (
            <button onClick={() => setTransportSubTab('pedidos')} className={`px-3 py-2 text-sm rounded-lg ${transportSubTab === 'pedidos' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Pedidos</button>
          )}
          {!isHub && (
            <>
              <button onClick={() => setTransportSubTab('motoristas')} className={`px-3 py-2 text-sm rounded-lg ${transportSubTab === 'motoristas' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Motoristas</button>
              <button onClick={() => setTransportSubTab('rotas')} className={`px-3 py-2 text-sm rounded-lg ${transportSubTab === 'rotas' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Rotas</button>
              <button onClick={() => setTransportSubTab('hubs')} className={`px-3 py-2 text-sm rounded-lg ${transportSubTab === 'hubs' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Hubs</button>
            </>
          )}
        </div>
      )}

      {/* Sub-abas Gerais */}
      {category === 'general' && (
        <div className="flex flex-wrap gap-1 mb-6">
          <button onClick={() => setGeneralSubTab('settings')} className={`px-3 py-2 text-sm rounded-lg ${generalSubTab === 'settings' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Configurações LLM</button>
          <button onClick={() => setGeneralSubTab('especies')} className={`px-3 py-2 text-sm rounded-lg ${generalSubTab === 'especies' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Espécies NF</button>
        </div>
      )}

      {/* Sub-abas Comercial */}
      {category === 'commercial' && (
        <div className="flex flex-wrap gap-1 mb-6">
          <button onClick={() => setCommercialSubTab('cotacoes')} className={`px-3 py-2 text-sm rounded-lg ${commercialSubTab === 'cotacoes' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Cotações / Oportunidades</button>
          <button onClick={() => setCommercialSubTab('clientes')} className={`px-3 py-2 text-sm rounded-lg ${commercialSubTab === 'clientes' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Clientes</button>
          <button onClick={() => setCommercialSubTab('tarifas')} className={`px-3 py-2 text-sm rounded-lg ${commercialSubTab === 'tarifas' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Tarifas</button>
        </div>
      )}

      {/* Conteúdo por categoria */}
      {category === 'pessoas' && <PessoasTab />}
      {category === 'general' && generalSubTab === 'settings' && <SettingsLLM />}
      {category === 'general' && generalSubTab === 'especies' && <EspeciesTab />}
      {category === 'fleet' && <FrotaTab />}
      {category === 'finance' && <FaturasTab />}
      {category === 'transport' && transportSubTab === 'entrada' && <EntradaTab />}
      {category === 'transport' && transportSubTab === 'viagens' && <ManifestsTab />}
      {category === 'transport' && transportSubTab === 'pedidos' && <PedidosTab />}
      {category === 'transport' && transportSubTab === 'motoristas' && <MotoristasTab />}
      {category === 'transport' && transportSubTab === 'rotas' && <TransportTab />}
      {category === 'transport' && transportSubTab === 'hubs' && <HubsTab />}
      {category === 'commercial' && commercialSubTab === 'cotacoes' && <CommercialTab forceSubTab="pipeline" />}
      {category === 'commercial' && commercialSubTab === 'clientes' && <ClientesTab />}
      {category === 'commercial' && commercialSubTab === 'tarifas' && <TarifasTab />}

      {/* Conteúdo Demandas (Transporte > Demandas) */}
      {category === 'transport' && transportSubTab === 'demands' && (
        <>
          {showGlobalLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-slate-500 dark:text-slate-400">Carregando demandas...</p>
              </div>
            </div>
          )}
          {!showGlobalLoading && showGlobalError && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-2xl p-8 text-center">
              <p className="text-red-600 dark:text-red-300 font-medium mb-4">{error}</p>
              <button onClick={loadDemands} className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors">Tentar Novamente</button>
            </div>
          )}
          {!showGlobalLoading && !showGlobalError && (
        <>
          {/* Stats cards */}
          <div className="flex gap-3 overflow-x-auto pb-4 mb-6">
            <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 p-3 rounded-xl shadow-sm text-center min-w-[140px]">
              <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase mb-1">Pendentes</span>
              <span className="text-xl font-bold text-amber-600 dark:text-amber-400">{stats.pending}</span>
            </div>
            <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 p-3 rounded-xl shadow-sm text-center min-w-[140px]">
              <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase mb-1">Em Trânsito</span>
              <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">{stats.inTransit}</span>
            </div>
            <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 p-3 rounded-xl shadow-sm text-center min-w-[140px]">
              <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase mb-1">Alerta Risco A</span>
              <span className="text-xl font-bold text-red-500 dark:text-red-400">{stats.highRisk}</span>
            </div>
            <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 p-3 rounded-xl shadow-sm text-center min-w-[140px]">
              <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase mb-1">Faturado</span>
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">R$ {stats.totalValue.toLocaleString()}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Monitor de Demandas</h2>
                <button
                  onClick={loadDemands}
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium"
                >
                  ↻ Atualizar
                </button>
              </div>

              {demands.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-12 text-center text-slate-400 dark:text-slate-500">
                  Nenhuma demanda encontrada. Aguardando novas solicitações...
                </div>
              ) : (
                demands.map(demand => (
                  <div
                    key={demand.id}
                    className={`bg-white dark:bg-slate-800 border rounded-2xl p-5 hover:shadow-md dark:hover:shadow-slate-900/20 transition-all ${demand.riskClass === 'A' ? 'border-l-4 border-l-red-500' : 'border-slate-200 dark:border-slate-700'
                      }`}
                  >
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                      <div className="flex-grow">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">#{demand.id.slice(0, 8)}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusColors[demand.status]}`}>
                            {statusLabels[demand.status]}
                          </span>
                          {demand.quotedPrice && (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/40 px-2 py-0.5 rounded">
                              R$ {demand.quotedPrice.toLocaleString()}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                            via {demand.sourceType}
                          </span>
                        </div>
                        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">
                          {demand.origin} <span className="text-slate-300 dark:text-slate-500 mx-1">→</span> {demand.destination}
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                          <div className="text-xs">
                            <span className="block text-slate-400 dark:text-slate-500">Mercadoria</span>
                            <span className="font-medium text-slate-700 dark:text-slate-300 truncate block">{demand.commodity}</span>
                          </div>
                          <div className="text-xs">
                            <span className="block text-slate-400 dark:text-slate-500">Valor NF</span>
                            <span className="font-medium text-slate-700 dark:text-slate-300">R$ {demand.nfValue.toLocaleString()}</span>
                          </div>
                          <div className="text-xs">
                            <span className="block text-slate-400 dark:text-slate-500">Peso</span>
                            <span className="font-medium text-slate-700 dark:text-slate-300">{demand.weight}kg</span>
                          </div>
                          <div className="text-xs">
                            <span className="block text-slate-400 dark:text-slate-500">Risco</span>
                            <span className={`font-bold ${demand.riskClass === 'A' ? 'text-red-500 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
                              CLASSE {demand.riskClass}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-row md:flex-col justify-end gap-2 shrink-0">
                        {!isHub && demand.status === 'PENDING' && (
                          <button
                            onClick={() => setSelectedDemand(demand)}
                            className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl text-sm hover:bg-indigo-700 transition-all shadow-sm"
                          >
                            Cotar
                          </button>
                        )}
                        {demand.status !== 'PENDING' && demand.status !== 'DELIVERED' && demand.status !== 'CANCELLED' && (
                          <button
                            onClick={() => advanceStatus(demand)}
                            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
                          >
                            Avançar Status
                          </button>
                        )}
                        <RouterLink
                          to={`/tracking/${demand.id}`}
                          className="px-4 py-2 text-slate-500 dark:text-slate-400 text-sm font-medium hover:text-indigo-600 dark:hover:text-indigo-400 text-center"
                        >
                          Ver Tracking
                        </RouterLink>
                      </div>
                    </div>

                    {/* Eventos Recentes */}
                    {demand.events && demand.events.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-50 dark:border-slate-700 flex items-center gap-4 overflow-x-auto no-scrollbar">
                        {demand.events.slice(-3).map(event => (
                          <div key={event.id} className="flex-shrink-0 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-indigo-400"></div>
                            <div className="text-[10px]">
                              <span className="block font-bold text-slate-700 dark:text-slate-300 uppercase">{statusLabels[event.status]}</span>
                              <span className="text-slate-400 dark:text-slate-500">
                                {new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="space-y-6">
              {!isHub && (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
                <h2 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase mb-4">Ações Rápidas</h2>
                <div className="space-y-3">
                  <RouterLink
                    to="/chat/demo"
                    className="block w-full px-4 py-3 bg-indigo-600 text-white font-bold rounded-xl text-center hover:bg-indigo-700 transition-all"
                  >
                    💬 Novo via Chat
                  </RouterLink>
                </div>
              </div>
              )}

              <div className="bg-slate-900 dark:bg-slate-800 rounded-2xl p-6 text-white border border-slate-800 dark:border-slate-700">
                <h3 className="font-bold text-indigo-400 text-sm uppercase mb-3 tracking-widest">Resumo</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span>Total de Demandas</span>
                    <span className="font-bold">{demands.length}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span>Aguardando Cotação</span>
                    <span className="font-bold">{stats.pending}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-t border-slate-800 pt-3">
                    <span className="text-slate-400">Última atualização</span>
                    <span className="text-emerald-400 font-medium">{new Date().toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Modal de Cotação */}
          {selectedDemand && (
            <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 dark:border-slate-700">
                <div className="bg-indigo-600 p-6 text-white">
                  <h2 className="text-xl font-bold">Cotar Demanda</h2>
                  <p className="text-indigo-100 text-sm">
                    {selectedDemand.origin} → {selectedDemand.destination}
                  </p>
                </div>

                <div className="p-8 space-y-6">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 block">Mercadoria</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{selectedDemand.commodity}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 block">Peso</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{selectedDemand.weight}kg</span>
                    </div>
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 block">Valor NF</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">R$ {selectedDemand.nfValue.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 block">Volume</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{selectedDemand.volume} m³</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">
                      Valor da Cotação (R$)
                    </label>
                    <input
                      type="number"
                      className="w-full p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-2xl text-indigo-600 dark:text-indigo-400"
                      value={quotePrice}
                      onChange={e => setQuotePrice(e.target.value)}
                      placeholder="0,00"
                      autoFocus
                    />
                  </div>

                  <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800 flex gap-3 items-center">
                    <div className="w-10 h-10 bg-white dark:bg-slate-800 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-sm">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                    </div>
                    <div className="text-xs text-indigo-800 dark:text-indigo-200 leading-relaxed">
                      Classe de Risco <strong>{selectedDemand.riskClass}</strong> |
                      Intenção: <strong>{selectedDemand.intentType}</strong>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-slate-50 dark:bg-slate-800/50 flex gap-3">
                  <button
                    onClick={() => {
                      setSelectedDemand(null);
                      setQuotePrice('');
                    }}
                    className="flex-1 px-4 py-3 font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={!quotePrice}
                    onClick={handleQuote}
                    className="flex-1 px-4 py-3 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 disabled:opacity-50"
                  >
                    Enviar Cotação
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
          )}
      </>
      )}
    </div>
  );
};

export default AdminDashboard;
