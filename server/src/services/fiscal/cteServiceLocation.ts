import type { CtePerson, CteServiceLocation } from '../cteService.js';

function comparable(value: string | null | undefined): string {
    return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

function parseLocation(value: string | null | undefined): CteServiceLocation | null {
    const match = value?.trim().match(/^(.*?)[,\-]\s*([a-zA-Z]{2})$/);
    if (!match || !match[1].trim()) return null;
    return { city: match[1].trim(), state: match[2].toUpperCase() };
}

/**
 * O cálculo pode sobrescrever a localidade do pedido. Um IBGE só acompanha o campo de
 * onde realmente veio; não reutilizar o código do pedido para outra cidade digitada.
 */
export function resolveCteServiceLocation(params: {
    calculationCity?: string | null;
    orderCity?: string | null;
    orderIbgeCode?: string | null;
    person?: CtePerson | null;
    allowPersonFallback?: boolean;
}): CteServiceLocation | null {
    const { person } = params;
    const orderLocation = parseLocation(params.orderCity);
    const selected = params.calculationCity?.trim() || params.orderCity?.trim() || '';
    let location = parseLocation(selected);

    if (!location && selected && orderLocation && comparable(selected) === comparable(orderLocation.city)) {
        location = orderLocation;
    }
    if (!location && selected && person?.city && person.state && comparable(selected) === comparable(person.city)) {
        location = { city: person.city.trim(), state: person.state.trim().toUpperCase() };
    }
    if (!location && !selected && params.allowPersonFallback !== false && person?.city && person.state) {
        location = { city: person.city.trim(), state: person.state.trim().toUpperCase() };
    }
    if (!location || !location.city || !/^[A-Z]{2}$/.test(location.state)) return null;

    const matchesOrder = orderLocation && comparable(location.city) === comparable(orderLocation.city)
        && location.state === orderLocation.state;
    const matchesPerson = person?.city && person.state && comparable(location.city) === comparable(person.city)
        && location.state === person.state.trim().toUpperCase();
    const ibgeCode = (matchesOrder ? params.orderIbgeCode : null) || (matchesPerson ? person?.cityIbgeCode : null) || null;
    return { ...location, ibgeCode };
}
