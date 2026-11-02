import { cleanIe } from '../acbr/acbrCteMapper.js';

type Emitter = {
    stateRegistration?: string | null; address?: string | null; number?: string | null;
    neighborhood?: string | null; city?: string | null; cityIbgeCode?: string | null;
    state?: string | null; cep?: string | null;
};

export function missingMdfeEmitterData(person: Emitter): string[] {
    const fields: [string, boolean][] = [
        ['IE', !!cleanIe(person.stateRegistration)],
        ['logradouro', !!person.address?.trim()], ['número', !!person.number?.trim()],
        ['bairro', !!person.neighborhood?.trim()], ['cidade', !!person.city?.trim()],
        ['código IBGE', /^\d{7}$/.test(person.cityIbgeCode ?? '')],
        ['UF', /^[A-Z]{2}$/.test(person.state ?? '')], ['CEP', /^\d{8}$/.test((person.cep ?? '').replace(/\D/g, ''))],
    ];
    return fields.filter(([, valid]) => !valid).map(([label]) => label);
}

export function cteEmitterMismatchMessage(orderNumber: string | number, key: string | null, emitterDocument: string): string | null {
    if (!/^\d{44}$/.test(key ?? '')) return null;
    const cnpj = key!.slice(6, 20);
    if (cnpj === emitterDocument.replace(/\D/g, '')) return null;
    return `O CT-e do pedido ${orderNumber} foi emitido por outro CNPJ (${cnpj}). O MDF-e precisa do mesmo emitente.`;
}
