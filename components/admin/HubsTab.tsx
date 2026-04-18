import React, { useState, useEffect } from 'react';
import { hubsApi, locationsApi, usersApi, personsApi } from '../../lib/api';
import type { Hub, Person } from '../../types/index';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import { maskPhone } from '../../lib/formatters';

const HUB_PERM_OPTIONS = [
  { id: 'entrada', label: 'Entrada' },
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'manifestos', label: 'Manifestos' },
  { id: 'demandas', label: 'Demandas' },
];

function HubUsersRow({
  users,
  loading,
  onUpdatePermissions,
}: {
  users: any[];
  loading: boolean;
  onUpdatePermissions: (userId: string, permissions: string[]) => Promise<void>;
}) {
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);

  const startEdit = (user: any) => {
    setEditingUserId(user.id);
    setEditPerms(user.permissions ?? []);
  };

  const saveEdit = async () => {
    if (!editingUserId) return;
    await onUpdatePermissions(editingUserId, editPerms);
    setEditingUserId(null);
  };

  const togglePerm = (id: string) => {
    setEditPerms((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  if (loading) return <div className="text-sm text-tower-500 py-2">Carregando usuários...</div>;
  if (users.length === 0) return <div className="text-sm text-tower-500 py-2">Nenhum usuário neste hub.</div>;

  return (
    <div className="space-y-3">
      <span className="text-xs font-semibold text-tower-500 uppercase">Operadores do hub</span>
      {users.map((u) => (
        <div key={u.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-tower-200 last:border-0">
          <span className="font-medium text-tower-800">{u.email}</span>
          {editingUserId === u.id ? (
            <>
              <div className="flex gap-2 flex-wrap">
                {HUB_PERM_OPTIONS.map((p) => (
                  <label key={p.id} className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={editPerms.includes(p.id)} onChange={() => togglePerm(p.id)} className="rounded" />
                    <span className="text-xs">{p.label}</span>
                  </label>
                ))}
              </div>
              <button type="button" onClick={saveEdit} className="px-2 py-1 text-xs bg-brand-600 text-white rounded hover:bg-brand-700">Salvar</button>
              <button type="button" onClick={() => setEditingUserId(null)} className="px-2 py-1 text-xs text-tower-600 hover:bg-tower-200 rounded">Cancelar</button>
            </>
          ) : (
            <>
              <span className="text-xs text-tower-500">
                {((u.permissions as string[]) ?? []).length > 0 ? (u.permissions as string[]).join(', ') : 'Sem permissões'}
              </span>
              <button type="button" onClick={() => startEdit(u)} className="text-xs text-brand-600 hover:underline">Editar permissões</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function getHubCadastroUrl(hubId: string): string {
  if (typeof window === 'undefined') return '';
  const base = `${window.location.origin}${window.location.pathname || '/'}`;
  return `${base}#/hub/cadastro?hubId=${hubId}`;
}

const HubsTab: React.FC = () => {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [states, setStates] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedHubUsers, setExpandedHubUsers] = useState<string | null>(null);
  const [hubUsers, setHubUsers] = useState<Record<string, any[]>>({});
  const [personsCnpj, setPersonsCnpj] = useState<Person[]>([]);
  const [form, setForm] = useState({
    name: '',
    code: '',
    city: '',
    state: '',
    address: '',
    coverageCities: [] as string[],
    managerName: '',
    phone: '',
    email: '',
    active: true,
    personId: '',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hubsApi.list();
      const data = (res as any)?.data ?? res;
      setHubs(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar hubs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (showForm) {
      locationsApi.getStates().then((r: any) => setStates((r?.data ?? r) || [])).catch(() => {});
      personsApi.list({ documentType: 'CNPJ' }).then((r: any) => setPersonsCnpj(Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [])).catch(() => setPersonsCnpj([]));
    }
  }, [showForm]);

  const openNew = () => {
    setEditingId(null);
    setForm({
      name: '',
      code: '',
      city: '',
      state: '',
      address: '',
      coverageCities: [],
      managerName: '',
      phone: '',
      email: '',
      active: true,
      personId: '',
    });
    setShowForm(true);
  };

  const copyCadastroLink = (hubId: string) => {
    const url = getHubCadastroUrl(hubId);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(hubId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const loadHubUsers = async (hubId: string) => {
    try {
      const res = await usersApi.list({ role: 'HUB', hubId });
      const data = (res as any)?.data ?? res;
      setHubUsers((prev) => ({ ...prev, [hubId]: Array.isArray(data) ? data : [] }));
    } catch {
      setHubUsers((prev) => ({ ...prev, [hubId]: [] }));
    }
  };

  const toggleHubUsers = (hubId: string) => {
    if (expandedHubUsers === hubId) {
      setExpandedHubUsers(null);
    } else {
      setExpandedHubUsers(hubId);
      if (!hubUsers[hubId]) loadHubUsers(hubId);
    }
  };

  const handleUpdatePermissions = async (userId: string, permissions: string[]) => {
    try {
      await usersApi.updatePermissions(userId, permissions);
      const hubId = expandedHubUsers;
      if (hubId) loadHubUsers(hubId);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao atualizar permissões');
    }
  };

  const openEdit = (hub: Hub) => {
    setEditingId(hub.id);
    setForm({
      name: hub.name,
      code: hub.code,
      city: hub.city,
      state: hub.state,
      address: hub.address ?? '',
      coverageCities: hub.coverageCities ?? [],
      managerName: hub.managerName ?? '',
      phone: hub.phone ?? '',
      email: hub.email ?? '',
      active: hub.active ?? true,
      personId: hub.personId ?? '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim() || !form.city.trim() || !form.state.trim()) {
      setError('Preencha nome, código, cidade e estado.');
      return;
    }
    setError(null);
    try {
      const payload: Partial<Hub> = {
        name: form.name,
        code: form.code,
        city: form.city,
        state: form.state,
        address: form.address || undefined,
        coverageCities: form.coverageCities.length ? form.coverageCities : [],
        managerName: form.managerName || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        active: form.active,
        personId: form.personId || null,
      };
      if (editingId) {
        await hubsApi.update(editingId, { ...payload, coverageCities: form.coverageCities.length ? form.coverageCities : undefined });
      } else {
        await hubsApi.create(payload);
      }
      setShowForm(false);
      setEditingId(null);
      load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar');
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h2 className="text-lg font-bold text-tower-700">Hubs (depósitos / filiais)</h2>
        <button
          type="button"
          onClick={openNew}
          className="px-4 py-2 text-sm bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700"
        >
          + Novo Hub
        </button>
      </div>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
      {showForm && (
        <div className="mb-6 bg-white border border-tower-200 rounded-xl p-6 shadow-sm">
          <h3 className="font-bold text-tower-800 mb-4">{editingId ? 'Editar Hub' : 'Novo Hub'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-tower-600 mb-1">Nome *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-600 mb-1">Código *</label>
                <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" required placeholder="ex: SP-GRU" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-tower-600 mb-1">Estado *</label>
                <select
                  value={form.state}
                  onChange={e => setForm(f => ({ ...f, state: e.target.value, city: '' }))}
                  className="w-full border border-tower-300 rounded-lg px-3 py-2"
                  required
                >
                  <option value="">Selecione</option>
                  {states.map(s => (
                    <option key={s.id} value={s.code}>{s.code} - {s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-600 mb-1">Cidade *</label>
                <CityAutocomplete
                  value={form.city && form.state ? `${form.city}, ${form.state}` : (form.city || '')}
                  onChange={v => {
                    const parts = v.split(', ');
                    if (parts.length >= 2) setForm(f => ({ ...f, city: parts[0], state: parts[1] }));
                    else setForm(f => ({ ...f, city: v }));
                  }}
                  onSelect={(city, state) => setForm(f => ({ ...f, city, state }))}
                  placeholder="Ex: São Paulo"
                  state={form.state || undefined}
                  required
                  className="w-full border border-tower-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-600 mb-1">Endereço</label>
              <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-tower-600 mb-1">Gerente</label>
                <input type="text" value={form.managerName} onChange={e => setForm(f => ({ ...f, managerName: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-600 mb-1">Telefone</label>
                <input type="tel" value={maskPhone(form.phone)} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" placeholder="(11) 99999-9999" maxLength={15} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-600 mb-1">E-mail</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-600 mb-1">Pessoa jurídica (CNPJ)</label>
              <select
                value={form.personId}
                onChange={e => setForm(f => ({ ...f, personId: e.target.value }))}
                className="w-full border border-tower-300 rounded-lg px-3 py-2"
              >
                <option value="">Nenhuma</option>
                {personsCnpj.map(p => (
                  <option key={p.id} value={p.id}>{p.legalName} – {p.document}</option>
                ))}
              </select>
              <p className="text-xs text-tower-500 mt-1">Vinculada para emissão de CT-e/Minuta</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="hub-active" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              <label htmlFor="hub-active" className="text-sm text-tower-600">Ativo</label>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 bg-tower-200 text-tower-700 rounded-lg hover:bg-tower-300">Cancelar</button>
            </div>
          </form>
        </div>
      )}
      {loading ? (
        <div className="py-12 text-center text-tower-500">Carregando...</div>
      ) : hubs.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-tower-200 rounded-xl p-12 text-center text-tower-500">Nenhum hub cadastrado. Clique em Novo Hub.</div>
      ) : (
        <div className="bg-white border border-tower-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-tower-50 border-b border-tower-200">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Nome</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Código</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">CNPJ</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Cidade / Estado</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Status</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Link de cadastro</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-tower-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {hubs.map(hub => (
                <React.Fragment key={hub.id}>
                  <tr className="border-b border-tower-100 hover:bg-tower-50">
                    <td className="py-3 px-4 font-medium text-tower-900">{hub.name}</td>
                    <td className="py-3 px-4 text-tower-600">{hub.code}</td>
                    <td className="py-3 px-4 text-tower-600">{hub.person?.document ?? '—'}</td>
                    <td className="py-3 px-4 text-tower-600">{hub.city} / {hub.state}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${hub.active ? 'bg-brand-100 text-brand-700' : 'bg-tower-100 text-tower-600'}`}>
                        {hub.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {hub.active && (
                        <button
                          type="button"
                          onClick={() => copyCadastroLink(hub.id)}
                          className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                          title="Copiar link para cadastro de usuários"
                        >
                          {copiedId === hub.id ? '✓ Copiado!' : '📋 Copiar link'}
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => toggleHubUsers(hub.id)}
                        className="text-amber-600 hover:text-amber-800 text-sm font-medium"
                      >
                        {expandedHubUsers === hub.id ? '▲ Usuários' : '▼ Usuários'}
                      </button>
                      <button type="button" onClick={() => openEdit(hub)} className="text-brand-600 hover:text-brand-800 text-sm font-medium">Editar</button>
                      </div>
                    </td>
                  </tr>
                  {expandedHubUsers === hub.id && (
                    <tr>
                      <td colSpan={7} className="py-4 px-4 bg-tower-50">
                        <HubUsersRow
                          users={hubUsers[hub.id] ?? []}
                          loading={!hubUsers[hub.id] && expandedHubUsers === hub.id}
                          onUpdatePermissions={handleUpdatePermissions}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default HubsTab;
