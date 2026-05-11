import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';
import { hubsApi, locationsApi, usersApi, personsApi } from '../../lib/api';
import type { Hub, Person } from '../../types/index';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Checkbox } from '../ui/Checkbox';
import { FormField } from '../ui/FormField';
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
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);
  const [hubNameFilter, setHubNameFilter] = useState('');
  const [selectedHubId, setSelectedHubId] = useState<string | null>(null);

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (showForm) {
      locationsApi.getStates().then((r: any) => setStates((r?.data ?? r) || [])).catch(() => {});
      personsApi.list({ documentType: 'CNPJ' }).then((r: any) => setPersonsCnpj(Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [])).catch(() => setPersonsCnpj([]));
    }
  }, [showForm]);

  const openNew = useCallback(() => {
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
    setGestaoFilterOpen(false);
  }, []);

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

  const openEdit = useCallback((hub: Hub) => {
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
    setGestaoFilterOpen(false);
  }, []);

  const filteredHubs = useMemo(() => {
    const q = hubNameFilter.trim().toLowerCase();
    if (!q) return hubs;
    return hubs.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.code.toLowerCase().includes(q) ||
        `${h.city} ${h.state}`.toLowerCase().includes(q)
    );
  }, [hubs, hubNameFilter]);

  const hubsGestao = useMemo(
    () => ({
      listActive: !showForm && !gestaoFilterOpen,
      filterOpen: gestaoFilterOpen,
      filterCount: hubNameFilter.trim() ? 1 : 0,
      pills: hubNameFilter.trim()
        ? [{ id: 'hn', label: `Busca: ${hubNameFilter.trim()}`, onRemove: () => setHubNameFilter('') }]
        : [],
      onList: () => {
        setGestaoFilterOpen(false);
        setShowForm(false);
        setEditingId(null);
        void load();
        document.getElementById('hubs-tabela')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      onEdit:
        selectedHubId && hubs.some((h) => h.id === selectedHubId)
          ? () => {
              const h = hubs.find((x) => x.id === selectedHubId);
              if (h) openEdit(h);
            }
          : undefined,
      onNew: openNew,
      disabled: { edit: !selectedHubId } as const,
      labels: {
        edit: selectedHubId ? 'Editar hub selecionado' : 'Selecione um hub na tabela',
      },
    }),
    [showForm, gestaoFilterOpen, hubNameFilter, selectedHubId, hubs, openNew, openEdit, load]
  );

  useRegisterGestaoModuleActions(() => hubsGestao, [hubsGestao]);

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
      <div className="mb-6">
        <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">Hubs (depósitos / filiais)</h2>
      </div>
      {gestaoFilterOpen && (
        <div className="mb-4 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
          <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="hub-q">
            Buscar hub
          </label>
          <input
            id="hub-q"
            type="search"
            value={hubNameFilter}
            onChange={(e) => setHubNameFilter(e.target.value)}
            placeholder="Nome, código ou cidade"
            className="max-w-md rounded-lg border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
          />
        </div>
      )}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
      {showForm && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-700 rounded-xl p-6 shadow-sm">
          <h3 className="font-bold text-tower-800 dark:text-tower-100 mb-4">{editingId ? 'Editar Hub' : 'Novo Hub'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Nome" htmlFor="hub-name" required>
                <Input id="hub-name" type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </FormField>
              <FormField label="Código" htmlFor="hub-code" required>
                <Input id="hub-code" type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required placeholder="ex: SP-GRU" />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Estado" htmlFor="hub-state" required>
                <Select
                  id="hub-state"
                  value={form.state}
                  onChange={e => setForm(f => ({ ...f, state: e.target.value, city: '' }))}
                  required
                >
                  <option value="">Selecione</option>
                  {states.map(s => (
                    <option key={s.id} value={s.code}>{s.code} - {s.name}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Cidade" htmlFor="hub-city" required>
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
                />
              </FormField>
            </div>
            <FormField label="Endereço" htmlFor="hub-address">
              <Input id="hub-address" type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Gerente" htmlFor="hub-manager">
                <Input id="hub-manager" type="text" value={form.managerName} onChange={e => setForm(f => ({ ...f, managerName: e.target.value }))} />
              </FormField>
              <FormField label="Telefone" htmlFor="hub-phone">
                <Input id="hub-phone" type="tel" value={maskPhone(form.phone)} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))} placeholder="(11) 99999-9999" maxLength={15} />
              </FormField>
            </div>
            <FormField label="E-mail" htmlFor="hub-email">
              <Input id="hub-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </FormField>
            <FormField label="Pessoa jurídica (CNPJ)" htmlFor="hub-person" hint="Vinculada para emissão de CT-e/Minuta">
              <Select
                id="hub-person"
                value={form.personId}
                onChange={e => setForm(f => ({ ...f, personId: e.target.value }))}
              >
                <option value="">Nenhuma</option>
                {personsCnpj.map(p => (
                  <option key={p.id} value={p.id}>{p.legalName} – {p.document}</option>
                ))}
              </Select>
            </FormField>
            <Checkbox id="hub-active" label="Ativo" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 bg-tower-200 dark:bg-tower-700 text-tower-700 dark:text-tower-100 rounded-lg hover:bg-tower-300 dark:hover:bg-tower-600">Cancelar</button>
            </div>
          </form>
        </div>
      )}
      {loading ? (
        <div className="py-12 text-center text-tower-500">Carregando...</div>
      ) : hubs.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-tower-200 rounded-xl p-12 text-center text-tower-500 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-400">
          Nenhum hub cadastrado. Use a ação Novo na barra acima.
        </div>
      ) : filteredHubs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-tower-300 bg-tower-50/80 p-8 text-center text-sm text-tower-600 dark:border-tower-600 dark:bg-tower-900/40 dark:text-tower-400">
          Nenhum hub corresponde à busca. Ajuste o filtro ou limpe a busca na barra de ações.
        </div>
      ) : (
        <div id="hubs-tabela" className="overflow-hidden rounded-xl border border-tower-200 bg-white dark:border-tower-600 dark:bg-tower-800">
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
              {filteredHubs.map(hub => (
                <React.Fragment key={hub.id}>
                  <tr
                    className={`cursor-pointer border-b border-tower-100 hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-800/80 ${selectedHubId === hub.id ? 'ring-2 ring-inset ring-brand-400 dark:ring-brand-500' : ''}`}
                    onClick={() => setSelectedHubId(hub.id)}
                  >
                    <td className="py-3 px-4 font-medium text-tower-900 dark:text-tower-100">{hub.name}</td>
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
                          onClick={(e) => {
                            e.stopPropagation();
                            copyCadastroLink(hub.id);
                          }}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleHubUsers(hub.id);
                        }}
                        className="text-amber-600 hover:text-amber-800 text-sm font-medium"
                      >
                        {expandedHubUsers === hub.id ? '▲ Usuários' : '▼ Usuários'}
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(hub); }} className="text-brand-600 hover:text-brand-800 text-sm font-medium">Editar</button>
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
