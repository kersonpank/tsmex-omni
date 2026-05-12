import React, { useState, useEffect, lazy, Suspense } from 'react';
import { ordersEntradaApi, nfSpeciesApi, formatApiError } from '../../lib/api';
import { maskDateDDMMYYYY, parseDateDDMMYYYY, formatDateToDDMMYYYY } from '../../lib/formatters';
import { parseNFeChave55 } from '../../lib/nfeChaveParser';
import type { NfSpecies } from '../../types/index';
import { useNfeLookup } from '../../hooks/useNfeLookup';
import {
  allVolumeRowsComplete,
  cmNumberToFormString,
  dimRowsFromCmStrings,
  normalizeDecimalInput,
  totalCubedM3FromRows,
} from '../../lib/volumeDimensions';

const QRCodeScanner = lazy(() => import('../ui/QRCodeScanner'));

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
  /** Medidas em cm como texto (permite digitar `1,25` ou `1.` sem colapsar). */
  alturaCm: string;
  larguraCm: string;
  comprimentoCm: string;
}

function defaultVolumeRow(): VolumeItem {
  return { qty: 1, alturaCm: '', larguraCm: '', comprimentoCm: '' };
}

interface OrderNFFormProps {
  orderId: string;
  invoices: OrderInvoiceItem[];
  onAdded: () => void;
  disabled?: boolean;
  collectionData?: Record<string, unknown>;
  prescanNfe?: { chave: string; numero: string; emissionDate: string } | null;
}

/** Converte collectionData da coleta para pré-preenchimento do form de NF */
function prefillFromCollectionData(cd: unknown): { form: Partial<{ weight: number; value: number; nature: string }>; volumesList: VolumeItem[] } {
  if (!cd || typeof cd !== 'object') return { form: {}, volumesList: [] };
  const c = cd as Record<string, unknown>;
  const form: Partial<{ weight: number; value: number; nature: string }> = {};
  if (c.weight != null) form.weight = Number(c.weight) || 0;
  if (c.nfValue != null) form.value = Number(c.nfValue) || 0;
  if (c.commodity && typeof c.commodity === 'string') form.nature = c.commodity;
  let volumesList: VolumeItem[] = [defaultVolumeRow()];
  if (c.dimensions) {
    try {
      const dims = typeof c.dimensions === 'string' ? JSON.parse(c.dimensions) : c.dimensions;
      if (Array.isArray(dims) && dims.length > 0) {
        volumesList = dims.map((d: { qty?: number; altura?: number; largura?: number; comprimento?: number }) => ({
          qty: d.qty || 1,
          alturaCm: cmNumberToFormString(Number(d.altura) || 0),
          larguraCm: cmNumberToFormString(Number(d.largura) || 0),
          comprimentoCm: cmNumberToFormString(Number(d.comprimento) || 0),
        }));
      }
    } catch {
      // ignore
    }
  }
  return { form, volumesList };
}

