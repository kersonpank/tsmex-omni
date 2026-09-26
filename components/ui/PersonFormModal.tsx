import React, { useState } from 'react';
import { personsApi } from '../../lib/api';
import { DocumentInput, type DocumentImportData } from './DocumentInput';
import { FiscalAddressFields } from '../manifest/FiscalAddressFields';
import type { Person, PersonDocumentType, CreatePersonRequest } from '../../types/index';

const defaultPersonForm = {
  documentType: 'CNPJ' as PersonDocumentType,
  document: '',
  legalName: '',
  tradeName: '',
  cep: '',
  address: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  cityIbgeCode: '',
  country: 'BRASIL',
  stateRegistration: '',
  municipalRegistration: '',
};

export interface PersonFormModalInitialValues extends Partial<CreatePersonRequest> {
  tradeName?: string;
  cep?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  cityIbgeCode?: string;
  country?: string;
  stateRegistration?: string;
  municipalRegistration?: string;
}

export interface PersonFormModalProps {
  mode: 'create' | 'edit';
  personId?: string;
  /** Título do modal. Padrão: "Cadastrar nova pessoa" (create) / "Editar Pessoa" (edit). */
  title?: string;
  /** Se true, exige IE preenchida ou "Isento" — usado quando a pessoa é/será emissor fiscal. */
  isEmitter?: boolean;
  initialValues: PersonFormModalInitialValues;
  onClose: () => void;
  onSuccess: (person: Person) => void;
  /** Mostra aviso pra adicionar como Cliente depois de salvar (fluxo de pagador CIF/FOB). */
  showAddClientHint?: boolean;
  stateRegistrationSuggestion?: { value: string; source: string };
}

/**
 * Modal único de criar/editar Pessoa, usado tanto pela aba Pessoas (admin) quanto pelo
 * PersonAutocomplete (Hub, cotação, etc.) — antes eram duas implementações duplicadas que
 * corrigiam bugs de importação de CNPJ/IE de forma independente e divergente.
 */
