import { AppError } from '../../middleware/errorHandler.js';
import { manifestRouteCities } from '../manifestAnttSuggestion.js';
import { digits } from './efreteUtil.js';

/**
 * CEPs de origem e destino da viagem do CIOT (eFrete v8.2: Viagens[].CepOrigem / CepDestino,
 * AP19/AP20, pág. 15; pág. 6: se enviar CEP na origem, enviar também no destino).
 *
 * Quando origem e destino têm o mesmo código IBGE (entrega dentro do município do hub) a eFrete
 * exige CEP (ou latitude/longitude) para calcular distância e piso: nesse caso a falta de CEP
 * bloqueia ANTES de enfileirar, com mensagem clara.
 */

interface CepPerson {
    cep?: string | null;
    cityIbgeCode?: string | null;
}

export interface CiotRouteCepsInput {
    manifest: Parameters<typeof manifestRouteCities>[0] & {
        hub?: ({ person?: CepPerson | null } & Record<string, unknown>) | null;
        legs?: Array<{ order?: {
            fimIbgeCode?: string | null;
            destinatarioPerson?: CepPerson | null;
        } | null }>;
    };
    /** Pessoa do emitente fiscal da viagem (fallback para o endereço de origem). */
    emitterPerson?: CepPerson | null;
    /** Destinatário digitado na Carta Frete do CIOT. */
    destinatario?: { endereco?: { cep?: string | null; codigoMunicipio?: number | string | null } | null } | null;
}

const validCep = (value: string | null | undefined) => {
    const cep = digits(value);
    return cep.length === 8 ? cep : null;
};

/** O CEP só vale para a cidade da viagem se a pessoa não declarar outro município. */
function cepOfPersonInCity(person: CepPerson | null | undefined, ibge: string | null | undefined): string | null {
    const cep = validCep(person?.cep);
    if (!cep) return null;
    if (person?.cityIbgeCode && ibge && person.cityIbgeCode !== ibge) return null;
    return cep;
}

export function resolveCiotRouteCeps(input: CiotRouteCepsInput): { cepOrigem?: string; cepDestino?: string } {
    const { origin, destination } = manifestRouteCities(input.manifest);
    const sameMunicipality = Boolean(origin.ibge) && origin.ibge === destination.ibge;

    const cepOrigem = cepOfPersonInCity(input.manifest.hub?.person, origin.ibge)
        ?? cepOfPersonInCity(input.emitterPerson, origin.ibge);

    let cepDestino: string | null = null;
    for (const leg of input.manifest.legs ?? []) {
        const order = leg.order;
        const person = order?.destinatarioPerson;
        const deliversHere = (order?.fimIbgeCode ?? person?.cityIbgeCode) === destination.ibge;
        if (deliversHere) {
            cepDestino = validCep(person?.cep);
            if (cepDestino) break;
        }
    }
    const typed = input.destinatario?.endereco;
    if (!cepDestino && typed && String(typed.codigoMunicipio ?? '') === destination.ibge) {
        cepDestino = validCep(typed.cep);
    }

    if (sameMunicipality && (!cepOrigem || !cepDestino)) {
        const missing = [!cepOrigem ? 'de origem (endereço do hub ou do emitente fiscal)' : null, !cepDestino ? 'de destino (endereço do destinatário)' : null]
            .filter(Boolean).join(' e ');
        throw new AppError(
            `Origem e destino estão no mesmo município (${origin.city ?? ''}${origin.state ? `/${origin.state}` : ''}): a eFrete exige o CEP ${missing} para calcular a distância. Complete o CEP e tente de novo.`,
            400,
        );
    }
    // Manual v8.2 pág. 6: o mesmo tipo de dado na origem e no destino; CEP sozinho é recusado pela ANTT.
    if (!cepOrigem || !cepDestino) return {};
    return { cepOrigem, cepDestino };
}
