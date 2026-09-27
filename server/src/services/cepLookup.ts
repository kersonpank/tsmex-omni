import axios from 'axios';
import { AppError } from '../middleware/errorHandler.js';

export interface CepLookupResult {
    cep: string;
    logradouro: string;
    bairro: string;
    cidade: string;
    uf: string;
    /** Código IBGE do município (7 dígitos) — identificador oficial da cidade. */
    ibge: string;
    source: 'viacep' | 'brasilapi';
}

/** `null` = o provedor respondeu que o CEP não existe. Erro lançado = provedor indisponível. */
type Provider = (cep: string) => Promise<CepLookupResult | null>;

const isIbge = (value: unknown): value is string => typeof value === 'string' && /^\d{7}$/.test(value);
const TIMEOUT_MS = 5000;

const viaCep: Provider = async (cep) => {
    const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, { timeout: TIMEOUT_MS });
    if (!data || data.erro) return null;
    const ibge = String(data.ibge ?? '');
    if (!isIbge(ibge)) return null;
    return {
        cep, logradouro: data.logradouro ?? '', bairro: data.bairro ?? '',
        cidade: data.localidade ?? '', uf: data.uf ?? '', ibge, source: 'viacep',
    };
};

/**
 * ViaCEP não conhece CEPs gerais de município (ex.: 58200-000) nem CEPs novos; a BrasilAPI v2
 * agrega outras bases e devolve o IBGE nesses casos.
 */
const brasilApi: Provider = async (cep) => {
    try {
        const { data } = await axios.get(`https://brasilapi.com.br/api/cep/v2/${cep}`, { timeout: TIMEOUT_MS });
        const ibge = String(data?.ibge?.city ?? '');
        if (!isIbge(ibge)) return null;
        return {
            cep, logradouro: data.street ?? '', bairro: data.neighborhood ?? '',
            cidade: data.city ?? '', uf: data.state ?? '', ibge, source: 'brasilapi',
        };
    } catch (error: any) {
        if (error?.response?.status === 404) return null;
        throw error;
    }
};

/** Objeto mutável para os testes substituírem as consultas externas. */
export const cepProviders: { chain: Provider[] } = { chain: [viaCep, brasilApi] };

export async function lookupCep(cep: string): Promise<CepLookupResult> {
    let unavailable = 0;
    for (const provider of cepProviders.chain) {
        try {
            const found = await provider(cep);
            if (found) return found;
        } catch {
            unavailable += 1;
        }
    }
    if (unavailable === cepProviders.chain.length) {
        throw new AppError('Serviço de CEP indisponível no momento. Tente novamente ou selecione a cidade na busca.', 503);
    }
    throw new AppError('CEP não encontrado. Confira o número ou selecione a cidade na busca.', 404);
}
