import prisma from '../lib/prisma.js';
import { validateSelectedCity } from './selectedCity.js';

/** All three fields are selected or supplied by a Hub together, never combined across sources. */
export async function selectedManifestCity(data: Record<string, any>, prefix: 'origin' | 'destination' | 'dest', hubId?: string | null) {
    const cityKey = prefix === 'dest' ? 'destCity' : `${prefix}City`;
    const stateKey = prefix === 'dest' ? 'destState' : `${prefix}State`;
    const codeKey = `${cityKey}IbgeCode`;
    let input = { city: data[cityKey], state: data[stateKey], cityIbgeCode: data[codeKey] };
    if (!input.city && !input.state && !input.cityIbgeCode && hubId) {
        const hub = await prisma.hub.findUnique({ where: { id: hubId } });
        if (hub) input = { city: hub.city, state: hub.state, cityIbgeCode: hub.cityIbgeCode };
    }
    const selected = await validateSelectedCity(input, prefix === 'origin' ? 'Origem' : 'Destino');
    return { [cityKey]: selected.city, [stateKey]: selected.state, [codeKey]: selected.cityIbgeCode,
        ...(prefix !== 'dest' ? { [prefix]: `${selected.city}, ${selected.state}` } : {}),
    };
}