export function PersonFormModal({
  mode,
  personId,
  title,
  isEmitter = false,
  initialValues,
  onClose,
  onSuccess,
  showAddClientHint = false,
  stateRegistrationSuggestion,
}: PersonFormModalProps) {
  const [form, setForm] = useState({ ...defaultPersonForm, ...initialValues, stateRegistration: initialValues.stateRegistration || stateRegistrationSuggestion?.value || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<{ situation?: string; situationDate?: string; stateRegistrationStatus?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const cleanIeVal = (form.stateRegistration || '').trim().toUpperCase();
      if (isEmitter && !cleanIeVal) {
        setError("A Inscrição Estadual é obrigatória para emissores fiscais. Caso seja isento, marque a opção 'Isento'.");
        setSaving(false);
        return;
      }
      if ((form.city || form.state || form.cep) && !form.cityIbgeCode) throw new Error('Confirme a cidade pelo CEP ou selecione uma sugestão da busca.');
      const payload = {
        documentType: form.documentType,
        document: form.document.replace(/\D/g, ''),
        legalName: form.legalName,
        tradeName: form.tradeName || undefined,
        cep: form.cep || undefined,
        address: form.address || undefined,
        number: form.number || undefined,
        complement: form.complement || undefined,
        neighborhood: form.neighborhood || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        cityIbgeCode: form.cityIbgeCode || undefined,
        country: form.country || 'BRASIL',
        stateRegistration: form.stateRegistration || undefined,
        municipalRegistration: form.municipalRegistration || undefined,
      };
      const res = mode === 'create'
        ? await personsApi.create(payload)
        : personId
          ? await personsApi.update(personId, payload)
          : null;
      if (!res) throw new Error('Pessoa sem identificação para edição.');
      const saved = (res as any)?.data ?? res;
      onSuccess(saved as Person);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} role="dialog">
      <div className="bg-white dark:bg-tower-900 rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 border border-tower-200 dark:border-tower-700" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-tower-900 dark:text-tower-100 mb-4">
          {title || (mode === 'create' ? 'Cadastrar nova pessoa' : 'Editar Pessoa')}
        </h3>
        {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
        {stateRegistrationSuggestion && <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-950 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-100">
          <p>IE {stateRegistrationSuggestion.value} encontrada em {stateRegistrationSuggestion.source}.</p>
          {initialValues.stateRegistration && initialValues.stateRegistration !== stateRegistrationSuggestion.value && <>
            <p className="mt-1 font-semibold">O cadastro atual contém IE {initialValues.stateRegistration}. Confira a divergência antes de substituir.</p>
            <button type="button" onClick={() => setForm((current) => ({ ...current, stateRegistration: stateRegistrationSuggestion.value }))} className="mt-2 rounded-lg border border-brand-400 px-3 py-2 font-bold">Usar IE da NF-e</button>
          </>}
        </div>}
        {isEmitter && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2 mb-4">
            <span className="text-sm">⚠️</span>
            <div>
              <p className="font-semibold">Pessoa vinculada como Emissor Fiscal</p>
              <p className="mt-0.5">A Inscrição Estadual (IE) é obrigatória. Insira uma IE válida (somente números) ou marque como "Isento".</p>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo documento</label>
            <select
              value={form.documentType}
              onChange={e => setForm(f => ({ ...f, documentType: e.target.value as PersonDocumentType }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
              required
            >
              <option value="CPF">CPF</option>
              <option value="CNPJ">CNPJ</option>
            </select>
          </div>
          <DocumentInput
            label="Documento"
            value={form.document}
            onChange={(v) => setForm(f => ({ ...f, document: v }))}
            documentType={form.documentType}
            onImport={form.documentType === 'CNPJ' ? (data: DocumentImportData) => {
              setImportError(null);
              setImportInfo({
                situation: data.situation,
                situationDate: data.situationDate,
                stateRegistrationStatus: data.stateRegistrationStatus,
              });
              setForm(f => ({
                ...f,
                legalName: data.legalName || f.legalName,
                tradeName: data.tradeName || f.tradeName,
                address: data.address?.street || f.address,
                number: data.address?.number || f.number,
                complement: data.address?.complement || f.complement,
                neighborhood: data.address?.neighborhood || f.neighborhood,
                city: data.address?.city || f.city,
                state: data.address?.state || f.state,
                cityIbgeCode: data.address?.cityIbgeCode || '',
                cep: data.address?.zipCode || f.cep,
                stateRegistration: f.stateRegistration || data.stateRegistration || '',
              }));
            } : undefined}
            onImportError={(msg) => { setImportError(msg); setImportInfo(null); }}
            placeholder={form.documentType === 'CPF' ? '11 dígitos' : '14 dígitos'}
            required
            className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
          />
          {importError && (
            <p className="text-red-600 dark:text-red-400 text-sm">{importError}</p>
          )}
          {importInfo?.situation && (
            <p className={`text-sm ${/^ativ/i.test(importInfo.situation) ? 'text-tower-500 dark:text-tower-400' : 'text-amber-700 dark:text-amber-300'}`}>
              Situação na Receita: {importInfo.situation}{importInfo.situationDate ? ` (desde ${importInfo.situationDate})` : ''}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Nome / Razão social *</label>
            <input
              type="text"
              value={form.legalName}
              onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Fantasia</label>
            <input
              type="text"
              value={form.tradeName}
              onChange={e => setForm(f => ({ ...f, tradeName: e.target.value }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
            />
          </div>
          <FiscalAddressFields value={form} onChange={setForm} readOnly={false} required={false}
            fieldClass="w-full min-h-11 border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-[var(--app-surface)] text-tower-900 dark:text-tower-100" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200">Inscrição Estadual (IE)</label>
                <label className="flex items-center gap-1 text-xs cursor-pointer text-tower-500 dark:text-tower-400">
                  <input
                    type="checkbox"
                    checked={form.stateRegistration === 'ISENTO'}
                    onChange={e => {
                      setForm(f => ({
                        ...f,
                        stateRegistration: e.target.checked ? 'ISENTO' : ''
                      }));
                    }}
                    className="rounded border-tower-300 dark:border-tower-600 text-brand-600 focus:ring-brand-500"
                  />
                  <span>Isento</span>
                </label>
              </div>
              <input
                type="text"
                disabled={form.stateRegistration === 'ISENTO'}
                value={form.stateRegistration === 'ISENTO' ? 'ISENTO' : form.stateRegistration}
                onChange={e => setForm(f => ({ ...f, stateRegistration: e.target.value }))}
                placeholder={form.stateRegistration === 'ISENTO' ? 'ISENTO' : 'Apenas números'}
                className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 disabled:bg-tower-100 dark:disabled:bg-tower-850 placeholder:text-tower-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
              />
              {form.stateRegistration && form.stateRegistration !== 'ISENTO' && importInfo?.stateRegistrationStatus && !/^ativ/i.test(importInfo.stateRegistrationStatus) && (
                <p className="text-amber-700 dark:text-amber-300 text-xs mt-1">
                  IE encontrada está com situação "{importInfo.stateRegistrationStatus}" — confirme antes de usar para emissão fiscal.
                </p>
              )}
              {form.documentType === 'CNPJ' && !form.stateRegistration && importInfo && (
                <p className="text-tower-500 dark:text-tower-400 text-xs mt-1">
                  Nenhuma IE encontrada nas fontes consultadas — confirme e marque "Isento" se for o caso.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Inscrição Municipal (IM)</label>
              <input
                type="text"
                value={form.municipalRegistration || ''}
                onChange={e => setForm(f => ({ ...f, municipalRegistration: e.target.value }))}
                placeholder="Opcional"
                className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
              />
            </div>
          </div>
          {showAddClientHint && (
            <p className="text-amber-700 dark:text-amber-200 text-sm bg-amber-50 dark:bg-amber-900/30 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
              Se esta pessoa for o pagador do frete (CIF/FOB/Outro), adicione-a como Cliente em Pessoas após salvar.
            </p>
          )}
          <div className="flex gap-2 justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Salvando...' : 'Gravar Pessoa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
