import axios from 'axios';
import { AppError } from '../middleware/errorHandler.js';
import { resolveIbgeCode } from './acbr/acbrIbge.js';

interface CNPJData {
    cnpj: string;
    legalName: string;
    tradeName?: string;
    situation?: string;
    situationDate?: string;
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
    phone?: string;
    email?: string;
    cnae?: string;
    cnaeDescription?: string;
    openingDate?: string;
    legalNature?: string;
    capital?: number;
    size?: string;
    source: 'receitaws' | 'sintegra';
    stateRegistration?: string;
    /** Situação da IE retornada pelo Sintegra (Ativo/Inativo/Baixado) — nunca vem do ReceitaWS. */
    stateRegistrationStatus?: string;
    /** Uma fonte sem IE não comprova isenção; falha é diferente de ausência. */
    stateRegistrationLookup?: 'found' | 'not_found' | 'not_requested' | 'unavailable';
}

export function normalizeStateRegistration(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const ie = String(value).trim();
    if (ie.toUpperCase() === 'ISENTO') return 'ISENTO';
    if (!/^[\d.\-/\s]+$/.test(ie)) return undefined;
    return ie.replace(/\D/g, '') || undefined;
}

type LookupResult =
    | { status: 'found'; data: CNPJData }
    | { status: 'not_found' | 'unavailable' };

// Consulta ReceitaWS (gratuita)
async function consultReceitaWS(cnpj: string): Promise<LookupResult> {
    try {
        const cleanCNPJ = cnpj.replace(/\D/g, '');
        
        const response = await axios.get(`https://www.receitaws.com.br/v1/cnpj/${cleanCNPJ}`, {
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
            }
        });

        if (response.data.status === 'ERROR') {
            return { status: /n[aã]o encontrado/i.test(String(response.data.message ?? '')) ? 'not_found' : 'unavailable' };
        }

        const data = response.data;

        return { status: 'found', data: {
            cnpj: cleanCNPJ,
            legalName: data.nome || '',
            tradeName: data.fantasia || undefined,
            situation: data.situacao,
            situationDate: data.data_situacao,
            address: {
                street: data.logradouro,
                number: data.numero,
                complement: data.complemento,
                neighborhood: data.bairro,
                city: data.municipio,
                state: data.uf,
                zipCode: data.cep?.replace(/\D/g, ''),
            },
            phone: data.telefone,
            email: data.email,
            cnae: data.atividade_principal?.[0]?.code,
            cnaeDescription: data.atividade_principal?.[0]?.text,
            openingDate: data.abertura,
            legalNature: data.natureza_juridica,
            capital: data.capital_social ? parseFloat(data.capital_social) : undefined,
            size: data.porte,
            source: 'receitaws',
            stateRegistration: normalizeStateRegistration(data.inscricao_estadual),
        } };
    } catch (error: any) {
        if (error.response?.status === 429) {
            throw new AppError('Rate limit exceeded. Please try again later.', 429);
        }
        if (error.response?.status === 404) {
            return { status: 'not_found' };
        }
        console.error('ReceitaWS error:', error.message);
        return { status: 'unavailable' };
    }
}