const OrderNFForm: React.FC<OrderNFFormProps> = ({ orderId, invoices, onAdded, disabled, collectionData, prescanNfe }) => {
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
  const [volumesList, setVolumesList] = useState<VolumeItem[]>([defaultVolumeRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const { lookup: lookupNfe, loading: nfeLookupLoading, error: nfeLookupError, clearError: clearNfeError } = useNfeLookup();
  const [editingInvoice, setEditingInvoice] = useState<OrderInvoiceItem | null>(null);
  const [showForm, setShowForm] = useState(() => invoices.length === 0);

  useEffect(() => {
    if (invoices.length === 0) setShowForm(true);
  }, [invoices.length]);

  useEffect(() => {
    if (editingInvoice || !collectionData) return;
    const { form: formUpdates, volumesList: volList } = prefillFromCollectionData(collectionData);
    if (
      Object.keys(formUpdates).length > 0
      || (volList.length > 0
        && (volList.length > 1
          || volList[0]?.qty !== 1
          || (volList[0]?.alturaCm ?? '').trim()
          || (volList[0]?.larguraCm ?? '').trim()
          || (volList[0]?.comprimentoCm ?? '').trim()))
    ) {
      setForm(f => ({ ...f, ...formUpdates }));
      setVolumesList(volList);
    }
  }, [collectionData, editingInvoice]);

  useEffect(() => {
    if (!prescanNfe || invoices.length > 0) return;
    setForm(f => ({
      ...f,
      nfKey: prescanNfe.chave,
      nfNumber: prescanNfe.numero,
      emissionDate: prescanNfe.emissionDate
        ? prescanNfe.emissionDate.split('-').reverse().join('/')
        : f.emissionDate,
    }));
  }, [prescanNfe]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const cubCalculated = totalCubedM3FromRows(dimRowsFromCmStrings(volumesList));
  const cubToUse = form.cubedVolumeManual.trim() !== ''
    ? Number.parseFloat(normalizeDecimalInput(form.cubedVolumeManual)) || 0
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
    setVolumesList([{ qty: vol, alturaCm: '', larguraCm: '', comprimentoCm: '' }]);
  };

  const handleEdit = (inv: OrderInvoiceItem) => {
    setEditingInvoice(inv);
    fillFormFromInvoice(inv);
  };

  const cancelEdit = () => {
    setEditingInvoice(null);
    setForm({ nfKey: '', nfNumber: '', emissionDate: '', nature: '', speciesId: '', speciesOtherText: '', weight: 0, cubedVolumeManual: '', value: 0 });
    setVolumesList([defaultVolumeRow()]);
    setSpeciesOther(false);
    setShowForm(invoices.length > 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let nfNumber: string;
    if (tab === 'OUTRAS') {
      nfNumber = form.nfNumber.trim() || `DC-${Date.now()}`;
      if (!form.nature.trim()) {
        setError('Informe a descrição dos itens.');
        return;
      }
    } else {
      nfNumber = form.nfNumber.trim() || (form.nfKey ? form.nfKey.slice(-8) : '');
      if (!nfNumber) {
        setError('Informe o número da NF ou a chave NF-e.');
        return;
      }
      const manualCub = form.cubedVolumeManual.trim() !== '';
      if (!manualCub && !allVolumeRowsComplete(dimRowsFromCmStrings(volumesList))) {
        setError('Informe medidas completas em cm (altura, largura e comprimento > 0) em cada volume ou preencha Cub (m³) manualmente.');
        return;
      }
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
      setVolumesList([defaultVolumeRow()]);
      setSpeciesOther(false);
      setShowForm(false);
      onAdded();
    } catch (err: unknown) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleQRScan = async (result: string) => {
    setShowQRScanner(false);
    const data = await lookupNfe(result);
    if (!data) return;
    setForm(prev => ({
      ...prev,
      nfKey: data.chave,
      nfNumber: data.numero,
      emissionDate: data.emissionDate
        ? data.emissionDate.split('-').reverse().join('/')
        : prev.emissionDate,
    }));
  };

  const handleNfKeyBlur = async () => {
    if (form.nfKey && form.nfKey.replace(/\D/g, '').length === 44) {
      const data = await lookupNfe(form.nfKey);
      if (data) {
        setForm(prev => ({
          ...prev,
          nfKey: data.chave,
          nfNumber: prev.nfNumber || data.numero,
          emissionDate: prev.emissionDate || (data.emissionDate
            ? data.emissionDate.split('-').reverse().join('/')
            : ''),
        }));
      }
    }
  };

  const totals = {
    weight: invoices.reduce((s, i) => s + (i.weight || 0), 0),
    cub: invoices.reduce((s, i) => s + (i.cubedVolume || 0), 0),
    value: invoices.reduce((s, i) => s + (i.value || 0), 0),
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-tower-600 dark:text-tower-300">
        Adicione quantas notas forem necessárias (mesmo remetente e destinatário).
      </p>
      <div className="flex gap-2 border-b border-tower-200 dark:border-tower-700">
        <button
          type="button"
          onClick={() => setTab('NFE')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'NFE' ? 'border-brand-600 text-brand-600 dark:text-brand-400' : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-200'}`}
        >
          NF-e
        </button>
        <button
          type="button"
          onClick={() => setTab('OUTRAS')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'OUTRAS' ? 'border-brand-600 text-brand-600 dark:text-brand-400' : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-200'}`}
        >
          Outras (Declaração)
        </button>
      </div>
      {(invoices.length === 0 || showForm || editingInvoice) ? (
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">{error}</div>}
        {tab === 'NFE' && (
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">
              Chave NF-e (44 dígitos)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={44}
                value={form.nfKey}
                onChange={e => setForm(prev => ({ ...prev, nfKey: e.target.value.replace(/\D/g, '') }))}
                onBlur={handleNfKeyBlur}
                placeholder="Digite ou escaneie a chave de 44 dígitos"
                className="flex-1 px-3 py-2.5 rounded-lg border border-tower-300 dark:border-tower-600 bg-white dark:bg-tower-700 text-tower-900 dark:text-white text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                disabled={disabled || nfeLookupLoading}
              />
              <button
                type="button"
                onClick={() => setShowQRScanner(true)}
                disabled={disabled || nfeLookupLoading}
                title="Escanear QR Code da DANFE"
                className="px-3 py-2.5 rounded-lg border border-tower-300 dark:border-tower-600 bg-white dark:bg-tower-700 hover:bg-tower-50 dark:hover:bg-tower-600 text-tower-600 dark:text-tower-300 transition-colors disabled:opacity-50"
              >
                {nfeLookupLoading ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
                  </svg>
                )}
              </button>
            </div>
            {nfeLookupError && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <span>⚠ {nfeLookupError} — preencha manualmente.</span>
                <button type="button" onClick={clearNfeError} className="underline">OK</button>
              </p>
            )}
            {prescanNfe && form.nfKey === prescanNfe.chave && (
              <p className="mt-1 text-xs text-brand-600 dark:text-brand-400">✓ Chave pré-escaneada</p>
            )}
          </div>
        )}
        {tab === 'OUTRAS' && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Use esta opção para transporte de itens pessoais ou mercadorias sem Nota Fiscal. Uma Declaração de Conteúdo será emitida.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Descrição dos itens *</label>
              <textarea
                rows={3}
                value={form.nature}
                onChange={e => setForm(prev => ({ ...prev, nature: e.target.value }))}
                placeholder="Ex: Roupas, utensílios domésticos, eletrônicos pessoais..."
                className="w-full px-3 py-2.5 rounded-lg border border-tower-300 dark:border-tower-600 bg-white dark:bg-tower-700 text-tower-900 dark:text-white text-sm focus:ring-2 focus:ring-brand-500"
                disabled={disabled}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Peso estimado (kg) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.weight || ''}
                  onChange={e => setForm(prev => ({ ...prev, weight: parseFloat(e.target.value) || 0 }))}
                  placeholder="0.0"
                  className="w-full px-3 py-2.5 rounded-lg border border-tower-300 dark:border-tower-600 bg-white dark:bg-tower-700 text-tower-900 dark:text-white text-sm"
                  disabled={disabled}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Valor declarado (R$) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.value || ''}
                  onChange={e => setForm(prev => ({ ...prev, value: parseFloat(e.target.value) || 0 }))}
                  placeholder="0.00"
                  className="w-full px-3 py-2.5 rounded-lg border border-tower-300 dark:border-tower-600 bg-white dark:bg-tower-700 text-tower-900 dark:text-white text-sm"
                  disabled={disabled}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Número de volumes *</label>
              <input
                type="number"
                min="1"
                value={totalVolumes || 1}
                onChange={e => {
                  const v = parseInt(e.target.value, 10) || 1;
                  const nl = [...volumesList];
                  if (nl.length) nl[0] = { ...nl[0], qty: v };
                  else nl.push({ qty: v, alturaCm: '', larguraCm: '', comprimentoCm: '' });
                  setVolumesList(nl);
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-tower-300 dark:border-tower-600 bg-white dark:bg-tower-700 text-tower-900 dark:text-white text-sm"
                disabled={disabled}
              />
            </div>
          </div>
        )}
        {tab === 'NFE' && <><div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Número *</label>
            <input
              type="text"
              value={form.nfNumber}
              onChange={e => setForm(f => ({ ...f, nfNumber: e.target.value }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Emissão (DD/MM/AAAA)</label>
            <input
              type="text"
              value={form.emissionDate}
              onChange={e => setForm(f => ({ ...f, emissionDate: maskDateDDMMYYYY(e.target.value) }))}
              placeholder="dd/mm/aaaa"
              maxLength={10}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Natureza</label>
            <input
              type="text"
              value={form.nature}
              onChange={e => setForm(f => ({ ...f, nature: e.target.value }))}
              placeholder="Ex: VETERINARIO"
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Espécie</label>
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
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
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
                className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 mt-1 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
              />
            )}
          </div>
        </div>
        <div className="border border-tower-200 dark:border-tower-700 rounded-lg p-4 bg-tower-50 dark:bg-tower-800">
          <h4 className="text-sm font-semibold text-tower-700 dark:text-tower-200 mb-3">Volumes para cubagem</h4>
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
                className="w-16 p-2 border border-tower-200 dark:border-tower-600 rounded-lg text-sm bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="Alt (cm)"
                value={vol.alturaCm}
                onChange={e => {
                  const nl = [...volumesList];
                  nl[idx] = { ...vol, alturaCm: e.target.value };
                  setVolumesList(nl);
                }}
                className="w-24 p-2 border border-tower-200 dark:border-tower-600 rounded-lg text-sm bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="Larg (cm)"
                value={vol.larguraCm}
                onChange={e => {
                  const nl = [...volumesList];
                  nl[idx] = { ...vol, larguraCm: e.target.value };
                  setVolumesList(nl);
                }}
                className="w-24 p-2 border border-tower-200 dark:border-tower-600 rounded-lg text-sm bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="Comp (cm)"
                value={vol.comprimentoCm}
                onChange={e => {
                  const nl = [...volumesList];
                  nl[idx] = { ...vol, comprimentoCm: e.target.value };
                  setVolumesList(nl);
                }}
                className="w-24 p-2 border border-tower-200 dark:border-tower-600 rounded-lg text-sm bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
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
            onClick={() => setVolumesList([...volumesList, defaultVolumeRow()])}
            className="text-sm text-brand-600 dark:text-brand-400 font-medium hover:underline mt-1"
          >
            + Adicionar volume
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Volumes</label>
            <input
              type="number"
              min={0}
              value={totalVolumes || ''}
              onChange={e => {
                const v = parseInt(e.target.value, 10) || 0;
                const nl = [...volumesList];
                if (nl.length) nl[0] = { ...nl[0], qty: v };
                else nl.push({ qty: v, alturaCm: '', larguraCm: '', comprimentoCm: '' });
                setVolumesList(nl);
              }}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Peso (kg)</label>
            <input
              type="number"
              step="0.0001"
              value={form.weight || ''}
              onChange={e => setForm(f => ({ ...f, weight: parseFloat(e.target.value) || 0 }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Cub (m³)</label>
            <input
              type="text"
              inputMode="decimal"
              value={form.cubedVolumeManual !== '' ? form.cubedVolumeManual : (cubCalculated > 0 ? String(Number(cubCalculated.toFixed(9))) : '')}
              onChange={e => setForm(f => ({ ...f, cubedVolumeManual: e.target.value }))}
              placeholder="Auto a partir do cm ou manual"
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
            />
            {cubCalculated > 0 && form.cubedVolumeManual === '' && (
              <p className="text-xs text-tower-500 dark:text-tower-400 mt-0.5">
                Calculado a partir das medidas em cm: {new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 9 }).format(cubCalculated)} m³
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Valor (R$)</label>
            <input
              type="number"
              step="0.01"
              value={form.value || ''}
              onChange={e => setForm(f => ({ ...f, value: parseFloat(e.target.value) || 0 }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
            />
          </div>
        </div>
        </>}
        <div className="flex gap-2 items-center">
          <button
            type="submit"
            disabled={saving || disabled}
            className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"
          >
            <span>✓</span> {editingInvoice ? 'Atualizar Nota' : 'Gravar Nota'}
          </button>
          {editingInvoice && (
            <button
              type="button"
              onClick={cancelEdit}
              className="px-4 py-2 text-tower-600 dark:text-tower-400 hover:bg-tower-100 dark:hover:bg-tower-700 rounded-lg"
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
            className="px-4 py-3 border-2 border-dashed border-brand-300 dark:border-brand-600 rounded-xl text-brand-600 dark:text-brand-400 font-medium hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
          >
            {tab === 'NFE' ? '+ Adicionar mais NF' : '+ Adicionar outra declaração'}
          </button>
        </div>
      )}
      {invoices.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-tower-700 dark:text-tower-200 mb-2">{invoices.length} Nota(s)</h4>
          <div className="border border-tower-200 dark:border-tower-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-tower-50 dark:bg-tower-700">
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-tower-700 dark:text-tower-200">Número</th>
                  <th className="text-left py-2 px-3 font-medium text-tower-700 dark:text-tower-200">Emissão</th>
                  <th className="text-left py-2 px-3 font-medium text-tower-700 dark:text-tower-200">Natureza</th>
                  <th className="text-left py-2 px-3 font-medium text-tower-700 dark:text-tower-200">Espécie</th>
                  <th className="text-right py-2 px-3 font-medium text-tower-700 dark:text-tower-200">Vol.</th>
                  <th className="text-right py-2 px-3 font-medium text-tower-700 dark:text-tower-200">Peso</th>
                  <th className="text-right py-2 px-3 font-medium text-tower-700 dark:text-tower-200">Cub</th>
                  <th className="text-right py-2 px-3 font-medium text-tower-700 dark:text-tower-200">Valor</th>
                  <th className="text-right py-2 px-3 font-medium text-tower-700 dark:text-tower-200">Ações</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className={`border-t border-tower-100 dark:border-tower-700 ${editingInvoice?.id === inv.id ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-white dark:bg-tower-800'}`}
                  >
                    <td className="py-2 px-3 font-mono text-tower-900 dark:text-tower-200">{inv.nfNumber}</td>
                    <td className="py-2 px-3 text-tower-900 dark:text-tower-200">{formatDateToDDMMYYYY(inv.emissionDate) || '-'}</td>
                    <td className="py-2 px-3 text-tower-900 dark:text-tower-200">{inv.nature || '-'}</td>
                    <td className="py-2 px-3 text-tower-900 dark:text-tower-200">{inv.species || '-'}</td>
                    <td className="py-2 px-3 text-right text-tower-900 dark:text-tower-200">{inv.volumes}</td>
                    <td className="py-2 px-3 text-right text-tower-900 dark:text-tower-200">{inv.weight} kg</td>
                    <td className="py-2 px-3 text-right text-tower-900 dark:text-tower-200">{inv.cubedVolume != null ? `${inv.cubedVolume} m³` : '-'}</td>
                    <td className="py-2 px-3 text-right text-tower-900 dark:text-tower-200">R$ {inv.value.toLocaleString('pt-BR')}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEdit(inv)}
                        className="text-brand-600 dark:text-brand-400 hover:underline text-sm font-medium"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-tower-100 dark:bg-tower-700 border-t-2 border-tower-200 dark:border-tower-600">
                <tr className="font-semibold">
                  <td colSpan={8} className="py-2 px-3 text-right text-tower-600 dark:text-tower-200">Total:</td>
                  <td className="py-2 px-3 text-right text-tower-900 dark:text-tower-200">{totals.weight} kg</td>
                  <td className="py-2 px-3 text-right text-tower-900 dark:text-tower-200">{totals.cub > 0 ? `${totals.cub} m³` : '-'}</td>
                  <td className="py-2 px-3 text-right text-tower-900 dark:text-tower-200">R$ {totals.value.toLocaleString('pt-BR')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      {showQRScanner && (
        <Suspense fallback={null}>
          <QRCodeScanner
            onScan={handleQRScan}
            onClose={() => setShowQRScanner(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default OrderNFForm;
