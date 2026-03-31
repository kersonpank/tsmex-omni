import React, { useState, useEffect } from 'react';
import {
  ordersApi,
  ordersEntradaApi,
  personsApi,
  hubsApi,
  pricingApi,
} from '../../lib/api';
import { maskPhone } from '../../lib/formatters';
import { useAuthStore } from '../../store/authStore';
import { PersonAutocomplete } from '../ui/PersonAutocomplete';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import OrderNFForm, { type OrderInvoiceItem } from './OrderNFForm';
import { OrderColetaForm } from './OrderColetaForm';
import { OrderFreightCalculationSection } from './OrderFreightCalculationSection';
import type { Person, Hub, PricingRoute } from '../../types/index';

type FreightTerm = 'CIF' | 'FOB' | 'REDESPACHO';
const isFreightTerm = (v: FreightTerm | null): v is FreightTerm => v !== null;

const SECTION_IDS = ['pessoas', 'coleta', 'nf', 'calculo', 'evolucao', 'imagens'] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EntradaTab: React.FC = () => {
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const hubId = (user?.profile as { hub?: { hubId?: string } })?.hub?.hubId ?? (user as any)?.hubId;

  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [orderLoading, setOrderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sectionsExpanded, setSectionsExpanded] = useState<Record<string, boolean>>({
    pessoas: true,
    coleta: false,
    nf: true,
    calculo: false,
    evolucao: false,
    imagens: false,
  });

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [routes, setRoutes] = useState<PricingRoute[]>([]);

  const [showExpedidorRedespachante, setShowExpedidorRedespachante] = useState(false);
  const [peopleForm, setPeopleForm] = useState<{
    freightTerm: FreightTerm | null;
    remetente: Person | null;
    destinatario: Person | null;
    consignatario: Person | null;
    expedidor: Person | null;
    redespachante: Person | null;
    origemPrestacao: string;
    fimPrestacao: string;
    routeId: string;
    hubId: string;
  }>({
    freightTerm: null,
    remetente: null as Person | null,
    destinatario: null as Person | null,
    consignatario: null as Person | null,
    expedidor: null as Person | null,
    redespachante: null as Person | null,
    origemPrestacao: '',
    fimPrestacao: '',
    routeId: '',
    hubId: '',
  });
  const [peopleSaving, setPeopleSaving] = useState(false);
  const [addClientModalPerson, setAddClientModalPerson] = useState<Person | null>(null);
  const [needsCollectionActive, setNeedsCollectionActive] = useState(false);

  const loadOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ordersApi.list({ limit: 50 });
      const data = (res as any)?.data ?? res;
      setOrders(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao carregar pedidos');
    } finally {
      setLoading(false);
    }
  };

  const loadOrder = async (id: string) => {
    setOrderLoading(true);
    try {
      const res = await ordersApi.getById(id);
      const o = (res as any)?.data ?? res;
      setOrder(o);
      if (o) {
        const hasExp = !!(o.expedidorPerson ?? o.redespachantePerson);
        setShowExpedidorRedespachante(hasExp);
        setNeedsCollectionActive(!!o.collectionData);
        setPeopleForm({
          freightTerm: (o.freightTerm ?? 'CIF') as FreightTerm,
          remetente: o.remetentePerson ?? null,
          destinatario: o.destinatarioPerson ?? null,
          consignatario: o.consignatarioPerson ?? null,
          expedidor: o.expedidorPerson ?? null,
          redespachante: o.redespachantePerson ?? null,
          origemPrestacao: o.origemPrestacao ?? '',
          fimPrestacao: o.fimPrestacao ?? '',
          routeId: o.routeId ?? '',
          hubId: o.currentHubId ?? '',
        });
      }
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao carregar pedido');
    } finally {
      setOrderLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    hubsApi.list().then((r: any) => setHubs((r?.data ?? r) || [])).catch(() => setHubs([]));
    pricingApi.listRoutes().then((r: any) => setRoutes((r?.data ?? r) || [])).catch(() => setRoutes([]));
  }, []);

  useEffect(() => {
    if (selectedOrderId) {
      setIsCreatingNew(false);
      loadOrder(selectedOrderId);
    } else if (!isCreatingNew) {
      setOrder(null);
    }
  }, [selectedOrderId]);

  useEffect(() => {
    const r = peopleForm.remetente;
    if (r?.city && r?.state) {
      setPeopleForm((f) => {
        if (f.origemPrestacao.trim()) return f;
        return { ...f, origemPrestacao: `${r.city}, ${r.state}` };
      });
    }
  }, [peopleForm.remetente?.id, peopleForm.remetente?.city, peopleForm.remetente?.state]);

  useEffect(() => {
    const d = peopleForm.destinatario;
    if (d?.city && d?.state) {
      setPeopleForm((f) => {
        if (f.fimPrestacao.trim()) return f;
        return { ...f, fimPrestacao: `${d.city}, ${d.state}` };
      });
    }
  }, [peopleForm.destinatario?.id, peopleForm.destinatario?.city, peopleForm.destinatario?.state]);

  const handleNovoPedido = () => {
    setSelectedOrderId(null);
    setIsCreatingNew(true);
    setOrder(null);
    setShowExpedidorRedespachante(false);
    setNeedsCollectionActive(false);
    setPeopleForm({
      freightTerm: null,
      remetente: null,
      destinatario: null,
      consignatario: null,
      expedidor: null,
      redespachante: null,
      origemPrestacao: '',
      fimPrestacao: '',
      routeId: '',
      hubId: isHub ? hubId ?? '' : '',
    });
    setSectionsExpanded({ ...sectionsExpanded, pessoas: true });
  };

  const getPayerPerson = (): Person | null => {
    if (!peopleForm.freightTerm) return null;
    if (peopleForm.freightTerm === 'CIF') return peopleForm.remetente;
    if (peopleForm.freightTerm === 'FOB') return peopleForm.destinatario;
    return peopleForm.consignatario ?? peopleForm.destinatario;
  };

  const doGravarPessoas = async () => {
    if (!isFreightTerm(peopleForm.freightTerm)) return;
    if (!peopleForm.remetente || !peopleForm.destinatario) return;
    if (!peopleForm.origemPrestacao.trim() || !peopleForm.fimPrestacao.trim()) return;
    if (peopleForm.freightTerm === 'REDESPACHO' && !peopleForm.consignatario) return;

    setPeopleSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (selectedOrderId) {
        const remId = peopleForm.remetente?.id?.trim();
        const destId = peopleForm.destinatario?.id?.trim();
        if (!remId || !destId) return;
        const routeVal = (peopleForm.routeId || '').trim();
        const res = await ordersEntradaApi.updatePeople(selectedOrderId, {
          freightTerm: peopleForm.freightTerm,
          remetentePersonId: remId,
          destinatarioPersonId: destId,
          consignatarioPersonId: peopleForm.consignatario?.id?.trim() || null,
          expedidorPersonId: peopleForm.expedidor?.id?.trim() || null,
          redespachantePersonId: peopleForm.redespachante?.id?.trim() || null,
          origemPrestacao: peopleForm.origemPrestacao,
          fimPrestacao: peopleForm.fimPrestacao,
          routeId: routeVal || null,
        });
        const o = (res as any)?.data ?? res;
        setOrder(o);
        setSuccess('Pessoas atualizadas.');
      } else {
        const effectiveHubId = isHub ? hubId : peopleForm.hubId;
        const remId = peopleForm.remetente?.id?.trim();
        const destId = peopleForm.destinatario?.id?.trim();
        if (!remId || !destId) return;
        const payload: Record<string, unknown> = {
          freightTerm: peopleForm.freightTerm,
          remetentePersonId: remId,
          destinatarioPersonId: destId,
          origemPrestacao: peopleForm.origemPrestacao.trim(),
          fimPrestacao: peopleForm.fimPrestacao.trim(),
        };
        // UUIDs opcionais: nunca enviar string vazia ou inválida (evita "Invalid uuid")
        const consignatarioId = peopleForm.consignatario?.id?.trim();
        if (consignatarioId && UUID_REGEX.test(consignatarioId)) payload.consignatarioPersonId = consignatarioId;
        const expedidorId = peopleForm.expedidor?.id?.trim();
        if (expedidorId && UUID_REGEX.test(expedidorId)) payload.expedidorPersonId = expedidorId;
        const redespachanteId = peopleForm.redespachante?.id?.trim();
        if (redespachanteId && UUID_REGEX.test(redespachanteId)) payload.redespachantePersonId = redespachanteId;
        const routeIdVal = (peopleForm.routeId || '').trim();
        if (routeIdVal && UUID_REGEX.test(routeIdVal)) payload.routeId = routeIdVal;
        const hubIdVal = (effectiveHubId || '').trim();
        if (hubIdVal && UUID_REGEX.test(hubIdVal)) payload.hubId = hubIdVal;
        const res = await ordersEntradaApi.create(payload as {
          freightTerm: FreightTerm;
          remetentePersonId: string;
          destinatarioPersonId: string;
          origemPrestacao: string;
          fimPrestacao: string;
          consignatarioPersonId?: string;
          expedidorPersonId?: string;
          redespachantePersonId?: string;
          routeId?: string;
          hubId?: string;
        });
        const o = (res as any)?.data ?? res;
        setSelectedOrderId(o.id);
        setOrder(o);
        setSuccess('Pedido criado.');
        loadOrders();
      }
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      const msg = e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao gravar';
      setError(msg);
      if (e.response?.status === 400 && typeof msg === 'string' && msg.includes('Cliente')) {
        const payer = getPayerPerson();
        if (payer) setAddClientModalPerson(payer);
      } else {
        setAddClientModalPerson(null);
      }
    } finally {
      setPeopleSaving(false);
    }
  };

  const handleGravarPessoas = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!peopleForm.freightTerm) {
      setError('Selecione quem paga o frete.');
      return;
    }
    if (!peopleForm.remetente || !peopleForm.destinatario) {
      setError('Remetente e Destinatário são obrigatórios.');
      return;
    }
    if (!peopleForm.origemPrestacao.trim() || !peopleForm.fimPrestacao.trim()) {
      setError('Origem e Fim da prestação são obrigatórios.');
      return;
    }
    if (peopleForm.freightTerm === 'REDESPACHO' && !peopleForm.consignatario) {
      setError('Para REDESPACHO (Outro), informe o Consignatário.');
      return;
    }
    await doGravarPessoas();
  };

  const toggleSection = (id: string) => {
    setSectionsExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const invoicesRel: OrderInvoiceItem[] = order?.invoicesRel ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">PEDIDOS</h2>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={loadOrders}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
          >
            Lista
          </button>
          <button
            type="button"
            onClick={handleNovoPedido}
            className="px-4 py-2 text-sm bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700"
          >
            + Novo Pedido
          </button>
          {selectedOrderId && (
            <span className="text-sm font-mono text-slate-600 dark:text-slate-400">#{selectedOrderId.slice(0, 8)}</span>
          )}
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">{error}</div>}
      {success && <div className="p-4 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-700 dark:text-emerald-300 text-sm">{success}</div>}

      {!selectedOrderId && !isCreatingNew ? (
        loading ? (
          <div className="py-12 text-center text-slate-500 dark:text-slate-400">Carregando pedidos...</div>
        ) : orders.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-12 text-center text-slate-500 dark:text-slate-400">
            Nenhum pedido. Clique em &quot;+ Novo Pedido&quot; para criar.
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-700">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">ID</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">Origem → Destino</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">Status</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">Ações</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="py-3 px-4 font-mono text-sm text-slate-900 dark:text-slate-200">{o.id.slice(0, 8)}</td>
                    <td className="py-3 px-4 text-slate-900 dark:text-slate-200">
                      {(o.origemPrestacao || o.demand?.origin) ?? '-'} → {(o.fimPrestacao || o.demand?.destination) ?? '-'}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-600 dark:text-slate-200">
                        {o.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedOrderId(o.id)}
                        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 text-sm font-medium"
                      >
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {orderLoading ? (
            <div className="py-12 text-center text-slate-500 dark:text-slate-400">Carregando...</div>
          ) : (
            <>
              <Section title="PESSOAS" expanded={sectionsExpanded.pessoas} onToggle={() => toggleSection('pessoas')}>
                <form onSubmit={handleGravarPessoas} className="space-y-6">
                  <div className="bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-200 dark:border-amber-800 rounded-xl p-6">
                    <h4 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-4">1. Quem paga o frete?</h4>
                    <div className="flex flex-wrap gap-6 items-center">
                      {(['CIF', 'FOB', 'REDESPACHO'] as const).map((ft) => (
                        <label key={ft} className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-amber-100/50 dark:hover:bg-amber-800/50 min-w-[120px]">
                          <input
                            type="radio"
                            name="freightTerm"
                            checked={peopleForm.freightTerm === ft}
                            onChange={() => setPeopleForm((f) => ({
                              ...f,
                              freightTerm: ft,
                              ...(ft !== 'REDESPACHO' && { consignatario: null }),
                            }))}
                            className="w-5 h-5 text-amber-600"
                          />
                          <span className="text-base font-medium text-slate-800 dark:text-slate-100">{ft === 'REDESPACHO' ? 'Outro' : ft}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">CIF: remetente paga · FOB: destinatário paga · Outro: consignatário paga</p>
                  </div>

                  {!peopleForm.freightTerm ? (
                    <p className="text-slate-500 dark:text-slate-400 text-sm py-4">Selecione quem paga o frete acima para continuar.</p>
                  ) : (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <PersonAutocomplete
                      label="Remetente *"
                      value={peopleForm.remetente}
                      onChange={(p) => setPeopleForm((f) => ({ ...f, remetente: p }))}
                      placeholder="Buscar remetente..."
                      required
                      showAddClientHint={peopleForm.freightTerm === 'CIF'}
                    />
                    <PersonAutocomplete
                      label="Destinatário *"
                      value={peopleForm.destinatario}
                      onChange={(p) => setPeopleForm((f) => ({ ...f, destinatario: p }))}
                      placeholder="Buscar destinatário..."
                      required
                      showAddClientHint={peopleForm.freightTerm === 'FOB'}
                    />
                    {peopleForm.freightTerm === 'REDESPACHO' && (
                      <PersonAutocomplete
                        label="Consignatário *"
                        value={peopleForm.consignatario}
                        onChange={(p) => setPeopleForm((f) => ({ ...f, consignatario: p }))}
                        placeholder="Buscar consignatário..."
                        required
                        showAddClientHint
                      />
                    )}
                  </div>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showExpedidorRedespachante}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setShowExpedidorRedespachante(checked);
                        if (!checked) {
                          setPeopleForm((f) => ({ ...f, expedidor: null, redespachante: null }));
                        }
                      }}
                    />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Operação com Expedidor / Redespachante</span>
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1 ml-6">Marque quando a carga envolver expedidor e/ou redespachante.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {showExpedidorRedespachante && (
                      <>
                    <PersonAutocomplete
                      label="Expedidor"
                      value={peopleForm.expedidor}
                      onChange={(p) => setPeopleForm((f) => ({ ...f, expedidor: p }))}
                      placeholder="Buscar expedidor..."
                      showAddClientHint
                    />
                    <PersonAutocomplete
                      label="Redespachante"
                      value={peopleForm.redespachante}
                      onChange={(p) => setPeopleForm((f) => ({ ...f, redespachante: p }))}
                      placeholder="Buscar redespachante..."
                      showAddClientHint
                    />
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <CityAutocomplete
                      value={peopleForm.origemPrestacao}
                      onChange={(v) => setPeopleForm((f) => ({ ...f, origemPrestacao: v }))}
                      placeholder="Origem da prestação"
                      required
                      className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                    />
                    <CityAutocomplete
                      value={peopleForm.fimPrestacao}
                      onChange={(v) => setPeopleForm((f) => ({ ...f, fimPrestacao: v }))}
                      placeholder="Fim da prestação"
                      required
                      className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="flex flex-wrap gap-4 items-center">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rota</label>
                      <select
                        value={peopleForm.routeId}
                        onChange={(e) => setPeopleForm((f) => ({ ...f, routeId: e.target.value }))}
                        className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[180px] bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                      >
                        <option value="">Selecione</option>
                        {routes.filter((r) => r.active).map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                    {!isHub && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Hub</label>
                        <select
                          value={peopleForm.hubId}
                          onChange={(e) => setPeopleForm((f) => ({ ...f, hubId: e.target.value }))}
                          className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[180px] bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                        >
                          <option value="">Nenhum</option>
                          {hubs.filter((h) => h.active).map((h) => (
                            <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={peopleSaving || !peopleForm.freightTerm}
                    className="px-6 py-3 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    <span>✓</span> Gravar Pessoas
                  </button>
                  </>
                  )}
                </form>
              </Section>

              <Section title="COLETA" expanded={sectionsExpanded.coleta} onToggle={() => toggleSection('coleta')}>
                {!selectedOrderId ? (
                  <p className="text-slate-500 dark:text-slate-400 text-sm">Grave as pessoas primeiro para preencher dados de coleta.</p>
                ) : needsCollectionActive || order?.collectionData ? (
                  <OrderColetaForm
                    orderId={selectedOrderId}
                    order={order}
                    onSave={() => loadOrder(selectedOrderId)}
                  />
                ) : (
                  <div className="space-y-4">
                    <p className="text-slate-600 dark:text-slate-300 text-sm">
                      Na maioria dos casos a carga foi entregue direto no HUB/CD e não há necessidade de coleta. Se este pedido precisar de coleta no remetente, clique no botão abaixo.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setNeedsCollectionActive(true); setSectionsExpanded(s => ({ ...s, coleta: true })); }}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                    >
                      Gerar coleta
                    </button>
                  </div>
                )}
              </Section>

              <Section title="NOTAS FISCAIS" badge={invoicesRel.length} expanded={sectionsExpanded.nf} onToggle={() => toggleSection('nf')}>
                {selectedOrderId ? (
                  <OrderNFForm
                    orderId={selectedOrderId}
                    invoices={invoicesRel}
                    onAdded={() => loadOrder(selectedOrderId)}
                    collectionData={order?.collectionData as Record<string, unknown> | undefined}
                  />
                ) : (
                  <p className="text-slate-500 dark:text-slate-400 text-sm">Grave as pessoas primeiro para adicionar notas fiscais.</p>
                )}
              </Section>

              <Section title="CÁLCULO DO FRETE" badge={order?.freightCalculations?.length ?? 0} expanded={sectionsExpanded.calculo} onToggle={() => toggleSection('calculo')}>
                {selectedOrderId && order ? (
                  <OrderFreightCalculationSection
                    orderId={selectedOrderId}
                    order={{
                      id: order.id,
                      origemPrestacao: order.origemPrestacao,
                      fimPrestacao: order.fimPrestacao,
                      routeId: order.routeId,
                      freightTerm: order.freightTerm,
                      remetentePersonId: order.remetentePersonId,
                      destinatarioPersonId: order.destinatarioPersonId,
                      consignatarioPersonId: order.consignatarioPersonId,
                      invoicesRel: order.invoicesRel,
                      collectionData: order.collectionData,
                      demand: order.demand,
                    }}
                    onSaved={() => loadOrder(selectedOrderId)}
                    isHub={isHub}
                    userHubId={hubId ?? undefined}
                  />
                ) : (
                  <p className="text-slate-500 dark:text-slate-400 text-sm">Grave as pessoas primeiro para calcular o frete.</p>
                )}
              </Section>

              <Section title="EVOLUÇÃO DO FRETE" expanded={sectionsExpanded.evolucao} onToggle={() => toggleSection('evolucao')}>
                {order?.history?.length ? (
                  <ul className="space-y-2">
                    {order.history.map((h: any) => (
                      <li key={h.id} className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 rounded-full bg-indigo-400" />
                        <span className="font-medium text-slate-900 dark:text-slate-100">{h.eventType}</span>
                        <span className="text-slate-500 dark:text-slate-400">- {h.description}</span>
                        <span className="text-slate-400 dark:text-slate-500 text-xs">{new Date(h.createdAt).toLocaleString('pt-BR')}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500 dark:text-slate-400 text-sm">Nenhum evento ainda.</p>
                )}
              </Section>

              <Section title="IMAGENS" expanded={sectionsExpanded.imagens} onToggle={() => toggleSection('imagens')}>
                <p className="text-slate-500 dark:text-slate-400 text-sm">Em breve.</p>
              </Section>

              <div className="flex justify-between items-center pt-4 border-t border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400">
                <div>
                  {order?.createdAt && (
                    <span>Data de Abertura: {new Date(order.createdAt).toLocaleString('pt-BR')}</span>
                  )}
                  {user?.email && <span className="ml-4">Usuário: {user.email}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedOrderId(null); setIsCreatingNew(false); }}
                  className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  Fechar pedido
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {addClientModalPerson && (
        <AddClientModal
          person={addClientModalPerson}
          onClose={() => setAddClientModalPerson(null)}
          onSuccess={() => {
            setAddClientModalPerson(null);
            doGravarPessoas();
          }}
        />
      )}
    </div>
  );
};

function AddClientModal({ person, onClose, onSuccess }: { person: Person; onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingPending, setSavingPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await personsApi.addClient(person.id, { email, password, contactName, phone });
      onSuccess();
    } catch (error: any) {
      setErr(error.response?.data?.error || error.message || 'Erro ao adicionar');
    } finally {
      setSaving(false);
    }
  };

  const handlePreencherViaComercial = async () => {
    setErr(null);
    setSavingPending(true);
    try {
      await personsApi.addClientPending(person.id);
      onSuccess();
    } catch (error: any) {
      setErr(error.response?.data?.error || error.message || 'Erro ao enviar para Comercial');
    } finally {
      setSavingPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} role="dialog">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">Adicionar como Cliente</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
          O pagador ({person.legalName || 'esta pessoa'}) precisa ser Cliente. Preencha os dados abaixo.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Não tem os contatos? Use &quot;Preencher via Comercial&quot; para enviar para a área comercial concluir o cadastro. O pedido poderá seguir e a tarefa ficará na pipeline.
        </p>
        {err && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{err}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Senha</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" required minLength={6} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome do contato</label>
            <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Telefone</label>
            <input type="tel" value={maskPhone(phone)} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500" placeholder="(11) 99999-9999" required maxLength={15} />
          </div>
          <div className="flex flex-wrap gap-2 justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancelar</button>
            <button
              type="button"
              onClick={handlePreencherViaComercial}
              disabled={saving || savingPending}
              className="px-4 py-2 bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-800 disabled:opacity-50 font-medium"
            >
              {savingPending ? 'Enviando...' : 'Preencher via Comercial'}
            </button>
            <button type="submit" disabled={saving || savingPending} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Salvando...' : 'Adicionar e continuar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({
  title,
  badge,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  badge?: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex justify-between items-center px-4 py-3 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-left font-semibold text-slate-800 dark:text-slate-100"
      >
        <span>{title}</span>
        {badge != null && badge > 0 && (
          <span className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 text-xs font-bold flex items-center justify-center">
            {badge}
          </span>
        )}
        <span className="text-slate-400 dark:text-slate-500">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && <div className="p-6 border-t border-slate-100 dark:border-slate-700">{children}</div>}
    </div>
  );
}

export default EntradaTab;
