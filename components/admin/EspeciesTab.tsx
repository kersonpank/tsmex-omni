import React, { useState, useEffect } from 'react';
import { nfSpeciesApi } from '../../lib/api';
import type { NfSpecies } from '../../types/index';

const EspeciesTab: React.FC = () => {
  const [list, setList] = useState<NfSpecies[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', active: true });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await nfSpeciesApi.list();
      const data = (res as any)?.data ?? res;
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar espécies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditingId(null);
    setForm({ name: '', active: true });
    setShowForm(true);
  };

  const openEdit = (item: NfSpecies) => {
    setEditingId(item.id);
    setForm({ name: item.name, active: item.active });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Nome é obrigatório.');
      return;
    }
    setError(null);
    try {
      if (editingId) {
        await nfSpeciesApi.update(editingId, form);
        setSuccess('Espécie atualizada.');
      } else {
        await nfSpeciesApi.create(form);
        setSuccess('Espécie criada.');
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
    if (!window.confirm('Desativar esta espécie?')) return;
    try {
      setError(null);
      await nfSpeciesApi.delete(id);
      setSuccess('Espécie desativada.');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-tower-700">Espécies de NF</h2>
        <button
          type="button"
          onClick={openNew}
          className="px-4 py-2 text-sm bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700"
        >
          + Nova espécie
        </button>
      </div>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-4 bg-brand-50 border border-brand-200 text-brand-800 px-4 py-3 rounded-xl text-sm">{success}</div>
      )}
      {showForm && (
        <div className="mb-6 bg-white border border-tower-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-tower-800 mb-4">
            {editingId ? 'Editar espécie' : 'Nova espécie'}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Nome</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                placeholder="Ex: Palete, Caixa, Engradado"
              />
            </div>
            {editingId && (
              <div className="flex items-center">
                <label className="flex items-center gap-2 text-sm text-tower-700 mt-6">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                    className="rounded"
                  />
                  Ativo
                </label>
              </div>
            )}
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
          Nenhuma espécie cadastrada. Cadastre espécies como Palete, Caixa, Engradado etc.
        </div>
      ) : (
        <div className="bg-white border border-tower-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-tower-50 border-b border-tower-200">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Nome</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Ativo</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-tower-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.id} className="border-b border-tower-100 hover:bg-tower-50">
                  <td className="py-3 px-4 font-medium text-tower-900">{item.name}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.active ? 'bg-brand-100 text-brand-700' : 'bg-tower-100 text-tower-500'}`}>
                      {item.active ? 'Sim' : 'Não'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button type="button" onClick={() => openEdit(item)} className="text-brand-600 hover:underline text-sm mr-2">Editar</button>
                    {item.active && (
                      <button type="button" onClick={() => handleDeactivate(item.id)} className="text-tower-500 hover:underline text-sm">Desativar</button>
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

export default EspeciesTab;
