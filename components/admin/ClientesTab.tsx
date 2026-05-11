import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { clientsApi } from '../../lib/api';
import type { Client } from '../../types/index';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';

const ClientesTab: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editContact, setEditContact] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await clientsApi.list();
      const data = (res as any)?.data ?? res;
      setClients(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar clientes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => clients.find((c) => c.id === selectedId) ?? null, [clients, selectedId]);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.companyName.toLowerCase().includes(q) ||
        c.document.replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
        (c.contactName ?? '').toLowerCase().includes(q) ||
        (c.user?.email ?? '').toLowerCase().includes(q)
    );
  }, [clients, searchQ]);

  const openEdit = useCallback(() => {
    if (!selected) return;
    setEditContact(selected.contactName ?? '');
    setEditPhone(selected.phone ?? '');
    setEditEmail(selected.user?.email ?? '');
    setEditOpen(true);
  }, [selected]);

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await clientsApi.update(selected.id, {
        contactName: editContact.trim() || undefined,
        phone: editPhone.trim() || undefined,
        email: editEmail.trim() || undefined,
      });
      setEditOpen(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const gestaoConfig = useMemo(
    () => ({
      listActive: !filterOpen && !editOpen,
      filterOpen,
      filterCount: searchQ.trim() ? 1 : 0,
      pills: searchQ.trim()
        ? [
            {
              id: 'q',
              label: `Busca: ${searchQ.trim()}`,
              onRemove: () => setSearchQ(''),
            },
          ]
        : [],
      onList: () => {
        setFilterOpen(false);
        setEditOpen(false);
        void load();
      },
      onFilterToggle: () => setFilterOpen((v) => !v),
      onEdit: selected ? openEdit : undefined,
      disabled: {
        edit: !selected,
        new: true,
      } as const,
      labels: {
        new: 'Novo cliente: use o fluxo de cadastro de conta (API de criação não disponível nesta tela).',
        edit: selected ? 'Editar cliente selecionado' : 'Selecione um cliente na tabela para editar',
      },
    }),
    [filterOpen, editOpen, searchQ, selected, openEdit, load]
  );

  useRegisterGestaoModuleActions(() => gestaoConfig, [gestaoConfig]);

  return (
    <div>
      {filterOpen && (
        <div className="mb-4 rounded-2xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
          <label className="mb-1 block text-xs font-bold uppercase text-tower-600 dark:text-tower-400" htmlFor="cli-filter-q">
            Buscar
          </label>
          <input
            id="cli-filter-q"
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Razão social, documento, contato, e-mail…"
            className="admin-focus w-full max-w-md rounded-xl border border-tower-200 bg-tower-50 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
          />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-tower-500 dark:text-tower-400">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-tower-200 p-12 text-center text-tower-500 dark:border-tower-600 dark:text-tower-400">
          Nenhum cliente nesta visão.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-tower-200 bg-white dark:border-tower-600 dark:bg-tower-800">
          <table className="w-full">
            <thead className="border-b border-tower-200 bg-tower-50 dark:border-tower-600 dark:bg-tower-700">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Razão social</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Documento</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Contato</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">E-mail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(c.id);
                    }
                  }}
                  className={`cursor-pointer border-b border-tower-100 transition-colors hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-700/50 ${
                    selectedId === c.id ? 'bg-brand-50/80 dark:bg-brand-950/40' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-tower-900 dark:text-tower-100">{c.companyName}</td>
                  <td className="px-4 py-3 text-tower-600 dark:text-tower-300">{c.document}</td>
                  <td className="px-4 py-3 text-tower-600 dark:text-tower-300">
                    {c.contactName} {c.phone ? `· ${c.phone}` : ''}
                  </td>
                  <td className="px-4 py-3 text-tower-600 dark:text-tower-300">{c.user?.email ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editOpen && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-tower-950/70 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setEditOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-tower-200 bg-white p-6 shadow-xl dark:border-tower-600 dark:bg-tower-900"
            role="dialog"
            aria-modal
            aria-labelledby="edit-client-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="edit-client-title" className="mb-4 text-lg font-bold text-tower-900 dark:text-tower-50">
              Editar {selected.companyName}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="ec-name">
                  Contato
                </label>
                <input
                  id="ec-name"
                  className="admin-focus w-full rounded-xl border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                  value={editContact}
                  onChange={(e) => setEditContact(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="ec-phone">
                  Telefone
                </label>
                <input
                  id="ec-phone"
                  className="admin-focus w-full rounded-xl border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="ec-email">
                  E-mail (usuário)
                </label>
                <input
                  id="ec-email"
                  type="email"
                  className="admin-focus w-full rounded-xl border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                className="admin-focus flex-1 rounded-xl border border-tower-200 py-2 text-sm font-semibold dark:border-tower-600"
                onClick={() => setEditOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                className="admin-focus flex-1 rounded-xl bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-500 disabled:opacity-50"
                onClick={() => void saveEdit()}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientesTab;
