import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { demandsApi } from '../lib/api';
import type { Demand, DemandStatus } from '../types/index';

// Labels em português
const statusLabels: Record<DemandStatus, string> = {
  PENDING: 'Aguardando Cotação',
  QUOTED: 'Cotação Enviada',
  APPROVED: 'Aprovado pelo Cliente',
  ASSIGNED: 'Alocado em Manifesto',
  COLLECTED: 'Coletado',
  IN_TRANSIT: 'Em Trânsito',
  AWAITING_ARRIVAL: 'Aguardando chegada ao hub',
  AT_HUB: 'No HUB',
  OUT_FOR_DELIVERY: 'Saiu para Entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

const statusColors: Record<DemandStatus, string> = {
  PENDING: 'text-amber-600 dark:text-amber-400',
  QUOTED: 'text-blue-600 dark:text-blue-400',
  APPROVED: 'text-brand-600 dark:text-brand-400',
  ASSIGNED: 'text-purple-600 dark:text-purple-400',
  COLLECTED: 'text-cyan-600 dark:text-cyan-400',
  IN_TRANSIT: 'text-sky-600 dark:text-sky-400',
  AWAITING_ARRIVAL: 'text-indigo-600 dark:text-indigo-400',
  AT_HUB: 'text-orange-600 dark:text-orange-400',
  OUT_FOR_DELIVERY: 'text-teal-600 dark:text-teal-400',
  DELIVERED: 'text-brand-600 dark:text-brand-400',
  CANCELLED: 'text-red-600 dark:text-red-400',
};

// Ordem do fluxo de status para a timeline
const statusOrder: DemandStatus[] = [
  'PENDING',
  'QUOTED',
  'APPROVED',
  'ASSIGNED',
  'COLLECTED',
  'IN_TRANSIT',
  'AWAITING_ARRIVAL',
  'AT_HUB',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

const TrackingView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [demand, setDemand] = useState<Demand | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadDemand(id);
    }
  }, [id]);

  const loadDemand = async (demandId: string) => {
    try {
      setLoading(true);
      setError(null);
      const response = await demandsApi.getById(demandId);
      setDemand(response.data);
    } catch (err: any) {
      console.error('Erro ao carregar demanda:', err);
      setError(err.response?.data?.error || 'Demanda não encontrada');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-100 via-purple-50 to-tower-100 dark:from-brand-900 dark:via-purple-900 dark:to-tower-900 flex items-center justify-center">
        <div className="text-center text-tower-700 dark:text-white">
          <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-brand-600 dark:text-brand-200">Carregando rastreio...</p>
        </div>
      </div>
    );
  }

  if (error || !demand) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-100 via-purple-50 to-tower-100 dark:from-brand-900 dark:via-purple-900 dark:to-tower-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 text-center max-w-md">
          <div className="w-16 h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Demanda não encontrada</h2>
          <p className="text-white/60 mb-6">{error}</p>
          <Link
            to="/"
            className="inline-block px-6 py-3 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 transition-colors"
          >
            Voltar ao Início
          </Link>
        </div>
      </div>
    );
  }

  const currentStatusIndex = statusOrder.indexOf(demand.status);

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-100 via-purple-50 to-tower-100 dark:from-brand-900 dark:via-purple-900 dark:to-tower-900 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-tower-200/80 dark:bg-white/10 backdrop-blur px-4 py-2 rounded-full text-tower-600 dark:text-white/60 text-sm mb-4">
            <span className="w-2 h-2 bg-brand-400 rounded-full animate-pulse"></span>
            Rastreio em Tempo Real
          </div>
          <h1 className="text-3xl font-bold text-tower-900 dark:text-white mb-2">
            {demand.origin} → {demand.destination}
          </h1>
          <p className="text-tower-600 dark:text-white/60 text-sm">
            Pedido #{demand.orderNumber ?? demand.id.slice(0, 8)} | {demand.commodity}
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-white/80 dark:bg-white/10 backdrop-blur-xl border border-tower-200 dark:border-white/20 rounded-3xl p-6 mb-6">
          <div className="text-center">
            <span className={`text-sm font-bold uppercase tracking-wider ${statusColors[demand.status]}`}>
              {statusLabels[demand.status]}
            </span>
            {demand.status === 'DELIVERED' && (
              <div className="mt-4 flex justify-center">
                <div className="w-16 h-16 bg-brand-500 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-white/80 dark:bg-white/10 backdrop-blur-xl border border-tower-200 dark:border-white/20 rounded-3xl p-6 mb-6">
          <h3 className="text-tower-900 dark:text-white font-bold mb-6">Linha do Tempo</h3>
          <div className="space-y-4">
            {demand.events && demand.events.length > 0 ? (
              [...demand.events].reverse().map((event, idx) => (
                <div key={event.id} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-4 h-4 rounded-full ${idx === 0 ? 'bg-brand-400' : 'bg-white/30'}`}></div>
                    {idx < demand.events!.length - 1 && (
                      <div className="w-0.5 h-12 bg-white/20"></div>
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className="text-white font-medium">{event.description}</p>
                    <div className="flex gap-4 mt-1">
                      <span className="text-white/40 text-sm">
                        {new Date(event.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                      <span className="text-white/40 text-sm">
                        {new Date(event.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {event.location && (
                        <span className="text-white/40 text-sm">📍 {event.location}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-white/40 py-8">
                Nenhum evento registrado ainda.
              </div>
            )}
          </div>
        </div>

        {/* Detalhes da Carga */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-6">
          <h3 className="text-white font-bold mb-4">Detalhes da Carga</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-white/40 block">Mercadoria</span>
              <span className="text-white font-medium">{demand.commodity}</span>
            </div>
            <div>
              <span className="text-white/40 block">Peso</span>
              <span className="text-white font-medium">{demand.weight} kg</span>
            </div>
            <div>
              <span className="text-white/40 block">Volume</span>
              <span className="text-white font-medium">{demand.volume} m³</span>
            </div>
            <div>
              <span className="text-white/40 block">Classe de Risco</span>
              <span className={`font-bold ${demand.riskClass === 'A' ? 'text-red-400' : 'text-brand-400'}`}>
                {demand.riskClass}
              </span>
            </div>
            {demand.quotedPrice && (
              <div className="col-span-2">
                <span className="text-white/40 block">Valor do Frete</span>
                <span className="text-brand-400 font-bold text-lg">
                  R$ {demand.quotedPrice.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-white/40 text-xs">
            TSM EX OMNI • Rastreio atualizado em tempo real
          </p>
        </div>
      </div>
    </div>
  );
};

export default TrackingView;
