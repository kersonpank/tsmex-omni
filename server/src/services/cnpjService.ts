import axios from 'axios';
import { AppError } from '../middleware/errorHandler.js';

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
}

// Consulta ReceitaWS (gratuita)
async function consultReceitaWS(cnpj: string): Promise<CNPJData | null> {
    try {
        const cleanCNPJ = cnpj.replace(/\D/g, '');
        
        const response = await axios.get(`https://www.receitaws.com.br/v1/cnpj/${cleanCNPJ}`, {
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
            }
        });

        if (response.data.status === 'ERROR') {
            return null;
        }

        const data = response.data;

        return {
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
        };
    } catch (error: any) {
        if (error.response?.status === 429) {
            throw new AppError('Rate limit exceeded. Please try again later.', 429);
        }
        if (error.response?.status === 404) {
            return null;
        }
        console.error('ReceitaWS error:', error.message);
        return null;
    }
}

// Consulta SintegraWS (requer token)
async function consultSintegraWS(cnpj: string, token?: string): Promise<CNPJData | null> {
    if (!token) {
        return null; // SintegraWS requires token
    }

    try {
        const cleanCNPJ = cnpj.replace(/\D/g, '');
        
        const response = await axios.get('https://www.sintegraws.com.br/api/v1/execute-api.php', {
            params: {
                token: token,
                cnpj: cleanCNPJ,
                plugin: 'RF', // Receita Federal plugin
            },
            timeout: 10000,
        });

        if (response.data.status === 'ERROR' || !response.data.dados) {
            return null;
        }

        const data = response.data.dados;

        return {
            cnpj: cleanCNPJ,
            legalName: data.razao_social || data.nome || '',
            tradeName: data.nome_fantasia || undefined,
            situation: data.situacao_cadastral,
            situationDate: data.data_situacao_cadastral,
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
            cnae: data.cnae_principal?.codigo,
            cnaeDescription: data.cnae_principal?.descricao,
            openingDate: data.data_inicio_atividade,
            legalNature: data.natureza_juridica,
            capital: data.capital_social ? parseFloat(String(data.capital_social)) : undefined,
            size: data.porte,
            source: 'sintegra',
        };
    } catch (error: any) {
        console.error('SintegraWS error:', error.message);
        return null;
    }
}

// Main function: tries ReceitaWS first, then SintegraWS if available
export async function consultCNPJ(cnpj: string, sintegraToken?: string): Promise<CNPJData> {
    const cleanCNPJ = cnpj.replace(/\D/g, '');

    if (cleanCNPJ.length !== 14) {
        throw new AppError('CNPJ must have 14 digits', 400);
    }

    // Try ReceitaWS first (free)
    let result = await consultReceitaWS(cleanCNPJ);

    // If ReceitaWS failed or returned incomplete data, try SintegraWS
    if ((!result || !result.legalName) && sintegraToken) {
        result = await consultSintegraWS(cleanCNPJ, sintegraToken);
    }

    if (!result || !result.legalName) {
        throw new AppError('CNPJ not found or invalid', 404);
    }

    return result;
}
