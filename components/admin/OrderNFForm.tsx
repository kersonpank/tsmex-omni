import React, { useState, useEffect } from 'react';
import { ordersEntradaApi, nfSpeciesApi } from '../../lib/api';
import { maskDateDDMMYYYY, parseDateDDMMYYYY, formatDateToDDMMYYYY } from '../../lib/formatters';
import { parseNFeChave55 } from '../../lib/nfeChaveParser';
import type { NfSpecies } from '../../types/index';

export interface OrderInvoiceItem {
  id: string;
  type: 'NFE' | 'OUTRAS';
  nfNumber: string;
  nfKey?: string | null;
  emissionDate?: string | null;
  nature?: string | null;
  species?: string | null;
  volumes: number;
  weight: number;
  cubedVolume?: number | null;
  value: number;
}

interface VolumeItem {
  qty: number;
  altura: number;
  largura: number;
  comprimento: number;
}

interface OrderNFFormProps {
  orderId: string;
  invoices: OrderInvoiceItem[];
  onAdded: () => void;
  disabled?: boolean;
  collectionData?: Record<string, unknown>;
}

/** Converte collectionData da coleta para pré-preenchimento do form de NF */
function prefillFromCollectionData(cd: unknown): { form: Partial<{ weight: number; value: number; nature: string }>; volumesList: VolumeItem[] } {
  if (!cd || typeof cd !== 'object') return { form: {}, volumesList: [] };
  const c = cd as Record<string, unknown>;
  const form: Partial<{ weight: number; value: number; nature: string }> = {};
  if (c.weight != null) form.weight = Number(c.weight) || 0;
  if (c.nfValue != null) form.value = Number(c.nfValue) || 0;
  if (c.commodity && typeof c.commodity === 'string') form.nature = c.commodity;
  let volumesList: VolumeItem[] = [{ qty: 1, altura: 0, largura: 0, comprimento: 0 }];
  if (c.dimensions) {
    try {
      const dims = typeof c.dimensions === 'string' ? JSON.parse(c.dimensions) : c.dimensions;
      if (Array.isArray(dims) && dims.length > 0) {
        volumesList = dims.map((d: any) => ({
          qty: d.qty || 1,
          altura: d.altura || 0,
          largura: d.largura || 0,
          comprimento: d.comprimento || 0,
        }));
      }
    } catch {
      // ignore
    }
  }
  return { form, volumesList };
}

function calcCubFromVolumes(volumesList: VolumeItem[]): number {
  let total = 0;
  for (const v of volumesList) {
    const q = v.qty || 0;
    const a = v.altura || 0;
    const l = v.largura || 0;
    const c = v.comprimento || 0;
    total += (q * a * l * c) / 1_000_000;
  }
  return Math.round(total * 1000) / 1000;
}

