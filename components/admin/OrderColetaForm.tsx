import React, { useState, useEffect } from 'react';
import { ordersEntradaApi, locationsApi } from '../../lib/api';
import {
  allVolumeRowsComplete,
  cmNumberToFormString,
  dimRowsFromCmStrings,
  volumeCmStringsToStored,
} from '../../lib/volumeDimensions';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import { maskPhone } from '../../lib/formatters';

interface Volume {
  qty: number;
  alturaCm: string;
  larguraCm: string;
  comprimentoCm: string;
}

interface SenderContact {
  name: string;
  phone: string;
  email: string;
}

interface OrderColetaFormData {
  senderContacts: SenderContact[];
  pickupAvailableTime: string;
  pickupNotes: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressNeighborhood: string;
  addressCep: string;
  addressCity: string;
  addressState: string;
  addressReferencePoint: string;
  commodity: string;
  volumesList: Volume[];
  weight: string;
  nfValue: string;
  needsHelper: boolean;
  needsLoading: boolean;
}

const emptySenderContact = (): SenderContact => ({
  name: '',
  phone: '',
  email: '',
});

const emptyForm = (): OrderColetaFormData => ({
  senderContacts: [emptySenderContact()],
  pickupAvailableTime: '',
  pickupNotes: '',
  addressStreet: '',
  addressNumber: '',
  addressComplement: '',
  addressNeighborhood: '',
  addressCep: '',
  addressCity: '',
  addressState: '',
  addressReferencePoint: '',
  commodity: '',
  volumesList: [{ qty: 1, alturaCm: '', larguraCm: '', comprimentoCm: '' }],
  weight: '',
  nfValue: '',
  needsHelper: false,
  needsLoading: false,
});

function maskCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Extrai endereço da Person para pré-preenchimento */
function addressFromPerson(p: any): Partial<OrderColetaFormData> {
  if (!p) return {};
  const addr: Partial<OrderColetaFormData> = {};
  if (p.address) addr.addressStreet = p.address;
  if (p.number) addr.addressNumber = p.number;
  if (p.complement) addr.addressComplement = p.complement;
  if (p.neighborhood) addr.addressNeighborhood = p.neighborhood;
  if (p.cep) addr.addressCep = maskCep(p.cep);
  if (p.city) addr.addressCity = p.city;
  if (p.state) addr.addressState = String(p.state || '').toUpperCase();
  return addr;
}

