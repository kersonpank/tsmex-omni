import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';
import { vehicleTypesApi } from '../../lib/api';
import type { VehicleType } from '../../types/index';

const FrotaTab: React.FC = () => {
  const [list, setList] = useState<VehicleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedVtId, setSelectedVtId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    code: '',
    maxWeight: 0,
    maxVolume: 0,
    maxValue: 0,
    enclosed: true,
    refrigerated: false,
    active: true,
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await vehicleTypesApi.list();
      const data = (res as any)?.data ?? res;
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar tipos de veículo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = useCallback(() => {
    setEditingId(null);
    setForm({
      name: '',
      code: '',
      maxWeight: 0,
      maxVolume: 0,
      maxValue: 0,
      enclosed: true,
      refrigerated: false,
      active: true,
    });
    setShowForm(true);
    setGestaoFilterOpen(false);
  }, []);

  const openEdit = (vt: VehicleType) => {
    setEditingId(vt.id);
    setForm({
      name: vt.name,
      code: vt.code,
      maxWeight: vt.maxWeight,
      maxVolume: vt.maxVolume,
      maxValue: vt.maxValue,
      enclosed: vt.enclosed,
      refrigerated: vt.refrigerated,
      active: vt.active,
    });
    setShowForm(true);
    setGestaoFilterOpen(false);
  };

  const filteredList = useMemo(() => {
    if (filterActive === 'all') return list;
    if (filterActive === 'active') return list.filter((v) => v.active);
    return list.filter((v) => !v.active);
  }, [list, filterActive]);

  const frotaGestao = useMemo(
    () => ({
      listActive: !showForm && !gestaoFilterOpen,
      filterOpen: gestaoFilterOpen,
      filterCount: filterActive === 'all' ? 0 : 1,
      pills:
        filterActive === 'all'
          ? []
          : [
              {
                id: 'act',
                label: filterActive === 'active' ? 'Somente ativos' : 'Somente inativos',
                onRemove: () => setFilterActive('all'),
              },
            ],
      onList: () => {
        setGestaoFilterOpen(false);
        setShowForm(false);
        setEditingId(null);
        void load();
        document.getElementById('frota-tabela')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      onEdit: selectedVtId
        ? () => {
            const vt = list.find((x) => x.id === selectedVtId);
            if (vt) openEdit(vt);
          }
        : undefined,
      onNew: openNew,
      disabled: { edit: !selectedVtId } as const,
      labels: {
        edit: selectedVtId ? 'Editar tipo selecionado' : 'Selecione uma linha na tabela',
      },
    }),
    [showForm, gestaoFilterOpen, filterActive, selectedVtId, list, openNew]
  );

  useRegisterGestaoModuleActions(() => frotaGestao, [frotaGestao]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim() || form.maxWeight <= 0 || form.maxVolume <= 0 || form.maxValue <= 0) {
      setError('Preencha nome, código e capacidades (peso, volume e valor positivos).');
      return;
    }
    setError(null);
    try {
      if (editingId) {
        await vehicleTypesApi.update(editingId, form);
        setSuccess('Tipo de veículo atualizado.');
      } else {
        await vehicleTypesApi.create(form);
        setSuccess('Tipo de veículo criado.');
      }
      setShowForm(false);
      setEditingId(null);
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!window.confirm('Desativar este tipo de veículo?')) return;
    try {
      setError(null);
      await vehicleTypesApi.update(id, { active: false });
      setSuccess('Tipo desativado.');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">Tipos de veículo</h2>
      </div>
      {gestaoFilterOpen && (
        <div className="mb-4 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
          <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="frota-act">
            Situação
          </label>
          <select
            id="frota-act"
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value as 'all' | 'active' | 'inactive')}
            className="rounded-lg border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
          >
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
        </div>
      )}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-4 bg-brand-50 border border-brand-200 text-brand-800 px-4 py-3 rounded-xl text-sm">{success}</div>
      )}
      {showForm && (
        <div className="mb-6 bg-white border border-tower-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-tower-800 mb-4">
            {editingId ? 'Editar tipo de veículo' : 'Novo tipo de veículo'}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Nome</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                placeholder="Ex: P24"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Código</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                placeholder="Ex: P24"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Peso máx. (kg)</label>
              <input
                type="number"
                min={1}
                value={form.maxWeight || ''}
                onChange={(e) => setForm((f) => ({ ...f, maxWeight: Number(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Volume máx. (m³)</label>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={form.maxVolume || ''}
                onChange={(e) => setForm((f) => ({ ...f, maxVolume: Number(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Valor máx. (R$)</label>
              <input
                type="number"
                min={0}
                value={form.maxValue || ''}
                onChange={(e) => setForm((f) => ({ ...f, maxValue: Number(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div className="md:col-span-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm text-tower-700">
                <input
                  type="checkbox"
                  checked={form.enclosed}
                  onChange={(e) => setForm((f) => ({ ...f, enclosed: e.target.checked }))}
                  className="rounded"
                />
                Fechado
              </label>
              <label className="flex items-center gap-2 text-sm text-tower-700">
                <input
                  type="checkbox"
                  checked={form.refrigerated}
                  onChange={(e) => setForm((f) => ({ ...f, refrigerated: e.target.checked }))}
                  className="rounded"
                />
                Refrigerado
              </label>
              {editingId && (
                <label className="flex items-center gap-2 text-sm text-tower-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                    className="rounded"
                  />
                  Ativo
                </label>
              )}
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">
                {editingId ? 'Salvar' : 'Criar'}
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
        <div className="py-12 text-center text-tower-500">Carregando...</div>
      ) : list.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-tower-200 rounded-xl p-12 text-center text-tower-500">
          Nenhum tipo de veículo cadastrado.
        </div>
      ) : filteredList.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-tower-200 p-12 text-center text-tower-500">Nenhum tipo neste filtro.</div>
      ) : (
        <div id="frota-tabela" className="bg-white border border-tower-200 rounded-xl overflow-hidden dark:border-tower-600 dark:bg-tower-800">
          <table className="w-full">
            <thead className="bg-tower-50 border-b border-tower-200">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Nome / Código</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Peso máx.</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Volume máx.</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Valor máx.</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Ativo</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-tower-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map((vt) => (
                <tr
                  key={vt.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedVtId(vt.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedVtId(vt.id);
                    }
                  }}
                  className={`cursor-pointer border-b border-tower-100 hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-700/40 ${
                    selectedVtId === vt.id ? 'bg-brand-50/90 dark:bg-brand-950/30' : ''
                  }`}
                >
                  <td className="py-3 px-4 font-medium text-tower-900">{vt.name} <span className="text-tower-500 text-sm">({vt.code})</span></td>
                  <td className="py-3 px-4 text-tower-600">{vt.maxWeight} kg</td>
                  <td className="py-3 px-4 text-tower-600">{vt.maxVolume} m³</td>
                  <td className="py-3 px-4 text-tower-600">R$ {vt.maxValue.toLocaleString()}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${vt.active ? 'bg-brand-100 text-brand-700' : 'bg-tower-100 text-tower-500'}`}>
                      {vt.active ? 'Sim' : 'Não'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(vt);
                      }}
                      className="text-brand-600 hover:underline text-sm mr-2"
                    >
                      Editar
                    </button>
                    {vt.active && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeactivate(vt.id);
                        }}
                        className="text-tower-500 hover:underline text-sm"
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
      )}
    </div>
  );
};

export default FrotaTab;
