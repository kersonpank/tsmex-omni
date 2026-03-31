import React, { useState } from 'react';
import { maskCNPJOrCPF, digitsOnly, isCNPJ } from '../../lib/formatters';
import { cnpjApi } from '../../lib/api';

interface DocumentInputProps {
  value: string;
  onChange: (value: string) => void;
  onImport?: (data: { legalName?: string; tradeName?: string; address?: any }) => void;
  /** Se informado, limita formato. CPF = 11 dígitos (sem import). CNPJ = 14 com import. */
  documentType?: 'CPF' | 'CNPJ';
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export const DocumentInput: React.FC<DocumentInputProps> = ({
  value,
  onChange,
  onImport,
  documentType,
  placeholder = 'CPF ou CNPJ',
  label,
  disabled = false,
  className = '',
  id,
}) => {
  const [importLoading, setImportLoading] = useState(false);

  const maxLen = documentType === 'CPF' ? 11 : 14;
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    let d = digitsOnly(v).slice(0, maxLen);
    // CNPJ: preencher com zeros à esquerda se 12 ou 13 dígitos
    if (maxLen === 14 && d.length >= 12 && d.length <= 13) {
      d = d.padStart(14, '0');
    }
    onChange(d);
  };

  const handleImport = async () => {
    const doc = digitsOnly(value);
    if (doc.length !== 14 || !isCNPJ(value)) return;
    setImportLoading(true);
    try {
      const res = await cnpjApi.consult(doc);
      const data = (res as any)?.data ?? res;
      onImport?.(data);
    } catch {
      // Erro tratado pelo pai se necessário
    } finally {
      setImportLoading(false);
    }
  };

  const canImport = onImport && (documentType === 'CNPJ' || (!documentType && isCNPJ(value))) && digitsOnly(value).length === 14;

  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">{label}</label>
      )}
      <div className="flex gap-2 items-start">
        <input
          type="text"
          id={id}
          value={maskCNPJOrCPF(value)}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          className={className || 'w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl flex-1 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500'}
        />
        {canImport && (
          <button
            type="button"
            onClick={handleImport}
            disabled={importLoading}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            {importLoading ? 'Consultando...' : 'Importar'}
          </button>
        )}
      </div>
    </div>
  );
};
