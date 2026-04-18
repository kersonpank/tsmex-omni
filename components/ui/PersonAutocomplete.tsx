import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { personsApi } from '../../lib/api';
import { DocumentInput } from './DocumentInput';
import { maskCNPJOrCPF } from '../../lib/formatters';
import type { Person, PersonDocumentType } from '../../types/index';

interface PersonAutocompleteProps {
  value: Person | null;
  onChange: (person: Person | null) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  required?: boolean;
  /** Se true, mostra botão para adicionar como Cliente após criar (para pagador) */
  showAddClientHint?: boolean;
}

function formatDoc(doc: string, type: PersonDocumentType): string {
  const d = doc.replace(/\D/g, '');
  if (type === 'CPF' && d.length === 11) {
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (type === 'CNPJ' && d.length === 14) {
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return doc;
}

/** Parse inputValue to extract document and legalName for pre-filling create modal */
function parseInputForCreate(inputValue: string): { document: string; documentType: PersonDocumentType; legalName: string } {
  const allDigits = inputValue.replace(/\D/g, '');
  let document = '';
  let documentType: PersonDocumentType = 'CNPJ';
  if (allDigits.length === 11) {
    document = allDigits;
    documentType = 'CPF';
  } else if (allDigits.length >= 12 && allDigits.length <= 13) {
    document = allDigits.padStart(14, '0');
    documentType = 'CNPJ';
  } else if (allDigits.length >= 14) {
    document = allDigits.slice(0, 14);
    documentType = 'CNPJ';
  }
  const docPatterns = [/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, /\d{14}/g, /\d{11}/g];
  let legalName = inputValue;
  for (const p of docPatterns) legalName = legalName.replace(p, '');
  legalName = legalName.replace(/\s*-\s*/g, ' ').trim();
  return { document, documentType, legalName };
}

export const PersonAutocomplete: React.FC<PersonAutocompleteProps> = ({
  value,
  onChange,
  placeholder = 'Buscar por nome ou documento...',
  label,
  className = '',
  required = false,
  showAddClientHint = false,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalInitial, setCreateModalInitial] = useState<{ document: string; documentType: PersonDocumentType; legalName: string } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setInputValue(`${value.legalName}${value.tradeName ? ` (${value.tradeName})` : ''} - ${formatDoc(value.document, value.documentType)}`);
    } else {
      setInputValue('');
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const search = async (q: string) => {
    if (!q || q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await personsApi.search(q);
      const data = (res as any)?.data ?? [];
      setSuggestions(Array.isArray(data) ? data : []);
      setShowDropdown(true);
    } catch {
      setSuggestions([]);
      setShowDropdown(true);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInputValue(v);
    if (!value) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => search(v), 250);
    } else {
      onChange(null);
    }
  };

  const handleSelect = (p: Person) => {
    onChange(p);
    setInputValue(`${p.legalName}${p.tradeName ? ` (${p.tradeName})` : ''} - ${formatDoc(p.document, p.documentType)}`);
    setSuggestions([]);
    setShowDropdown(false);
  };

  const handleClear = () => {
    onChange(null);
    setInputValue('');
  };

  const handleCreateSuccess = (newPerson: Person) => {
    setShowCreateModal(false);
    handleSelect(newPerson);
  };

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-tower-600 dark:text-tower-300 mb-1">{label}</label>
      )}
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (suggestions.length > 0) setShowDropdown(true);
            else if (inputValue.trim().length >= 2) search(inputValue);
          }}
          placeholder={placeholder}
          required={required && !value}
          className={`w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 pr-16 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500 ${className}`}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-tower-400 dark:text-tower-400 hover:text-tower-600 dark:hover:text-tower-200 text-sm"
          >
            Limpar
          </button>
        )}
      </div>
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-tower-800 border border-tower-200 dark:border-tower-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-tower-500 dark:text-tower-400 text-sm">Buscando...</div>
          ) : suggestions.length === 0 ? (
            <div className="p-3">
              <p className="text-tower-600 dark:text-tower-300 text-sm mb-2">Nenhum resultado encontrado.</p>
              <button
                type="button"
                onClick={() => {
                  setShowDropdown(false);
                  setCreateModalInitial(parseInputForCreate(inputValue));
                  setShowCreateModal(true);
                }}
                className="text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 font-medium text-sm"
              >
                + Cadastrar nova pessoa
              </button>
            </div>
          ) : (
            <>
              {suggestions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p)}
                  className="w-full text-left px-3 py-2 hover:bg-tower-50 dark:hover:bg-tower-700 border-b border-tower-50 dark:border-tower-700 last:border-0"
                >
                  <div className="font-medium text-tower-900 dark:text-tower-100">{p.legalName}</div>
                  <div className="text-xs text-tower-500 dark:text-tower-400">
                    {formatDoc(p.document, p.documentType)}
                    {(p.clients && p.clients.length > 0) && (
                      <span className="ml-2 text-brand-600 dark:text-brand-400">Cliente</span>
                    )}
                  </div>
                </button>
              ))}
              <div className="border-t border-tower-100 dark:border-tower-700 p-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDropdown(false);
                    setCreateModalInitial(parseInputForCreate(inputValue));
                    setShowCreateModal(true);
                  }}
                  className="text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 text-sm font-medium"
                >
                  + Cadastrar nova pessoa
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {showCreateModal && typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <PersonCreateModal
            initialValues={createModalInitial ? {
              document: createModalInitial.document,
              documentType: createModalInitial.documentType,
              legalName: createModalInitial.legalName,
            } : undefined}
            onClose={() => { setShowCreateModal(false); setCreateModalInitial(null); }}
            onSuccess={handleCreateSuccess}
            showAddClientHint={showAddClientHint}
          />,
          document.body
        )
      }
    </div>
  );
};

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
  country: 'BRASIL',
};

