import React, { useState } from 'react';
import { maskCNPJOrCPF, digitsOnly, isCNPJ } from '../../lib/formatters';
import { cnpjApi } from '../../lib/api';

export interface DocumentImportData {
  legalName?: string;
  tradeName?: string;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    cityIbgeCode?: string;
  };
  situation?: string;
  situationDate?: string;
  stateRegistration?: string;
  /** Situação da IE (Ativo/Inativo/Baixado) — só vem quando a fonte foi o Sintegra. */
  stateRegistrationStatus?: string;
}

interface DocumentInputProps {
  value: string;
  onChange: (value: string) => void;
  onImport?: (data: DocumentImportData) => void;
  /** Chamado quando a consulta de importação falha — o pai decide como exibir. */
  onImportError?: (message: string) => void;
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
  onImportError,
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
    } catch (error: any) {
      const status = error?.response?.status;
      const message = status === 404
        ? 'CNPJ não encontrado.'
        : status === 429
          ? 'Muitas consultas seguidas, tente novamente em instantes.'
          : 'Não foi possível importar os dados deste CNPJ agora.';
      onImportError?.(message);
    } finally {
      setImportLoading(false);
    }
  };

  const canImport = onImport && (documentType === 'CNPJ' || (!documentType && isCNPJ(value))) && digitsOnly(value).length === 14;

  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-tower-600 dark:text-tower-300 mb-1">{label}</label>
      )}
      <div className="flex gap-2 items-start">
        <input
          type="text"
          id={id}
          value={maskCNPJOrCPF(value)}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          className={className || 'w-full p-3 bg-tower-50 dark:bg-tower-700 border border-tower-200 dark:border-tower-600 rounded-xl flex-1 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500'}
        />
        {canImport && (
          <button
            type="button"
            onClick={handleImport}
            disabled={importLoading}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 whitespace-nowrap"
          >
            {importLoading ? 'Consultando...' : 'Importar'}
          </button>
        )}
      </div>
    </div>
  );
};
