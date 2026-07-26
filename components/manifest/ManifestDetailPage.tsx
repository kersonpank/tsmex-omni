// components/manifest/ManifestDetailPage.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { manifestsApi, hubsApi, linksApi, fiscalEmittersApi } from '../../lib/api';
import type { Manifest, ResolvedOrderSummary, Hub, Link, FiscalEmitter, Driver } from '../../types/index';
import EmptyState from '../ui/EmptyState';
import ErrorPanel from '../ui/ErrorPanel';
import LoadingPanel from '../ui/LoadingPanel';
import InlineNotice from '../ui/InlineNotice';
import StatusBadge from '../ui/StatusBadge';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import OrderScanInput from '../ui/OrderScanInput';

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
};

type SectionKey = 'pedidos' | 'paradas' | 'capa' | 'motorista' | 'cartaFrete' | 'fiscal';

const ManifestDetailPage: React.FC = () => {
  const { id } = useParams();
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const isAdmin = user?.roles?.includes('ADMIN') ?? false;
  const isHubOnly = isHub && !isAdmin;
  const backPath = isHub && !isAdmin ? '/hub' : '/gestao?cat=transport&sub=viagens';

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    pedidos: true,
    paradas: true,
    capa: false,
    motorista: false,
    cartaFrete: false,
    fiscal: false,
  });
  const [addingOrderId, setAddingOrderId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [fiscalEmitters, setFiscalEmitters] = useState<FiscalEmitter[]>([]);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStopForm, setNewStopForm] = useState({ destHubId: '', destinationLabel: '', destCity: '', destState: '' });
  const [showCapaForm, setShowCapaForm] = useState(false);
  const [capaForm, setCapaForm] = useState({ fiscalEmitterId: '', plannedDepartureAt: '', plannedArrivalAt: '', notes: '', seloLacre: '', liberacao: '' });
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignLinkId, setAssignLinkId] = useState('');
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [driversForLink, setDriversForLink] = useState<Driver[]>([]);
  const [assignDriverId, setAssignDriverId] = useState('');

  const load = async () => {
    if (!id) return;
    if (!manifest) setLoading(true);
    setError(null);
    try {
      const [manRes, hubRes, linkRes, feRes] = await Promise.all([
        manifestsApi.getById(id),
        hubsApi.list(),
        linksApi.list(),
        fiscalEmittersApi.list(),
      ]);
      setManifest(manRes.data ?? null);
      setHubs(((hubRes as any)?.data ?? []) as Hub[]);
      setLinks(((linkRes as any)?.data ?? []) as Link[]);
      setFiscalEmitters(((feRes as any)?.data ?? []) as FiscalEmitter[]);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagem');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id]);

  const toggle = (section: SectionKey) => setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

  const flashSuccess = (msg: string) => {
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    setSuccess(msg);
    successTimeoutRef.current = setTimeout(() => setSuccess(null), 3000);
  };

  const handleOrderResolved = async (order: ResolvedOrderSummary) => {
    if (!id) return;
    setAddingOrderId(order.id);
    setError(null);
    try {
      const res = await manifestsApi.addDemand(id, { orderId: order.id });
      setManifest((prev) => (prev && res.data ? { ...prev, ...res.data } : res.data ?? prev ?? null));
      flashSuccess(`Pedido #${order.id.slice(0, 8)} adicionado à viagem.`);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar pedido');
    } finally {
      setAddingOrderId(null);
    }
  };

  const handleRemoveDemand = async (demandId: string) => {
    if (!id || !window.confirm('Remover este pedido da viagem?')) return;
    setError(null);
    setRemovingId(demandId);
    try {
      await manifestsApi.removeDemand(id, demandId);
      flashSuccess('Pedido removido.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setRemovingId(null);
    }
  };

  const handleAddStop = async () => {
    if (!id || !manifest) return;
    const isTransfer = manifest.tripType === 'TRANSFER';
    if (isTransfer && !newStopForm.destHubId) { setError('Selecione o hub destino desta parada.'); return; }
    if (!isTransfer && !newStopForm.destinationLabel.trim() && !newStopForm.destCity.trim()) {
      setError('Informe um rótulo ou cidade destino para esta parada.');
      return;
    }
    setError(null);
    try {
      await manifestsApi.createStop(id, {
        destHubId: isTransfer ? newStopForm.destHubId : undefined,
        destinationLabel: !isTransfer && newStopForm.destinationLabel.trim() ? newStopForm.destinationLabel.trim() : undefined,
        destCity: !isTransfer && newStopForm.destCity.trim() ? newStopForm.destCity.trim() : undefined,
        destState: !isTransfer && newStopForm.destState.trim() ? newStopForm.destState.trim().toUpperCase() : undefined,
      });
      flashSuccess('Parada adicionada à viagem.');
      setShowAddStop(false);
      setNewStopForm({ destHubId: '', destinationLabel: '', destCity: '', destState: '' });
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar parada');
    }
  };

  const handleCompleteStop = async (stopId: string) => {
    if (!id || !window.confirm('Concluir esta parada? Os pedidos dela mudarão de status.')) return;
    setError(null);
    try {
      const res = await manifestsApi.completeStop(id, stopId);
      const allDone = (res as any)?.data?.allStopsCompleted;
      flashSuccess(allDone ? 'Parada concluída — viagem finalizada.' : 'Parada concluída.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao concluir parada');
    }
  };

  const handleSaveCapa = async () => {
    if (!id) return;
    setError(null);
    try {
      await manifestsApi.updateCapa(id, {
        fiscalEmitterId: capaForm.fiscalEmitterId || undefined,
        plannedDepartureAt: capaForm.plannedDepartureAt ? new Date(capaForm.plannedDepartureAt).toISOString() : undefined,
        plannedArrivalAt: capaForm.plannedArrivalAt ? new Date(capaForm.plannedArrivalAt).toISOString() : undefined,
        notes: capaForm.notes || undefined,
        seloLacre: capaForm.seloLacre || undefined,
        liberacao: capaForm.liberacao || undefined,
      });
      flashSuccess('Capa da viagem atualizada.');
      setShowCapaForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar capa da viagem');
    }
  };

  const openCapaForm = () => {
    if (!manifest) return;
    setCapaForm({
      fiscalEmitterId: manifest.fiscalEmitterId ?? '',
      plannedDepartureAt: manifest.plannedDepartureAt ? manifest.plannedDepartureAt.slice(0, 16) : '',
      plannedArrivalAt: manifest.plannedArrivalAt ? manifest.plannedArrivalAt.slice(0, 16) : '',
      notes: manifest.notes ?? '',
      seloLacre: manifest.seloLacre ?? '',
      liberacao: manifest.liberacao ?? '',
    });
    setShowCapaForm(true);
  };

  const handleAssignLink = async () => {
    if (!id || !assignLinkId) return;
    setError(null);
    try {
      await manifestsApi.assignLink(id, assignLinkId);
      flashSuccess('Motorista (Link) atribuído.');
      setShowAssignForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao atribuir motorista');
    }
  };

  const openDriverForm = async () => {
    if (!manifest?.linkId) return;
    setShowDriverForm(true);
    setAssignDriverId('');
    try {
      const res = await linksApi.getDrivers(manifest.linkId);
      setDriversForLink(((res as any)?.data ?? []) as Driver[]);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar motoristas do Link');
      setDriversForLink([]);
    }
  };

  const handleAssignDriver = async () => {
    if (!id || !assignDriverId) return;
    setError(null);
    try {
      await manifestsApi.setDriver(id, assignDriverId);
      flashSuccess('Motorista definido.');
      setShowDriverForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao definir motorista');
    }
  };

  const canEditOrders = manifest?.status === 'DRAFT' && (!isHubOnly || manifest?.hubId === user?.hubId);

  if (loading) return <LoadingPanel label="Carregando viagem…" />;
  if (error && !manifest) return <ErrorPanel message={error} onRetry={load} />;
  if (!manifest) return <EmptyState title="Viagem não encontrada" description="Não foi possível localizar esta viagem." />;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RouterLink
          to={backPath}
          className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          Voltar para viagens
        </RouterLink>
        <StatusBadge label={statusLabels[manifest.status] ?? manifest.status} tone={manifest.status === 'COMPLETED' ? 'success' : 'info'} />
        <span className="font-bold text-tower-900 dark:text-tower-50">{manifest.origin} → {manifest.destination}</span>
      </div>

      {error && <InlineNotice variant="error" message={error} onDismiss={() => setError(null)} />}
      {success && <InlineNotice variant="success" message={success} onDismiss={() => setSuccess(null)} />}

      <CollapsibleSection title="Pedidos" sectionKey="pedidos" expanded={expanded.pedidos} onToggle={toggle}>
        {canEditOrders && (
          <div className="mb-4">
            <OrderScanInput manifestId={id} onResolved={handleOrderResolved} disabled={addingOrderId !== null} />
          </div>
        )}
        {manifest.demands && manifest.demands.length > 0 ? (
          <ul className="space-y-1">
            {manifest.demands.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm border-b border-tower-100 dark:border-tower-800 py-2 last:border-0">
                <span>{d.origin} → {d.destination} · {d.commodity} · {d.weight}kg</span>
                {canEditOrders && (
                  <button
                    type="button"
                    onClick={() => handleRemoveDemand(d.id)}
                    disabled={removingId === d.id}
                    className="text-red-600 hover:underline disabled:opacity-50"
                  >
                    {removingId === d.id ? 'Removendo…' : 'Remover'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-tower-500 dark:text-tower-400">Nenhum pedido nesta viagem ainda.</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Paradas" sectionKey="paradas" expanded={expanded.paradas} onToggle={toggle}>
        {manifest.tripStops && manifest.tripStops.length > 0 && (
          <ul className="space-y-2 mb-3">
            {manifest.tripStops.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span>
                  #{s.sequence} — {s.destHub ? `${s.destHub.name} (${s.destHub.code})` : (s.destinationLabel ?? s.destCity ?? 'Parada')}
                  {' · '}
                  <StatusBadge label={s.completedAt ? 'Concluída' : 'Pendente'} tone={s.completedAt ? 'success' : 'warning'} />
                </span>
                {manifest.status === 'IN_PROGRESS' && !s.completedAt && (
                  <button type="button" onClick={() => handleCompleteStop(s.id)} className="rounded-lg bg-brand-600 px-3 py-1 text-xs text-white hover:bg-brand-700">
                    Concluir parada
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEditOrders && !showAddStop && (
          <button type="button" onClick={() => setShowAddStop(true)} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
            + Adicionar parada
          </button>
        )}
        {showAddStop && (
          <div className="flex gap-2 items-end flex-wrap mt-2">
            {manifest.tripType === 'TRANSFER' ? (
              <div className="flex-1 min-w-[240px]">
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Hub destino desta parada</label>
                <select value={newStopForm.destHubId} onChange={(e) => setNewStopForm((f) => ({ ...f, destHubId: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                  <option value="">Selecione</option>
                  {hubs.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
                </select>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Rótulo/cliente</label>
                  <input value={newStopForm.destinationLabel} onChange={(e) => setNewStopForm((f) => ({ ...f, destinationLabel: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" placeholder="Ex: Loja Centro" />
                </div>
                <div className="min-w-[160px]">
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Cidade destino</label>
                  <input value={newStopForm.destCity} onChange={(e) => setNewStopForm((f) => ({ ...f, destCity: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" placeholder="Ex: São Luís" />
                </div>
                <div className="w-24">
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">UF</label>
                  <input value={newStopForm.destState} onChange={(e) => setNewStopForm((f) => ({ ...f, destState: e.target.value }))} maxLength={2} className="w-full px-3 py-2 border border-tower-200 rounded-lg" placeholder="MA" />
                </div>
              </>
            )}
            <button type="button" onClick={handleAddStop} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Adicionar</button>
            <button type="button" onClick={() => setShowAddStop(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Capa da viagem" sectionKey="capa" expanded={expanded.capa} onToggle={toggle}>
        {!showCapaForm ? (
          <button type="button" onClick={openCapaForm} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
            Editar capa
          </button>
        ) : (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Empresa emitente</label>
                <select value={capaForm.fiscalEmitterId} onChange={(e) => setCapaForm((f) => ({ ...f, fiscalEmitterId: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                  <option value="">Sem emitente definido</option>
                  {fiscalEmitters.map((fe) => <option key={fe.id} value={fe.id}>{fe.displayName || fe.tradeName || fe.id.slice(0, 8)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Saída prevista</label>
                <input type="datetime-local" value={capaForm.plannedDepartureAt} onChange={(e) => setCapaForm((f) => ({ ...f, plannedDepartureAt: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Previsão de chegada</label>
                <input type="datetime-local" value={capaForm.plannedArrivalAt} onChange={(e) => setCapaForm((f) => ({ ...f, plannedArrivalAt: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Lacre(s)</label>
                <input value={capaForm.seloLacre} onChange={(e) => setCapaForm((f) => ({ ...f, seloLacre: e.target.value }))} placeholder="Ex: 25897, 25898" className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Liberação</label>
                <input value={capaForm.liberacao} onChange={(e) => setCapaForm((f) => ({ ...f, liberacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Observações</label>
                <textarea value={capaForm.notes} onChange={(e) => setCapaForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={handleSaveCapa} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
              <button type="button" onClick={() => setShowCapaForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Motorista" sectionKey="motorista" expanded={expanded.motorista} onToggle={toggle}>
        <p className="text-sm text-tower-600 dark:text-tower-400 mb-2">
          Link (transportador): {manifest.link?.name ?? 'Nenhum atribuído'}
          {manifest.driver && ` · Motorista: ${manifest.driver.name}`}
        </p>
        <div className="flex gap-2 flex-wrap">
          {!showAssignForm && (
            <button type="button" onClick={() => { setShowAssignForm(true); setAssignLinkId(manifest.linkId || ''); }} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
              {manifest.linkId ? 'Trocar Link' : 'Atribuir Link'}
            </button>
          )}
          {manifest.linkId && !showDriverForm && (
            <button type="button" onClick={openDriverForm} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
              {manifest.driver ? 'Trocar motorista' : 'Definir motorista'}
            </button>
          )}
        </div>
        {showAssignForm && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Link (transportador)</label>
              <select value={assignLinkId} onChange={(e) => setAssignLinkId(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Selecione</option>
                {links.filter((l) => l.approvalStatus === 'APPROVED').map((l) => <option key={l.id} value={l.id}>{l.name} ({l.document})</option>)}
              </select>
            </div>
            <button type="button" onClick={handleAssignLink} disabled={!assignLinkId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Atribuir</button>
            <button type="button" onClick={() => setShowAssignForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
        {showDriverForm && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Motorista</label>
              <select value={assignDriverId} onChange={(e) => setAssignDriverId(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Selecione</option>
                {driversForLink.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.document})</option>)}
              </select>
            </div>
            <button type="button" onClick={handleAssignDriver} disabled={!assignDriverId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Definir</button>
            <button type="button" onClick={() => setShowDriverForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
};

export default ManifestDetailPage;
