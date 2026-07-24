import { useState, useCallback } from 'react';
import { nfeApi } from '../lib/api';

export interface NfeLookupResult {
  chave: string;
  uf: string;
  serie: string;
  numero: string;
  emissionDate: string; // YYYY-MM-DD (dia 01 do mês)
  cnpjEmitente: string;
  emitenteRazaoSocial: string | null;
  emitenteTradeName: string | null;
  emitenteMunicipio: string | null;
  emitenteCep: string | null;
  emitenteLogradouro: string | null;
  emitenteNumero: string | null;
  emitenteBairro: string | null;
  emitenteIe: string | null;
  destinatario: { cnpj: string; razaoSocial: string | null; ie: string | null } | null;
  modelo: string;
}

interface UseNfeLookupReturn {
  lookup: (chaveOrUrl: string, hubId?: string) => Promise<NfeLookupResult | null>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

/** Extrai a chave de 44 dígitos de uma string (URL de QR Code ou dígitos diretos) */
function extractChave(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 44) return digits;

  try {
    const url = new URL(input);
    const chNFe = url.searchParams.get('chNFe') ?? url.searchParams.get('p');
    if (chNFe) {
      const extracted = chNFe.split('|')[0].replace(/\D/g, '');
      if (extracted.length === 44) return extracted;
    }
  } catch {
    // não é URL
  }
  return digits;
}

export function useNfeLookup(): UseNfeLookupReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (chaveOrUrl: string, hubId?: string): Promise<NfeLookupResult | null> => {
    const chave = extractChave(chaveOrUrl);

    if (chave.length !== 44) {
      setError('Chave NF-e deve ter 44 dígitos.');
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await nfeApi.lookup(chave, hubId);
      return res.data.data;
    } catch (err: any) {
      const msg = err.response?.data?.error ?? err.message ?? 'Erro ao consultar NF-e';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { lookup, loading, error, clearError };
}
