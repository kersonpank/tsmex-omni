import axios from 'axios';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export const normalizeCityName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');

/** Validate the selected identifier, never infer one from a city name. */
export async function validateSelectedCity(input: {
    city?: string | null; state?: string | null; cityIbgeCode?: string | null;
}, label = 'Cidade') {
    if (!input.cityIbgeCode || !/^\d{7}$/.test(input.cityIbgeCode)) {
        throw new AppError(`${label}: selecione uma sugestão da busca ou consulte um CEP válido.`, 400);
    }
    const selected = await prisma.city.findUnique({ where: { ibgeCode: input.cityIbgeCode }, include: { state: true } });
    if (!selected || !input.city || !input.state
        || normalizeCityName(selected.name) !== normalizeCityName(input.city)
        || selected.state.code !== input.state.toUpperCase()) {
        throw new AppError(`${label}: cidade, UF e código IBGE não correspondem. Selecione a cidade novamente.`, 400);
    }
    return { city: selected.name, state: selected.state.code, cityIbgeCode: selected.ibgeCode };
}

export async function requireSelectedIbge(city: string | null | undefined, state: string | null | undefined, cityIbgeCode?: string | null): Promise<string> {
    return (await validateSelectedCity({ city, state, cityIbgeCode })).cityIbgeCode;
}

/**
 * IBGE oficial de um CEP fora do cache, pelo ViaCEP (que já devolve o código IBGE).
 * `null` = não foi possível confirmar agora (rede, CEP inexistente): quem chama decide.
 * Objeto mutável para os testes substituírem a consulta externa.
 */
export const cepIbgeLookup = {
    async lookup(cep: string): Promise<string | null> {
        try {
            const response = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 5000 });
            const ibge = response.data?.erro ? null : String(response.data?.ibge ?? '');
            return ibge && /^\d{7}$/.test(ibge) ? ibge : null;
        } catch {
            return null;
        }
    },
};

/**
 * O CEP confirma a seleção: com cache local ou consulta ao ViaCEP. Divergência nunca é gravada.
 * Se o CEP não puder ser confirmado agora, vale só a seleção coerente (IBGE + nome + UF),
 * nunca uma cidade inferida pelo nome.
 */
export async function validateSelectedAddress<T extends { city: string; state: string; cityIbgeCode?: string; cep: string }>(address: T): Promise<T> {
    const city = await validateSelectedCity(address);
    const cep = address.cep.replace(/\D/g, '');
    if (!/^\d{8}$/.test(cep)) throw new AppError('CEP deve conter 8 dígitos.', 400);
    const cached = await prisma.cEP.findUnique({ where: { cep }, include: { city: true } });
    const cepIbge = cached?.city?.ibgeCode ?? await cepIbgeLookup.lookup(cep);
    if (cepIbge && cepIbge !== city.cityIbgeCode) {
        throw new AppError('A cidade selecionada não corresponde ao CEP. Consulte o CEP novamente.', 400);
    }
    return { ...address, ...city, cep };
}
