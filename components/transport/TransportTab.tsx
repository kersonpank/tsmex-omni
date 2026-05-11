import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { pricingApi } from '../../lib/api';
import type { PricingRoute } from '../../types/index';
import { useRegisterGestaoModuleActions } from '../admin/layout/GestaoModuleActionsContext';

type RouteWithCount = PricingRoute & { _count?: { tables: number } };

const TransportTab: React.FC = () => {
  const [routes, setRoutes] = useState<RouteWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    originCode: '',
    originName: '',
    destCode: '',
    destName: '',
  });

  const loadRoutes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await pricingApi.listRoutes({ includeInactive });
      setRoutes(res.data || []);
    } catch (err: any) {
      console.error(err);
      setError(err?.response?.data?.error || 'Erro ao carregar rotas');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const openNew = useCallback(() => {
    setEditingId(null);
    setForm({ name: '', originCode: '', originName: '', destCode: '', destName: '' });
    setShowForm(true);
    setGestaoFilterOpen(false);
  }, []);

  const openEdit = useCallback(async (id: string) => {
    try {
      const res = await pricingApi.getRouteById(id);
      const r = res.data;
      if (r) {
        setForm({
          name: r.name,
          originCode: r.originCode,
          originName: r.originName,
          destCode: r.destCode,
          destName: r.destName,
        });
        setEditingId(id);
        setShowForm(true);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao carregar rota');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.originCode.trim() || !form.originName.trim() || !form.destCode.trim() || !form.destName.trim()) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }
    try {
      setError(null);
      if (editingId) {
        await pricingApi.updateRoute(editingId, form);
        setSuccess('Rota atualizada com sucesso.');
      } else {
        await pricingApi.createRoute(form);
        setSuccess('Rota criada com sucesso.');
      }
      setShowForm(false);
      setEditingId(null);
      loadRoutes();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao salvar rota');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!window.confirm('Desativar esta rota? Ela não aparecerá nas listas ativas, mas tarifas vinculadas manterão a referência.')) return;
    try {
      setError(null);
      await pricingApi.deleteRoute(id);
      setSuccess('Rota desativada.');
      loadRoutes();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao desativar rota');
    }
  };

  const filteredRoutes = routes.filter(
    (r) => !nameFilter.trim() || r.name.toLowerCase().includes(nameFilter.toLowerCase())
  );

  const transportGestao = useMemo(
    () => ({
      listActive: !showForm && !gestaoFilterOpen,
      filterOpen: gestaoFilterOpen,
      filterCount: (nameFilter.trim() ? 1 : 0) + (includeInactive ? 1 : 0),
      pills: [
        ...(nameFilter.trim()
          ? [{ id: 'nm', label: `Nome: ${nameFilter.trim()}`, onRemove: () => setNameFilter('') }]
          : []),
        ...(includeInactive
          ? [{ id: 'in', label: 'Inativas visíveis', onRemove: () => setIncludeInactive(false) }]
          : []),
      ],
      onList: () => {
        setGestaoFilterOpen(false);
        setShowForm(false);
        setEditingId(null);
        void loadRoutes();
        document.getElementById('transport-rotas-tabela')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      onEdit: selectedRouteId ? () => void openEdit(selectedRouteId) : undefined,
      onNew: openNew,
      disabled: { edit: !selectedRouteId } as const,
      labels: {
        edit: selectedRouteId ? 'Editar rota selecionada na tabela' : 'Selecione uma linha na tabela para editar',
      },
    }),
    [
      showForm,
      gestaoFilterOpen,
      nameFilter,
      includeInactive,
      selectedRouteId,
      openNew,
      openEdit,
      loadRoutes,
    ]
  );

  useRegisterGestaoModuleActions(() => transportGestao, [transportGestao]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">Rotas</h2>
      </div>
      {gestaoFilterOpen && (
        <div className="mb-4 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="rt-nm">
                Filtrar por nome
              </label>
              <input
                id="rt-nm"
                type="text"
                placeholder="Nome da rota"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                className="w-48 rounded-lg border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-tower-600 dark:text-tower-300">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="rounded"
              />
              Mostrar inativas
            </label>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 bg-brand-50 border border-brand-200 text-brand-800 px-4 py-3 rounded-xl text-sm">
          {success}
        </div>
      )}

      {showForm && (
        <div className="mb-6 bg-white border border-tower-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-tower-800 mb-4">
            {editingId ? 'Editar rota' : 'Nova rota'}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-tower-700 mb-1">Nome</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                placeholder="Ex: São Paulo → São Luís"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Código origem</label>
              <input
                type="text"
                value={form.originCode}
                onChange={(e) => setForm((f) => ({ ...f, originCode: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Nome origem</label>
              <input
                type="text"
                value={form.originName}
                onChange={(e) => setForm((f) => ({ ...f, originName: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Código destino</label>
              <input
                type="text"
                value={form.destCode}
                onChange={(e) => setForm((f) => ({ ...f, destCode: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Nome destino</label>
              <input
                type="text"
                value={form.destName}
                onChange={(e) => setForm((f) => ({ ...f, destName: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700"
              >
                {editingId ? 'Salvar' : 'Criar rota'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingId(null); setError(null); }}
                className="px-4 py-2 text-tower-600 hover:bg-tower-100 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-tower-500">Carregando rotas...</div>
      ) : filteredRoutes.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-tower-200 rounded-xl p-12 text-center text-tower-400">
          Nenhuma rota encontrada. Crie uma rota para vincular às tarifas.
        </div>
      ) : (
        <div id="transport-rotas-tabela" className="overflow-hidden rounded-xl border border-tower-200 bg-white dark:border-tower-600 dark:bg-tower-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-tower-50 border-b border-tower-200">
                  <th className="text-left py-3 px-4 font-semibold text-tower-700">Nome</th>
                  <th className="text-left py-3 px-4 font-semibold text-tower-700">Origem</th>
                  <th className="text-left py-3 px-4 font-semibold text-tower-700">Destino</th>
                  <th className="text-left py-3 px-4 font-semibold text-tower-700">Tabelas</th>
                  <th className="text-left py-3 px-4 font-semibold text-tower-700">Status</th>
                  <th className="text-right py-3 px-4 font-semibold text-tower-700">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoutes.map((r) => (
                  <tr
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedRouteId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedRouteId(r.id);
                      }
                    }}
                    className={`cursor-pointer border-b border-tower-100 hover:bg-tower-50 ${!r.active ? 'bg-tower-50 opacity-75' : ''} ${selectedRouteId === r.id ? 'ring-2 ring-inset ring-brand-400 dark:ring-brand-500' : ''}`}
                  >
                    <td className="py-3 px-4 text-tower-800">{r.name}</td>
                    <td className="py-3 px-4 text-tower-600">{r.originName}</td>
                    <td className="py-3 px-4 text-tower-600">{r.destName}</td>
                    <td className="py-3 px-4 text-tower-600">{r._count?.tables ?? 0}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          r.active ? 'bg-brand-100 text-brand-700' : 'bg-tower-200 text-tower-600'
                        }`}
                      >
                        {r.active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openEdit(r.id);
                        }}
                        className="mr-3 font-medium text-brand-600 hover:text-brand-800"
                      >
                        Editar
                      </button>
                      {r.active && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeactivate(r.id);
                          }}
                          className="font-medium text-red-600 hover:text-red-800"
                        >
                          Desativar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransportTab;
