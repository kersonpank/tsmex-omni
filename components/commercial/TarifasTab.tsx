import React, { useState, useEffect } from 'react';
import { pricingApi, clientsApi } from '../../lib/api';
import type {
  PricingTable,
  PricingRoute,
  MinFreightRange,
  FreightUnit,
  MinFreightUnit,
  TollUnit,
  PricingTableType,
  Client,
} from '../../types/index';

const FREIGHT_UNIT_LABELS: Record<FreightUnit, string> = {
  RS_KG: 'R$/Kg',
  PERCENT: '%',
  RS_M3: 'R$/m³',
  RS_UNIT: 'R$/un',
};

const MIN_FREIGHT_UNIT_LABELS: Record<MinFreightUnit, string> = {
  RS: 'R$',
  KG: 'Kg',
};

const TOLL_UNIT_LABELS: Record<TollUnit, string> = {
  RS_KG: 'R$/Kg',
  FIXED: 'R$',
};

const formatFreightDisplay = (t: PricingTable): string => {
  const v = t.freightValue ?? 0;
  const u = FREIGHT_UNIT_LABELS[t.freightUnit] ?? t.freightUnit;
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${u}`;
};

const defaultRanges = (): { minWeight: number; maxWeight?: number; value: number }[] => [
  { minWeight: 0, value: 0 },
];

const TarifasTab: React.FC = () => {
  const [tables, setTables] = useState<(PricingTable & { route?: PricingRoute; client?: { companyName: string } })[]>([]);
  const [routes, setRoutes] = useState<PricingRoute[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filterRouteId, setFilterRouteId] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    description: '',
    routeId: '' as string | undefined,
    type: 'GENERAL' as PricingTableType,
    clientId: '' as string | undefined,
    freightValue: undefined as number | undefined,
    freightUnit: 'RS_KG' as FreightUnit,
    minFreightValue: undefined as number | undefined,
    minFreightUnit: 'RS' as MinFreightUnit,
    adValoremPercent: undefined as number | undefined,
    grisPercent: undefined as number | undefined,
    tollValue: undefined as number | undefined,
    tollUnit: 'RS_KG' as TollUnit,
    dispatchFee: undefined as number | undefined,
    otherFees: undefined as number | undefined,
    cubeEnabled: false,
    cubeFactor: undefined as number | undefined,
    icmsIncluded: true,
    icmsPercent: undefined as number | undefined,
    adValoremThreshold: undefined as number | undefined,
    minFreightRanges: defaultRanges(),
    active: true,
    priority: 0,
  });

  const loadRoutes = async () => {
    const res = await pricingApi.listRoutes({ includeInactive: false });
    setRoutes(res.data || []);
  };

  const loadClients = async () => {
    try {
      const res = await clientsApi.list();
      setClients(res.data || []);
    } catch {
      setClients([]);
    }
  };

  const loadTables = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: { routeId?: string; type?: string } = {};
      if (filterRouteId) params.routeId = filterRouteId;
      if (filterType) params.type = filterType;
      const res = await pricingApi.listTables(params);
      setTables(res.data || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao carregar tarifas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoutes();
    loadClients();
  }, []);

  useEffect(() => {
    loadTables();
  }, [filterRouteId, filterType]);

  const openNew = () => {
    setEditingId(null);
    setForm({
      description: '',
      routeId: undefined,
      type: 'GENERAL',
      clientId: undefined,
      freightValue: undefined,
      freightUnit: 'RS_KG',
      minFreightValue: undefined,
      minFreightUnit: 'RS',
      adValoremPercent: undefined,
      grisPercent: undefined,
      tollValue: undefined,
      tollUnit: 'RS_KG',
      dispatchFee: undefined,
      otherFees: undefined,
      cubeEnabled: false,
      cubeFactor: undefined,
      icmsIncluded: true,
      icmsPercent: undefined,
      adValoremThreshold: undefined,
      minFreightRanges: defaultRanges(),
      active: true,
      priority: 0,
    });
    setShowForm(true);
  };

  const openEdit = async (id: string) => {
    try {
      const res = await pricingApi.getTableById(id);
      const t = res.data;
      if (!t) return;
      setForm({
        description: t.description,
        routeId: t.routeId ?? undefined,
        type: t.type,
        clientId: t.clientId ?? undefined,
        freightValue: t.freightValue,
        freightUnit: t.freightUnit,
        minFreightValue: t.minFreightValue,
        minFreightUnit: t.minFreightUnit ?? 'RS',
        adValoremPercent: t.adValoremPercent,
        grisPercent: t.grisPercent,
        tollValue: t.tollValue,
        tollUnit: t.tollUnit ?? 'RS_KG',
        dispatchFee: t.dispatchFee,
        otherFees: t.otherFees,
        cubeEnabled: t.cubeEnabled ?? false,
        cubeFactor: t.cubeFactor,
        icmsIncluded: t.icmsIncluded ?? false,
        icmsPercent: t.icmsPercent,
        adValoremThreshold: t.adValoremThreshold,
        minFreightRanges:
          t.minFreightRanges?.length
            ? t.minFreightRanges.map((r: MinFreightRange) => ({
                minWeight: r.minWeight,
                maxWeight: r.maxWeight,
                value: r.value,
              }))
            : defaultRanges(),
        active: t.active ?? true,
        priority: t.priority ?? 0,
      });
      setEditingId(id);
      setShowForm(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao carregar divisão');
    }
  };

  const addRange = () => {
    setForm((f) => ({
      ...f,
      minFreightRanges: [...f.minFreightRanges, { minWeight: 0, value: 0 }],
    }));
  };

  const removeRange = (index: number) => {
    setForm((f) => ({
      ...f,
      minFreightRanges: f.minFreightRanges.filter((_, i) => i !== index),
    }));
  };

  const updateRange = (index: number, field: 'minWeight' | 'maxWeight' | 'value', value: number) => {
    setForm((f) => {
      const next = [...f.minFreightRanges];
      next[index] = { ...next[index], [field]: value };
      return { ...f, minFreightRanges: next };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) {
      setError('Descrição é obrigatória.');
      return;
    }
    const payload = {
      description: form.description.trim(),
      routeId: form.routeId || null,
      type: form.type,
      clientId: form.clientId || null,
      freightValue: form.freightValue ?? null,
      freightUnit: form.freightUnit,
      minFreightValue: form.minFreightValue ?? null,
      minFreightUnit: form.minFreightUnit,
      adValoremPercent: form.adValoremPercent ?? null,
      grisPercent: form.grisPercent ?? null,
      tollValue: form.tollValue ?? null,
      tollUnit: form.tollUnit,
      dispatchFee: form.dispatchFee ?? null,
      otherFees: form.otherFees ?? null,
      cubeEnabled: form.cubeEnabled,
      cubeFactor: form.cubeFactor ?? null,
      icmsIncluded: form.icmsIncluded,
      icmsPercent: form.icmsPercent ?? null,
      adValoremThreshold: form.adValoremThreshold ?? null,
      minFreightRanges: form.minFreightRanges
        .filter((r) => r.value > 0)
        .map((r) => ({
          minWeight: r.minWeight,
          maxWeight: r.maxWeight && r.maxWeight > 0 ? r.maxWeight : undefined,
          value: r.value,
        })),
      active: form.active,
      priority: form.priority,
    };
    try {
      setError(null);
      if (editingId) {
        await pricingApi.updateTable(editingId, payload);
        setSuccess('Divisão atualizada com sucesso.');
      } else {
        await pricingApi.createTable(payload);
        setSuccess('Divisão criada com sucesso.');
      }
      setShowForm(false);
      setEditingId(null);
      loadTables();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao salvar divisão');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!window.confirm('Desativar esta divisão? Ela não será usada no cálculo de frete.')) return;
    try {
      setError(null);
      await pricingApi.updateTable(id, { active: false });
      setSuccess('Divisão desativada.');
      loadTables();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao desativar');
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h2 className="text-lg font-bold text-slate-700">Tabelas de preço (Tarifas)</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterRouteId}
            onChange={(e) => setFilterRouteId(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          >
            <option value="">Todas as rotas</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          >
            <option value="">Todos os tipos</option>
            <option value="GENERAL">Geral</option>
            <option value="SPECIAL">Especial</option>
          </select>
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 text-sm bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700"
          >
            + Nova divisão
          </button>
          <button
            type="button"
            onClick={loadTables}
            className="px-4 py-2 text-sm text-slate-600 font-medium hover:bg-slate-100 rounded-lg"
          >
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-sm">
          {success}
        </div>
      )}

      {showForm && (
        <div className="mb-8 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-4">
            {editingId ? `Editar divisão` : 'Nova divisão'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Descrição</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  placeholder="Ex: FRETE PESO/CUB 300: 1.15KG + 10/1000 ADV + R$35,00 TAXA"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Rota</label>
                <select
                  value={form.routeId ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value || undefined }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                >
                  <option value="">Nenhuma</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as PricingTableType }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                >
                  <option value="GENERAL">Geral</option>
                  <option value="SPECIAL">Especial</option>
                </select>
              </div>
              {form.type === 'SPECIAL' && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cliente</label>
                  <select
                    value={form.clientId ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value || undefined }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  >
                    <option value="">Nenhum</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.companyName} ({c.document})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-3">Valores e unidades</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Frete</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      value={form.freightValue ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, freightValue: e.target.value === '' ? undefined : Number(e.target.value) }))
                      }
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg"
                    />
                    <select
                      value={form.freightUnit}
                      onChange={(e) => setForm((f) => ({ ...f, freightUnit: e.target.value as FreightUnit }))}
                      className="w-24 px-2 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      {(Object.keys(FREIGHT_UNIT_LABELS) as FreightUnit[]).map((u) => (
                        <option key={u} value={u}>
                          {FREIGHT_UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">F. Mínimo</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      value={form.minFreightValue ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          minFreightValue: e.target.value === '' ? undefined : Number(e.target.value),
                        }))
                      }
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg"
                    />
                    <select
                      value={form.minFreightUnit}
                      onChange={(e) => setForm((f) => ({ ...f, minFreightUnit: e.target.value as MinFreightUnit }))}
                      className="w-16 px-2 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      {(Object.keys(MIN_FREIGHT_UNIT_LABELS) as MinFreightUnit[]).map((u) => (
                        <option key={u} value={u}>
                          {MIN_FREIGHT_UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Advalor (p/R$ 1000)</label>
                  <input
                    type="number"
                    step="any"
                    value={form.adValoremPercent ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        adValoremPercent: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">GRIS (p/R$ 1000)</label>
                  <input
                    type="number"
                    step="any"
                    value={form.grisPercent ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        grisPercent: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Pedágio</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      value={form.tollValue ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          tollValue: e.target.value === '' ? undefined : Number(e.target.value),
                        }))
                      }
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg"
                    />
                    <select
                      value={form.tollUnit}
                      onChange={(e) => setForm((f) => ({ ...f, tollUnit: e.target.value as TollUnit }))}
                      className="w-20 px-2 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      {(Object.keys(TOLL_UNIT_LABELS) as TollUnit[]).map((u) => (
                        <option key={u} value={u}>
                          {TOLL_UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Despacho (R$)</label>
                  <input
                    type="number"
                    step="any"
                    value={form.dispatchFee ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        dispatchFee: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Outros (R$)</label>
                  <input
                    type="number"
                    step="any"
                    value={form.otherFees ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        otherFees: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cubagem</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.cubeEnabled}
                      onChange={(e) => setForm((f) => ({ ...f, cubeEnabled: e.target.checked }))}
                    />
                    <span className="text-sm text-slate-600">Kg/m³</span>
                    <input
                      type="number"
                      step="any"
                      value={form.cubeFactor ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          cubeFactor: e.target.value === '' ? undefined : Number(e.target.value),
                        }))
                      }
                      className="w-20 px-2 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="300"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-2">ICMS</h4>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="icms"
                    checked={form.icmsIncluded}
                    onChange={() => setForm((f) => ({ ...f, icmsIncluded: true }))}
                  />
                  <span className="text-sm">ICMS já incluso na negociação acima</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="icms"
                    checked={!form.icmsIncluded}
                    onChange={() => setForm((f) => ({ ...f, icmsIncluded: false }))}
                  />
                  <span className="text-sm">ICMS será acrescentado após cálculo acima</span>
                </label>
              </div>
              {!form.icmsIncluded && (
                <div className="mt-2 w-32">
                  <input
                    type="number"
                    step="any"
                    value={form.icmsPercent ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        icmsPercent: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    placeholder="%"
                  />
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Fretes mínimos (faixas por peso)</h4>
              <div className="space-y-2">
                {form.minFreightRanges.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <input
                      type="number"
                      step="any"
                      value={r.minWeight}
                      onChange={(e) => updateRange(i, 'minWeight', Number(e.target.value))}
                      className="w-24 px-2 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="Kgs"
                    />
                    <input
                      type="number"
                      step="any"
                      value={r.maxWeight ?? ''}
                      onChange={(e) =>
                        updateRange(i, 'maxWeight', e.target.value === '' ? 0 : Number(e.target.value))
                      }
                      className="w-24 px-2 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="Kgs máx"
                    />
                    <span className="text-slate-500">R$</span>
                    <input
                      type="number"
                      step="any"
                      value={r.value}
                      onChange={(e) => updateRange(i, 'value', Number(e.target.value))}
                      className="w-28 px-2 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeRange(i)}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      Remover
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addRange} className="text-sm text-indigo-600 hover:text-indigo-800">
                  + Adicionar faixa
                </button>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Se o valor da mercadoria ultrapassar o limite de R$
              </label>
              <input
                type="number"
                step="any"
                value={form.adValoremThreshold ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    adValoremThreshold: e.target.value === '' ? undefined : Number(e.target.value),
                  }))
                }
                className="w-40 px-3 py-2 border border-slate-200 rounded-lg"
              />
              <span className="text-sm text-slate-500 ml-2">Cobrar Advalorem à parte.</span>
            </div>

            <div className="border-t border-slate-200 pt-4 flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                <span className="text-sm font-medium text-slate-700">Divisão liberada</span>
              </label>
              {!form.active && (
                <p className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                  Tabela bloqueada. Esta divisão não estará disponível para cálculo de frete.
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700"
              >
                {editingId ? 'Gravar divisão' : 'Criar divisão'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setError(null);
                }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => handleDeactivate(editingId)}
                  className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                >
                  Desativar
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      <p className="text-sm text-slate-500 mb-4">
        {tables.length} divisão(tabelas)
      </p>

      {loading ? (
        <div className="py-12 text-center text-slate-500">Carregando tarifas...</div>
      ) : tables.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-400">
          Nenhuma tarifa encontrada. Crie uma divisão para usar no cálculo de frete.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Descrição</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Alteração</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Rota</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Min. único</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Frete</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Cubar</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Status</th>
                  <th className="text-right py-3 px-4 font-semibold text-slate-700">Ações</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr
                    key={t.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${!t.active ? 'bg-slate-50 opacity-75' : ''}`}
                  >
                    <td className="py-3 px-4 text-slate-800 max-w-xs truncate" title={t.description}>
                      {t.description}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{t.route?.name ?? 'Nenhuma'}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {t.minFreightValue != null ? t.minFreightValue.toLocaleString('pt-BR') : '-'}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{formatFreightDisplay(t)}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {t.cubeEnabled ? `${t.cubeFactor ?? '-'} Kg/m³` : '-'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          t.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {t.active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(t.id)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium mr-3"
                      >
                        Editar
                      </button>
                      {t.active && (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(t.id)}
                          className="text-red-600 hover:text-red-800 font-medium"
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

export default TarifasTab;