/** Converte collectionData do backend para o form */
function formFromCollectionData(cd: any): Partial<OrderColetaFormData> {
  if (!cd || typeof cd !== 'object') return {};
  const updates: Partial<OrderColetaFormData> = {};
  if (cd.senderContacts && Array.isArray(cd.senderContacts) && cd.senderContacts.length > 0) {
    updates.senderContacts = cd.senderContacts.map((sc: any) => ({
      name: sc.name || '',
      phone: sc.phone || '',
      email: sc.email || '',
    }));
  }
  if (cd.pickupAvailableTime) updates.pickupAvailableTime = cd.pickupAvailableTime;
  if (cd.pickupNotes) updates.pickupNotes = cd.pickupNotes;
  if (cd.address) {
    const a = cd.address;
    if (a.street) updates.addressStreet = a.street;
    if (a.number) updates.addressNumber = a.number;
    if (a.complement) updates.addressComplement = a.complement;
    if (a.neighborhood) updates.addressNeighborhood = a.neighborhood;
    if (a.cep) updates.addressCep = maskCep(a.cep);
    if (a.city) updates.addressCity = a.city;
    if (a.state) updates.addressState = String(a.state || '').toUpperCase();
    if (a.referencePoint) updates.addressReferencePoint = a.referencePoint;
  }
  if (cd.commodity) updates.commodity = cd.commodity;
  if (cd.weight != null) updates.weight = String(cd.weight);
  if (cd.nfValue != null) updates.nfValue = String(cd.nfValue);
  if (typeof cd.needsHelper === 'boolean') updates.needsHelper = cd.needsHelper;
  if (typeof cd.needsLoading === 'boolean') updates.needsLoading = cd.needsLoading;
  if (cd.dimensions) {
    try {
      const dims = typeof cd.dimensions === 'string' ? JSON.parse(cd.dimensions) : cd.dimensions;
      if (Array.isArray(dims) && dims.length > 0) {
        updates.volumesList = dims.map((d: { qty?: number; altura?: number; largura?: number; comprimento?: number }) => ({
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
  return updates;
}

/** Converte form para collectionData do backend */
function formToCollectionData(form: OrderColetaFormData): Record<string, unknown> {
  return {
    senderContacts: form.senderContacts.map((c) => ({
      name: c.name.trim(),
      phone: c.phone.trim(),
      email: c.email.trim() || undefined,
    })),
    pickupAvailableTime: form.pickupAvailableTime.trim() || undefined,
    pickupNotes: form.pickupNotes.trim() || undefined,
    address: {
      street: form.addressStreet.trim(),
      number: form.addressNumber.trim(),
      complement: form.addressComplement.trim() || undefined,
      neighborhood: form.addressNeighborhood.trim(),
      cep: form.addressCep.replace(/\D/g, ''),
      city: form.addressCity.trim(),
      state: form.addressState.trim(),
      referencePoint: form.addressReferencePoint.trim() || undefined,
    },
    commodity: form.commodity.trim() || undefined,
    weight: form.weight ? parseFloat(form.weight) : undefined,
    nfValue: form.nfValue ? parseFloat(form.nfValue) : undefined,
    needsHelper: form.needsHelper,
    needsLoading: form.needsLoading,
    dimensions: JSON.stringify(
      form.volumesList.map((v) => {
        const s = volumeCmStringsToStored(v);
        return s ?? { qty: v.qty || 0, altura: 0, largura: 0, comprimento: 0 };
      }),
    ),
    volumes: form.volumesList.reduce((sum, v) => sum + (v.qty || 0), 0),
  };
}

interface OrderColetaFormProps {
  orderId: string;
  order: any; // { remetentePerson, collectionData, ... }
  onSave?: () => void;
}

export const OrderColetaForm: React.FC<OrderColetaFormProps> = ({ orderId, order, onSave }) => {
  const [form, setForm] = useState<OrderColetaFormData>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cepLoading, setCepLoading] = useState(false);

  const update = (patch: Partial<OrderColetaFormData>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  // Inicializar e pré-preencher
  useEffect(() => {
    const base = emptyForm();
    const fromPerson = order?.remetentePerson ? addressFromPerson(order.remetentePerson) : {};
    const fromCollection = order?.collectionData ? formFromCollectionData(order.collectionData) : {};
    setForm({
      ...base,
      ...fromPerson,
      ...fromCollection,
      // collectionData tem prioridade sobre remetentePerson
      senderContacts: fromCollection.senderContacts ?? fromPerson.senderContacts ?? base.senderContacts,
      volumesList: fromCollection.volumesList ?? base.volumesList,
    });
  }, [order?.id, order?.remetentePerson?.id, order?.collectionData]);

  const fetchCep = async (cepRaw: string) => {
    const cep = cepRaw.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await locationsApi.getCEP(cep);
      const d = (r as any)?.data;
      if (d) {
        setForm((prev) => ({
          ...prev,
          addressStreet: d.logradouro || prev.addressStreet,
          addressNeighborhood: d.bairro || prev.addressNeighborhood,
          addressCity: d.cidade || prev.addressCity,
          addressState: d.uf || prev.addressState,
        }));
      }
    } catch {
      // ignore
    } finally {
      setCepLoading(false);
    }
  };

  useEffect(() => {
    const cep = form.addressCep.replace(/\D/g, '');
    if (cep.length === 8) fetchCep(form.addressCep);
  }, [form.addressCep]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!form.addressStreet.trim() || !form.addressNumber.trim()) {
      setError('Endereço e número são obrigatórios.');
      return;
    }
    if (form.senderContacts.length === 0) {
      setError('Pelo menos um contato do remetente é obrigatório.');
      return;
    }
    const invalidContact = form.senderContacts.find((c) => !c.name.trim() || !c.phone.trim());
    if (invalidContact) {
      setError('Todos os contatos devem ter nome e telefone preenchidos.');
      return;
    }
    if (!allVolumeRowsComplete(dimRowsFromCmStrings(form.volumesList))) {
      setError('Informe quantidade e medidas em cm (> 0) em cada volume.');
      return;
    }

    setSaving(true);
    try {
      const collectionData = formToCollectionData(form);
      await ordersEntradaApi.updatePeople(orderId, { collectionData });
      setSuccess('Dados de coleta salvos.');
      onSave?.();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      )}
      {success && (
        <div className="p-4 bg-brand-50 border border-brand-200 rounded-xl text-brand-700 text-sm">
          {success}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-tower-700 mb-3">Contatos do remetente (no local)</h3>
        <div className="space-y-4">
          {form.senderContacts.map((contact, idx) => (
            <div key={idx} className="bg-tower-50 rounded-xl p-4 border border-tower-200">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-medium text-tower-700">Contato {idx + 1}</span>
                {form.senderContacts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => update({ senderContacts: form.senderContacts.filter((_, i) => i !== idx) })}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remover
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-tower-500 mb-1">Nome *</label>
                  <input
                    type="text"
                    value={contact.name}
                    onChange={(e) => {
                      const newContacts = [...form.senderContacts];
                      newContacts[idx] = { ...contact, name: e.target.value };
                      update({ senderContacts: newContacts });
                    }}
                    className="w-full p-2 border border-tower-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-tower-500 mb-1">Telefone *</label>
                  <input
                    type="text"
                    value={maskPhone(contact.phone)}
                    onChange={(e) => {
                      const newContacts = [...form.senderContacts];
                      newContacts[idx] = { ...contact, phone: e.target.value.replace(/\D/g, '') };
                      update({ senderContacts: newContacts });
                    }}
                    className="w-full p-2 border border-tower-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-tower-500 mb-1">E-mail</label>
                  <input
                    type="email"
                    value={contact.email}
                    onChange={(e) => {
                      const newContacts = [...form.senderContacts];
                      newContacts[idx] = { ...contact, email: e.target.value };
                      update({ senderContacts: newContacts });
                    }}
                    className="w-full p-2 border border-tower-200 rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => update({ senderContacts: [...form.senderContacts, emptySenderContact()] })}
            className="px-4 py-2 bg-tower-100 hover:bg-tower-200 text-tower-700 rounded-lg text-sm font-medium"
          >
            + Adicionar contato
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-tower-500 mb-1">Horário disponível</label>
            <input
              type="text"
              value={form.pickupAvailableTime}
              onChange={(e) => update({ pickupAvailableTime: e.target.value })}
              className="w-full p-2 border border-tower-200 rounded-lg text-sm"
              placeholder="Ex: 8h às 18h"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-tower-500 mb-1">Observações</label>
            <textarea
              value={form.pickupNotes}
              onChange={(e) => update({ pickupNotes: e.target.value })}
              className="w-full p-2 border border-tower-200 rounded-lg text-sm"
              rows={2}
              placeholder="Observações sobre o local da coleta"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-tower-700 mb-3">Endereço de coleta</h3>
        <div className="space-y-4">
          <div className="max-w-[180px]">
            <label className="block text-xs font-medium text-tower-500 mb-1">CEP</label>
            <input
              type="text"
              value={form.addressCep}
              onChange={(e) => update({ addressCep: maskCep(e.target.value) })}
              className="w-full p-2 border border-tower-200 rounded-lg text-sm"
              placeholder="00000-000"
              maxLength={9}
            />
            {cepLoading && <span className="text-xs text-tower-500">Buscando...</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-tower-500 mb-1">Endereço *</label>
              <input
                type="text"
                value={form.addressStreet}
                onChange={(e) => update({ addressStreet: e.target.value })}
                className="w-full p-2 border border-tower-200 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-tower-500 mb-1">Número *</label>
              <input
                type="text"
                value={form.addressNumber}
                onChange={(e) => update({ addressNumber: e.target.value })}
                className="w-full p-2 border border-tower-200 rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-tower-500 mb-1">Complemento</label>
            <input
              type="text"
              value={form.addressComplement}
              onChange={(e) => update({ addressComplement: e.target.value })}
              className="w-full p-2 border border-tower-200 rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-tower-500 mb-1">Bairro</label>
              <input
                type="text"
                value={form.addressNeighborhood}
                onChange={(e) => update({ addressNeighborhood: e.target.value })}
                className="w-full p-2 border border-tower-200 rounded-lg text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-tower-500 mb-1">Cidade / UF</label>
              <CityAutocomplete
                value={
                  form.addressCity && form.addressState
                    ? `${form.addressCity}, ${form.addressState}`
                    : form.addressCity
                }
                onChange={(v) => {
                  const parts = v.split(', ');
                  if (parts.length >= 2) update({ addressCity: parts[0], addressState: parts[1] });
                  else update({ addressCity: v });
                }}
                onSelect={(city, state) => update({ addressCity: city, addressState: state })}
                placeholder="Ex: São Paulo, SP"
                className="w-full p-2 border border-tower-200 rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-tower-500 mb-1">Ponto de referência</label>
            <textarea
              value={form.addressReferencePoint}
              onChange={(e) => update({ addressReferencePoint: e.target.value })}
              className="w-full p-2 border border-tower-200 rounded-lg text-sm"
              rows={2}
              placeholder="Detalhes para localização"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-tower-700 mb-3">Mercadoria</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-tower-500 mb-1">O que é a mercadoria</label>
            <input
              type="text"
              value={form.commodity}
              onChange={(e) => update({ commodity: e.target.value })}
              className="w-full p-2 border border-tower-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-tower-500 mb-1">Peso (kg)</label>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={form.weight}
              onChange={(e) => update({ weight: e.target.value })}
              className="w-full p-2 border border-tower-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-tower-500 mb-1">Valor da NF (R$)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.nfValue}
              onChange={(e) => update({ nfValue: e.target.value })}
              className="w-full p-2 border border-tower-200 rounded-lg text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.needsHelper}
              onChange={(e) => update({ needsHelper: e.target.checked })}
              className="rounded"
            />
            <span className="text-sm">Precisa de ajudante</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.needsLoading}
              onChange={(e) => update({ needsLoading: e.target.checked })}
              className="rounded"
            />
            <span className="text-sm">Necessário carregar</span>
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-tower-700 mb-3">Volumes</h3>
        <div className="space-y-3">
          {form.volumesList.map((vol, volIdx) => (
            <div key={volIdx} className="flex flex-wrap gap-3 items-center bg-tower-50 p-3 rounded-lg">
              <input
                type="number"
                min={1}
                placeholder="Qtd"
                value={vol.qty || ''}
                onChange={(e) => {
                  const newList = [...form.volumesList];
                  newList[volIdx] = { ...vol, qty: parseInt(e.target.value, 10) || 0 };
                  update({ volumesList: newList });
                }}
                className="w-16 p-2 border border-tower-200 rounded-lg text-sm"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="Alt (cm)"
                value={vol.alturaCm}
                onChange={(e) => {
                  const newList = [...form.volumesList];
                  newList[volIdx] = { ...vol, alturaCm: e.target.value };
                  update({ volumesList: newList });
                }}
                className="w-24 p-2 border border-tower-200 rounded-lg text-sm"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="Larg (cm)"
                value={vol.larguraCm}
                onChange={(e) => {
                  const newList = [...form.volumesList];
                  newList[volIdx] = { ...vol, larguraCm: e.target.value };
                  update({ volumesList: newList });
                }}
                className="w-24 p-2 border border-tower-200 rounded-lg text-sm"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="Comp (cm)"
                value={vol.comprimentoCm}
                onChange={(e) => {
                  const newList = [...form.volumesList];
                  newList[volIdx] = { ...vol, comprimentoCm: e.target.value };
                  update({ volumesList: newList });
                }}
                className="w-24 p-2 border border-tower-200 rounded-lg text-sm"
              />
              {form.volumesList.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    update({
                      volumesList: form.volumesList.filter((_, i) => i !== volIdx),
                    })
                  }
                  className="text-xs text-red-600 hover:underline"
                >
                  Remover
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              update({
                volumesList: [
                  ...form.volumesList,
                  { qty: 1, alturaCm: '', larguraCm: '', comprimentoCm: '' },
                ],
              })
            }
            className="px-4 py-2 bg-tower-100 hover:bg-tower-200 text-tower-700 rounded-lg text-sm"
          >
            + Adicionar volume
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="px-6 py-3 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? 'Salvando...' : 'Salvar dados de coleta'}
      </button>
    </form>
  );
};