const OrderNFForm: React.FC<OrderNFFormProps> = ({ orderId, invoices, onAdded, disabled, collectionData }) => {
  const [tab, setTab] = useState<'NFE' | 'OUTRAS'>('NFE');
  const [speciesList, setSpeciesList] = useState<NfSpecies[]>([]);
  const [speciesOther, setSpeciesOther] = useState(false);
  const [form, setForm] = useState({
    nfKey: '',
    nfNumber: '',
    emissionDate: '',
    nature: '',
    speciesId: '',
    speciesOtherText: '',
    weight: 0,
    cubedVolumeManual: '',
    value: 0,
  });
  const [volumesList, setVolumesList] = useState<VolumeItem[]>([{ qty: 1, altura: 0, largura: 0, comprimento: 0 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<OrderInvoiceItem | null>(null);
  const [showForm, setShowForm] = useState(() => invoices.length === 0);

  useEffect(() => {
    if (invoices.length === 0) setShowForm(true);
  }, [invoices.length]);

  useEffect(() => {
    if (editingInvoice || !collectionData) return;
    const { form: formUpdates, volumesList: volList } = prefillFromCollectionData(collectionData);
    if (Object.keys(formUpdates).length > 0 || (volList.length > 0 && (volList.length > 1 || volList[0]?.qty !== 1 || volList[0]?.altura || volList[0]?.largura || volList[0]?.comprimento))) {
      setForm(f => ({ ...f, ...formUpdates }));
      setVolumesList(volList);
    }
  }, [collectionData, editingInvoice]);

  useEffect(() => {
    nfSpeciesApi.list({ active: true }).then((r: any) => {
      const data = r?.data ?? r;
      setSpeciesList(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'NFE') return;
    const digits = form.nfKey.replace(/\D/g, '');
    if (digits.length === 44) {
      const parsed = parseNFeChave55(form.nfKey);
      if (parsed) {
        setForm(f => ({
          ...f,
          nfNumber: parsed.nnf,
          emissionDate: formatDateToDDMMYYYY(parsed.emissionDate),
        }));
      }
    }
  }, [form.nfKey, tab]);

  const cubCalculated = calcCubFromVolumes(volumesList);
  const cubToUse = form.cubedVolumeManual !== ''
    ? parseFloat(form.cubedVolumeManual) || 0
    : cubCalculated;

  const totalVolumes = volumesList.reduce((s, v) => s + (v.qty || 0), 0);
  const speciesValue = speciesOther ? form.speciesOtherText.trim() : (speciesList.find(s => s.id === form.speciesId)?.name ?? '');

  const fillFormFromInvoice = (inv: OrderInvoiceItem) => {
    setTab(inv.type);
    const spec = speciesList.find(s => s.name === inv.species);
    setForm({
      nfKey: inv.nfKey || '',
      nfNumber: inv.nfNumber,
      emissionDate: inv.emissionDate ? formatDateToDDMMYYYY(inv.emissionDate) : '',
      nature: inv.nature || '',
      speciesId: spec?.id || '',
      speciesOtherText: spec ? '' : (inv.species || ''),
      weight: inv.weight || 0,
      cubedVolumeManual: inv.cubedVolume != null ? String(inv.cubedVolume) : '',
      value: inv.value || 0,
    });
    setSpeciesOther(!spec && !!inv.species);
    const vol = Math.max(1, Math.round(inv.volumes || 0));
    setVolumesList([{ qty: vol, altura: 0, largura: 0, comprimento: 0 }]);
  };

  const handleEdit = (inv: OrderInvoiceItem) => {
    setEditingInvoice(inv);
    fillFormFromInvoice(inv);
  };

  const cancelEdit = () => {
    setEditingInvoice(null);
    setForm({ nfKey: '', nfNumber: '', emissionDate: '', nature: '', speciesId: '', speciesOtherText: '', weight: 0, cubedVolumeManual: '', value: 0 });
    setVolumesList([{ qty: 1, altura: 0, largura: 0, comprimento: 0 }]);
    setSpeciesOther(false);
    setShowForm(invoices.length > 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const nfNumber = form.nfNumber.trim() || (form.nfKey ? form.nfKey.slice(-8) : '');
    if (!nfNumber) {
      setError('Informe o número da NF ou a chave NF-e.');
      return;
    }
    const emissionDateParsed = form.emissionDate ? parseDateDDMMYYYY(form.emissionDate) : undefined;
    setSaving(true);
    try {
      const payload = {
        type: tab,
        nfNumber,
        nfKey: form.nfKey.trim() || undefined,
        emissionDate: emissionDateParsed ? emissionDateParsed + 'T12:00:00' : undefined,
        nature: form.nature.trim() || undefined,
        species: speciesValue || undefined,
        volumes: totalVolumes || 0,
        weight: form.weight || 0,
        cubedVolume: cubToUse || undefined,
        value: form.value || 0,
      };
      if (editingInvoice) {
        await ordersEntradaApi.updateInvoice(orderId, editingInvoice.id, payload);
        setEditingInvoice(null);
      } else {
        await ordersEntradaApi.addInvoice(orderId, payload);
      }
      setForm({ nfKey: '', nfNumber: '', emissionDate: '', nature: '', speciesId: '', speciesOtherText: '', weight: 0, cubedVolumeManual: '', value: 0 });
      setVolumesList([{ qty: 1, altura: 0, largura: 0, comprimento: 0 }]);
      setSpeciesOther(false);
      setShowForm(false);
      onAdded();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Erro ao gravar nota');
    } finally {
      setSaving(false);
    }
  };

  const totals = {
    weight: invoices.reduce((s, i) => s + (i.weight || 0), 0),
    cub: invoices.reduce((s, i) => s + (i.cubedVolume || 0), 0),
    value: invoices.reduce((s, i) => s + (i.value || 0), 0),
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Adicione quantas notas forem necessárias (mesmo remetente e destinatário).
      </p>
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setTab('NFE')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'NFE' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
        >
          NF-e
        </button>
        <button
          type="button"
          onClick={() => setTab('OUTRAS')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'OUTRAS' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
        >
          Outras (Declaração)
        </button>
      </div>
      {(invoices.length === 0 || showForm || editingInvoice) ? (
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">{error}</div>}
        {tab === 'NFE' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Chave NF-e (44 dígitos)</label>
            <input
              type="text"
              value={form.nfKey}
              onChange={e => setForm(f => ({ ...f, nfKey: e.target.value.replace(/\D/g, '').slice(0, 44) }))}
              placeholder="Digite a chave de acesso da NF-e"
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 font-mono text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Consulta Pública NF-e: em breve</p>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Número *</label>
            <input
              type="text"
              value={form.nfNumber}
              onChange={e => setForm(f => ({ ...f, nfNumber: e.target.value }))}
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Emissão (DD/MM/AAAA)</label>
            <input
              type="text"
              value={form.emissionDate}
              onChange={e => setForm(f => ({ ...f, emissionDate: maskDateDDMMYYYY(e.target.value) }))}
              placeholder="dd/mm/aaaa"
              maxLength={10}
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Natureza</label>
            <input
              type="text"
              value={form.nature}
              onChange={e => setForm(f => ({ ...f, nature: e.target.value }))}
              placeholder="Ex: VETERINARIO"
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Espécie</label>
            <select
              value={speciesOther ? '_outro' : form.speciesId}
              onChange={e => {
                const v = e.target.value;
                if (v === '_outro') {
                  setSpeciesOther(true);
                  setForm(f => ({ ...f, speciesId: '', speciesOtherText: '' }));
                } else {
                  setSpeciesOther(false);
                  setForm(f => ({ ...f, speciesId: v, speciesOtherText: '' }));
                }
              }}
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            >
              <option value="">Selecione</option>
              {speciesList.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              <option value="_outro">Outro</option>
            </select>
            {speciesOther && (
              <input
                type="text"
                value={form.speciesOtherText}
                onChange={e => setForm(f => ({ ...f, speciesOtherText: e.target.value }))}
                placeholder="Informe a espécie"
                className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 mt-1 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
              />
            )}
          </div>
        </div>
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Volumes para cubagem</h4>
          {volumesList.map((vol, idx) => (
            <div key={idx} className="flex flex-wrap gap-2 items-center mb-2">
              <input
                type="number"
                min={1}
                placeholder="Qtd"
                value={vol.qty || ''}
                onChange={e => {
                  const nl = [...volumesList];
                  nl[idx] = { ...vol, qty: parseInt(e.target.value, 10) || 0 };
                  setVolumesList(nl);
                }}
                className="w-16 p-2 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
              />
              <input
                type="number"
                min={0}
                placeholder="Alt (cm)"
                value={vol.altura || ''}
                onChange={e => {
                  const nl = [...volumesList];
                  nl[idx] = { ...vol, altura: parseFloat(e.target.value) || 0 };
                  setVolumesList(nl);
                }}
                className="w-20 p-2 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
              />
              <input
                type="number"
                min={0}
                placeholder="Larg (cm)"
                value={vol.largura || ''}
                onChange={e => {
                  const nl = [...volumesList];
                  nl[idx] = { ...vol, largura: parseFloat(e.target.value) || 0 };
                  setVolumesList(nl);
                }}
                className="w-20 p-2 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
              />
              <input
                type="number"
                min={0}
                placeholder="Comp (cm)"
                value={vol.comprimento || ''}
                onChange={e => {
                  const nl = [...volumesList];
                  nl[idx] = { ...vol, comprimento: parseFloat(e.target.value) || 0 };
                  setVolumesList(nl);
                }}
                className="w-20 p-2 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
              />
              {volumesList.length > 1 && (
                <button
                  type="button"
                  onClick={() => setVolumesList(volumesList.filter((_, i) => i !== idx))}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline"
                >
                  Remover
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setVolumesList([...volumesList, { qty: 1, altura: 0, largura: 0, comprimento: 0 }])}
            className="text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline mt-1"
          >
            + Adicionar volume
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Volumes</label>
            <input
              type="number"
              min={0}
              value={totalVolumes || ''}
              onChange={e => {
                const v = parseInt(e.target.value, 10) || 0;
                const nl = [...volumesList];
                if (nl.length) nl[0] = { ...nl[0], qty: v };
                else nl.push({ qty: v, altura: 0, largura: 0, comprimento: 0 });
                setVolumesList(nl);
              }}
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Peso (kg)</label>
            <input
              type="number"
              step="0.0001"
              value={form.weight || ''}
              onChange={e => setForm(f => ({ ...f, weight: parseFloat(e.target.value) || 0 }))}
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cub (m³)</label>
            <input
              type="number"
              step="0.001"
              value={form.cubedVolumeManual !== '' ? form.cubedVolumeManual : (cubCalculated || '')}
              onChange={e => setForm(f => ({ ...f, cubedVolumeManual: e.target.value }))}
              placeholder="Auto ou manual"
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
            />
            {cubCalculated > 0 && form.cubedVolumeManual === '' && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Calculado: {cubCalculated.toFixed(3)} m³</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor (R$)</label>
            <input
              type="number"
              step="0.01"
              value={form.value || ''}
              onChange={e => setForm(f => ({ ...f, value: parseFloat(e.target.value) || 0 }))}
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button
            type="submit"
            disabled={saving || disabled}
            className="px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
          >
            <span>✓</span> {editingInvoice ? 'Atualizar Nota' : 'Gravar Nota'}
          </button>
          {editingInvoice && (
            <button
              type="button"
              onClick={cancelEdit}
              className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>
      ) : (
        <div className="py-4">
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="px-4 py-3 border-2 border-dashed border-indigo-300 dark:border-indigo-600 rounded-xl text-indigo-600 dark:text-indigo-400 font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
          >
            {tab === 'NFE' ? '+ Adicionar mais NF' : '+ Adicionar outra declaração'}
          </button>
        </div>
      )}
      {invoices.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">{invoices.length} Nota(s)</h4>
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-700">
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-200">Número</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-200">Emissão</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-200">Natureza</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-200">Espécie</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-700 dark:text-slate-200">Vol.</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-700 dark:text-slate-200">Peso</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-700 dark:text-slate-200">Cub</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-700 dark:text-slate-200">Valor</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-700 dark:text-slate-200">Ações</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className={`border-t border-slate-100 dark:border-slate-700 ${editingInvoice?.id === inv.id ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-white dark:bg-slate-800'}`}
                  >
                    <td className="py-2 px-3 font-mono text-slate-900 dark:text-slate-200">{inv.nfNumber}</td>
                    <td className="py-2 px-3 text-slate-900 dark:text-slate-200">{formatDateToDDMMYYYY(inv.emissionDate) || '-'}</td>
                    <td className="py-2 px-3 text-slate-900 dark:text-slate-200">{inv.nature || '-'}</td>
                    <td className="py-2 px-3 text-slate-900 dark:text-slate-200">{inv.species || '-'}</td>
                    <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-200">{inv.volumes}</td>
                    <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-200">{inv.weight} kg</td>
                    <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-200">{inv.cubedVolume != null ? `${inv.cubedVolume} m³` : '-'}</td>
                    <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-200">R$ {inv.value.toLocaleString('pt-BR')}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEdit(inv)}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm font-medium"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 dark:bg-slate-700 border-t-2 border-slate-200 dark:border-slate-600">
                <tr className="font-semibold">
                  <td colSpan={8} className="py-2 px-3 text-right text-slate-600 dark:text-slate-200">Total:</td>
                  <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-200">{totals.weight} kg</td>
                  <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-200">{totals.cub > 0 ? `${totals.cub} m³` : '-'}</td>
                  <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-200">R$ {totals.value.toLocaleString('pt-BR')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderNFForm;