function PersonCreateModal({
  initialValues,
  onClose,
  onSuccess,
  showAddClientHint,
}: {
  initialValues?: { document?: string; documentType?: PersonDocumentType; legalName?: string };
  onClose: () => void;
  onSuccess: (person: Person) => void;
  showAddClientHint?: boolean;
}) {
  const [form, setForm] = useState(() => ({
    ...defaultPersonForm,
    ...(initialValues && {
      document: initialValues.document ?? '',
      documentType: initialValues.documentType ?? 'CNPJ',
      legalName: initialValues.legalName ?? '',
    }),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
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
        country: form.country || 'BRASIL',
      };
      const res = await personsApi.create(payload);
      const created = (res as any)?.data ?? res;
      onSuccess(created);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} role="dialog">
      <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 border border-tower-200 dark:border-tower-700" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-tower-900 dark:text-tower-100 mb-4">Cadastrar nova pessoa</h3>
        {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Tipo documento</label>
            <select
              value={form.documentType}
              onChange={e => setForm(f => ({ ...f, documentType: e.target.value as PersonDocumentType }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
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
            onImport={form.documentType === 'CNPJ' ? (data: any) => setForm(f => ({
              ...f,
              legalName: data.legalName || f.legalName,
              tradeName: data.tradeName || f.tradeName,
              address: data.address ? [data.address.street, data.address.number, data.address.complement, data.address.neighborhood].filter(Boolean).join(', ') : f.address,
              city: data.address?.city || f.city,
              state: data.address?.state || f.state,
              cep: data.address?.zipCode || f.cep,
            })) : undefined}
            placeholder={form.documentType === 'CPF' ? '11 dígitos' : '14 dígitos'}
            required
            className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
          />
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Nome / Razão social *</label>
            <input
              type="text"
              value={form.legalName}
              onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Fantasia</label>
            <input
              type="text"
              value={form.tradeName}
              onChange={e => setForm(f => ({ ...f, tradeName: e.target.value }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
            />
          </div>
          {showAddClientHint && (
            <p className="text-amber-700 dark:text-amber-200 text-sm bg-amber-50 dark:bg-amber-900/30 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
              Se esta pessoa for o pagador do frete (CIF/FOB/Outro), adicione-a como Cliente em Pessoas após salvar.
            </p>
          )}
          <div className="flex gap-2 justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-700 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Salvando...' : 'Gravar Pessoa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