// Consulta SintegraWS (requer token)
async function consultSintegraWS(cnpj: string, token: string): Promise<LookupResult> {
    if (!token) {
        return { status: 'unavailable' };
    }

    try {
        const cleanCNPJ = cnpj.replace(/\D/g, '');
        
        const response = await axios.get('https://www.sintegraws.com.br/api/v1/execute-api.php', {
            params: {
                token: token,
                cnpj: cleanCNPJ,
                plugin: 'ST', // Use Sintegra plugin to retrieve state registration (IE)
            },
            timeout: 10000,
        });

        const resData = response.data;
        if (resData.status === 'ERROR' || resData.code === 'ERROR') {
            return { status: 'unavailable' };
        }

        const data = resData.dados || resData;

        // Map address fields
        const street = data.logradouro || undefined;
        const number = data.numero || undefined;
        const complement = data.complemento || undefined;
        const neighborhood = data.bairro || undefined;
        const city = data.municipio || data.cidade || undefined;
        const state = data.uf || undefined;
        const zipCode = data.cep ? String(data.cep).replace(/\D/g, '') : undefined;

        // Map CNAE (a API retorna cnae_principal.code/text, não codigo/descricao)
        let cnae = data.cnae_principal?.code || data.cnae_principal?.codigo || data.cnae || undefined;
        let cnaeDescription = data.cnae_principal?.text || data.cnae_principal?.descricao || data.cnae_descricao || undefined;

        // Clean IE: SintegraWS might return 'ISENTO' or numbers with dots/dashes, clean them or keep ISENTO
        const stateRegistration = normalizeStateRegistration(data.inscricao_estadual);

        // situacao_ie: status da própria IE (Ativo/Inativo/Baixado) — distinto de situacao_cnpj.
        const stateRegistrationStatus = data.situacao_ie || undefined;

        return { status: 'found', data: {
            cnpj: cleanCNPJ,
            legalName: data.razao_social || data.nome_empresarial || data.nome || '',
            tradeName: data.nome_fantasia || data.fantasia || undefined,
            situation: data.situacao_cnpj || data.situacao_cadastral || data.situacao || undefined,
            situationDate: data.data_situacao_cadastral || data.data_situacao || undefined,
            address: (street || city || state || zipCode) ? {
                street,
                number,
                complement,
                neighborhood,
                city,
                state,
                zipCode,
            } : undefined,
            phone: data.telefone,
            email: data.email,
            cnae: cnae ? String(cnae) : undefined,
            cnaeDescription: cnaeDescription ? String(cnaeDescription) : undefined,
            openingDate: data.data_inicio_atividade || data.abertura || undefined,
            legalNature: data.natureza_juridica,
            capital: data.capital_social ? parseFloat(String(data.capital_social)) : undefined,
            size: data.porte,
            source: 'sintegra',
            stateRegistration,
            stateRegistrationStatus,
        } };
    } catch {
        // O token é enviado na query; não registrar a mensagem de erro do cliente HTTP.
        console.error('SintegraWS indisponível durante consulta de IE.');
        return { status: 'unavailable' };
    }
}

// Main function: tries ReceitaWS first, then SintegraWS if available
export async function consultCNPJ(cnpj: string, sintegraToken?: string): Promise<CNPJData> {
    const cleanCNPJ = cnpj.replace(/\D/g, '');

    if (cleanCNPJ.length !== 14) {
        throw new AppError('CNPJ must have 14 digits', 400);
    }

    // Try ReceitaWS first (free)
    const receita = await consultReceitaWS(cleanCNPJ);
    let result = receita.status === 'found' ? receita.data : null;
    let ieLookup: CNPJData['stateRegistrationLookup'] = result?.stateRegistration ? 'found' : 'not_requested';
    // Consulta paga só quando há token e a fonte gratuita não trouxe IE ou razão social.
    if ((!result?.legalName || !result.stateRegistration) && sintegraToken) {
        const sintegra = await consultSintegraWS(cleanCNPJ, sintegraToken);
        if (sintegra.status === 'found') {
            const data = sintegra.data;
            if (!result?.legalName) result = data;
            else {
                if (data.stateRegistration) {
                    result.stateRegistration = data.stateRegistration;
                    result.stateRegistrationStatus = data.stateRegistrationStatus;
                }
                if (!result.tradeName && data.tradeName) result.tradeName = data.tradeName;
            }
            ieLookup = result?.stateRegistration ? 'found' : 'not_found';
        } else {
            ieLookup = 'unavailable';
        }
    }

    if (!result || !result.legalName) {
        if (receita.status === 'unavailable' || ieLookup === 'unavailable') {
            throw new AppError('Consulta de CNPJ indisponível. Tente novamente ou informe os dados manualmente.', 503);
        }
        throw new AppError('CNPJ not found or invalid', 404);
    }
    result.stateRegistrationLookup = ieLookup;

    if (result && result.address?.city && result.address?.state) {
        try {
            const resolved = await resolveIbgeCode(result.address.city, result.address.state);
            if (resolved) {
                result.address.cityIbgeCode = resolved.ibgeCode;
            }
        } catch (e) {
            console.error('Failed to resolve IBGE code during CNPJ lookup:', e);
        }
    }

    return result;
}
