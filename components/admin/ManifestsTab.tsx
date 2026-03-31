import React, { useState, useEffect } from 'react';
import { manifestsApi, vehicleTypesApi, linksApi, demandsApi, hubsApi } from '../../lib/api';
import type { Manifest, VehicleType, Link, Demand, Hub } from '../../types/index';
import { CityAutocomplete } from '../ui/CityAutocomplete';

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
};

const ManifestsTab: React.FC = () => {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [demandsAvailable, setDemandsAvailable] = useState<Demand[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddDemand, setShowAddDemand] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    vehicleTypeId: '',
    origin: '',
    destination: '',
    hubId: '',
  });
  const [assignLinkId, setAssignLinkId] = useState('');
  const [selectedDemandId, setSelectedDemandId] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [manRes, vtRes, linkRes, hubRes] = await Promise.all([
        manifestsApi.list({}),
        vehicleTypesApi.list(),
        linksApi.list(),
        hubsApi.list(),
      ]);
      const manData = (manRes as any)?.data ?? manRes?.data ?? [];
      setManifests(Array.isArray(manData) ? manData : []);
      const vtData = (vtRes as any)?.data ?? vtRes?.data ?? [];
      setVehicleTypes(Array.isArray(vtData) ? vtData : []);
      const linkData = (linkRes as any)?.data ?? linkRes?.data ?? [];
      setLinks(Array.isArray(linkData) ? linkData : []);
      const hubData = (hubRes as any)?.data ?? hubRes?.data ?? [];
      setHubs(Array.isArray(hubData) ? hubData : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagens');
    } finally {
      setLoading(false);
    }
  };

  const loadDemandsForAdd = async () => {
    try {
      const res = await demandsApi.list({ limit: 100, status: 'APPROVED' });
      const data = (res as any)?.data ?? res?.data ?? [];
      const list = Array.isArray(data) ? data : [];
      setDemandsAvailable(list.filter((d: Demand) => !d.manifestId));
    } catch (_) {
      setDemandsAvailable([]);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.vehicleTypeId || !createForm.origin.trim() || !createForm.destination.trim()) {
      setError('Preencha tipo de veículo, origem e destino.');
      return;
    }
    setError(null);
    try {
      await manifestsApi.create({
        vehicleTypeId: createForm.vehicleTypeId,
        origin: createForm.origin,
        destination: createForm.destination,
        hubId: createForm.hubId || undefined,
      });
      setSuccess('Viagem criada.');
      setShowCreate(false);
      setCreateForm({ vehicleTypeId: '', origin: '', destination: '', hubId: '' });
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao criar viagem');
    }
  };

  const openAddDemand = (manifestId: string) => {
    setShowAddDemand(manifestId);
    setSelectedDemandId('');
    loadDemandsForAdd();
  };

  const handleAddDemand = async () => {
    if (!showAddDemand || !selectedDemandId) return;
    setError(null);
    try {
      await manifestsApi.addDemand(showAddDemand, selectedDemandId);
      setSuccess('Demanda adicionada à viagem.');
      setShowAddDemand(null);
      setSelectedDemandId('');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar demanda');
    }
  };

  const handleRemoveDemand = async (manifestId: string, demandId: string) => {
    if (!window.confirm('Remover esta demanda da viagem?')) return;
    setError(null);
    try {
      await manifestsApi.removeDemand(manifestId, demandId);
      setSuccess('Demanda removida.');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const handleAssign = async () => {
    if (!showAssign || !assignLinkId) return;
    setError(null);
    try {
      await manifestsApi.assignLink(showAssign, assignLinkId);
      setSuccess('Motorista atribuído.');
      setShowAssign(null);
      setAssignLinkId('');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao atribuir motorista');
    }
  };

  const handleOffer = async (id: string) => {
    setError(null);
    try {
      await manifestsApi.offerToLink(id);
      setSuccess('Oferta enviada ao motorista.');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-slate-700">Viagens (Manifestos)</h2>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700"
        >
          + Nova viagem
        </button>
      </div>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-sm">{success}</div>
      )}

      {showCreate && (
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-4">Nova viagem</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de veículo</label>
              <select
                value={createForm.vehicleTypeId}
                onChange={(e) => setCreateForm((f) => ({ ...f, vehicleTypeId: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                required
              >
                <option value="">Selecione</option>
                {vehicleTypes.filter((vt) => vt.active).map((vt) => (
                  <option key={vt.id} value={vt.id}>{vt.name} ({vt.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Hub (opcional)</label>
              <select
                value={createForm.hubId}
                onChange={(e) => setCreateForm((f) => ({ ...f, hubId: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              >
                <option value="">Nenhum</option>
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Origem</label>
              <CityAutocomplete
                value={createForm.origin}
                onChange={(v) => setCreateForm((f) => ({ ...f, origin: v }))}
                placeholder="Ex: São Paulo, SP"
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Destino</label>
              <CityAutocomplete
                value={createForm.destination}
                onChange={(v) => setCreateForm((f) => ({ ...f, destination: v }))}
                placeholder="Ex: Imperatriz, MA"
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700">Criar</button>
              <button type="button" onClick={() => { setShowCreate(false); setError(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {showAddDemand && (
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-4">Adicionar demanda à viagem</h3>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">Demanda aprovada (sem viagem)</label>
              <select
                value={selectedDemandId}
                onChange={(e) => setSelectedDemandId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              >
                <option value="">Selecione</option>
                {demandsAvailable.map((d) => (
                  <option key={d.id} value={d.id}>{d.origin} → {d.destination} (#{d.id.slice(0, 8)})</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={handleAddDemand} disabled={!selectedDemandId} className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">Adicionar</button>
            <button type="button" onClick={() => { setShowAddDemand(null); setSelectedDemandId(''); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Fechar</button>
          </div>
        </div>
      )}

      {showAssign && (
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-4">Atribuir motorista (Link)</h3>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">Motorista</label>
              <select
                value={assignLinkId}
                onChange={(e) => setAssignLinkId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              >
                <option value="">Selecione</option>
                {links.filter((l) => l.approvalStatus === 'APPROVED').map((l) => (
                  <option key={l.id} value={l.id}>{l.name} ({l.document})</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={handleAssign} disabled={!assignLinkId} className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">Atribuir</button>
            <button type="button" onClick={() => { setShowAssign(null); setAssignLinkId(''); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Fechar</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-slate-500">Carregando...</div>
      ) : manifests.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-500">Nenhuma viagem cadastrada.</div>
      ) : (
        <div className="space-y-4">
          {manifests.map((m) => (
            <div key={m.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-slate-400">#{m.id.slice(0, 8)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${m.status === 'DRAFT' ? 'bg-slate-100 text-slate-600' : m.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                    {statusLabels[m.status] ?? m.status}
                  </span>
                  <span className="font-bold text-slate-900">{m.origin} → {m.destination}</span>
                  {m.vehicleType && <span className="text-slate-500 text-sm">({m.vehicleType.name})</span>}
                  {m.link && <span className="text-slate-600 text-sm">· Motorista: {m.link.name}</span>}
                </div>
                <div className="flex gap-2">
                  {m.status === 'DRAFT' && (
                    <>
                      <button type="button" onClick={() => openAddDemand(m.id)} className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">+ Demanda</button>
                      <button type="button" onClick={() => { setShowAssign(m.id); setAssignLinkId(m.linkId || ''); }} className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Atribuir motorista</button>
                      {m.demands && m.demands.length > 0 && (
                        <button type="button" onClick={() => handleOffer(m.id)} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Enviar oferta</button>
                      )}
                    </>
                  )}
                  {(m.status === 'PENDING_ACCEPT' || m.status === 'ACCEPTED') && (
                    <button
                      type="button"
                      onClick={async () => {
                        setError(null);
                        try {
                          await manifestsApi.start(m.id);
                          setSuccess('Viagem iniciada.');
                          load();
                          setTimeout(() => setSuccess(null), 3000);
                        } catch (e: any) {
                          setError(e.response?.data?.error || e.message || 'Erro ao iniciar viagem');
                        }
                      }}
                      className="px-3 py-1.5 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700"
                    >
                      Iniciar viagem
                    </button>
                  )}
                  {m.status === 'IN_PROGRESS' && (
                    <button
                      type="button"
                      onClick={async () => {
                        setError(null);
                        try {
                          await manifestsApi.complete(m.id);
                          setSuccess('Viagem concluída.');
                          load();
                          setTimeout(() => setSuccess(null), 3000);
                        } catch (e: any) {
                          setError(e.response?.data?.error || e.message || 'Erro ao concluir viagem');
                        }
                      }}
                      className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                    >
                      Concluir viagem
                    </button>
                  )}
                </div>
              </div>
              {m.demands && m.demands.length > 0 && (
                <div className="border-t border-slate-100 pt-3 mt-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase">Demandas na viagem</span>
                  <ul className="mt-1 space-y-1">
                    {m.demands.map((d) => (
                      <li key={d.id} className="flex items-center justify-between text-sm">
                        <span>{d.origin} → {d.destination} · {d.commodity} · {d.weight}kg</span>
                        {m.status === 'DRAFT' && (
                          <button type="button" onClick={() => handleRemoveDemand(m.id, d.id)} className="text-red-600 hover:underline">Remover</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ManifestsTab;
