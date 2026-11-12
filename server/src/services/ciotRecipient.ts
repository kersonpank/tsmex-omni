import { prisma } from '../lib/prisma.js';

/**
 * Destinatário sugerido do CIOT, já resolvido no servidor.
 * TRANSFERÊNCIA: a carga vai para uma unidade nossa — hub de destino (Pessoa do hub, ou o nome do hub
 * com o documento do emitente fiscal quando o hub não tem Pessoa). ENTREGA: destinatário do pedido
 * de maior peso. `missing` lista o que o operador ainda precisa completar.
 */

type PersonLike = {
    legalName?: string | null; document?: string | null; cep?: string | null; address?: string | null; number?: string | null;
    complement?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null; cityIbgeCode?: string | null;
};

export type CiotRecipientInput = {
    tripType: string;
    destHub: { name: string; address?: string | null; city?: string | null; state?: string | null; cityIbgeCode?: string | null; person?: PersonLike | null } | null;
    emitterPerson: { document?: string | null; legalName?: string | null } | null;
    orders: Array<{ weight: number; destinatarioPerson: PersonLike | null }>;
};

export type CiotRecipientField = 'name' | 'document' | 'cep' | 'address' | 'neighborhood' | 'city' | 'state' | 'cityIbgeCode';

export type CiotRecipientSuggestion = {
    source: 'HUB_PERSON' | 'HUB_EMITTER' | 'ORDER';
    name: string; document: string; cep: string; address: string; number: string; complement: string;
    neighborhood: string; city: string; state: string; cityIbgeCode: string;
    missing: CiotRecipientField[];
    otherCount: number;
    note: string | null;
};

const text = (value: string | null | undefined) => (value ?? '').trim();
const digits = (value: string | null | undefined) => text(value).replace(/\D/g, '');

type Base = Omit<CiotRecipientSuggestion, 'source' | 'missing' | 'otherCount' | 'note'>;

function finish(source: CiotRecipientSuggestion['source'], base: Base, extra: { otherCount?: number; note?: string | null } = {}): CiotRecipientSuggestion {
    const missing: CiotRecipientField[] = [];
    if (!base.name) missing.push('name');
    if (digits(base.document).length < 11) missing.push('document');
    if (digits(base.cep).length !== 8) missing.push('cep');
    if (!base.address) missing.push('address');
    if (!base.neighborhood) missing.push('neighborhood');
    if (!base.city) missing.push('city');
    if (!base.state) missing.push('state');
    if (!base.cityIbgeCode) missing.push('cityIbgeCode');
    return { source, ...base, missing, otherCount: extra.otherCount ?? 0, note: extra.note ?? null };
}

const fromPerson = (person: PersonLike): Base => ({
    name: text(person.legalName), document: digits(person.document), cep: digits(person.cep), address: text(person.address),
    number: text(person.number), complement: text(person.complement), neighborhood: text(person.neighborhood),
    city: text(person.city), state: text(person.state), cityIbgeCode: text(person.cityIbgeCode),
});

export function buildCiotRecipient(input: CiotRecipientInput): CiotRecipientSuggestion | null {
    const { destHub } = input;
    if (input.tripType !== 'DELIVERY' && destHub) {
        const hub = { address: text(destHub.address), city: text(destHub.city), state: text(destHub.state), cityIbgeCode: text(destHub.cityIbgeCode) };
        if (destHub.person) {
            const p = fromPerson(destHub.person);
            return finish('HUB_PERSON', {
                ...p, name: p.name || text(destHub.name), address: p.address || hub.address, city: p.city || hub.city,
                state: p.state || hub.state, cityIbgeCode: p.cityIbgeCode || hub.cityIbgeCode,
            });
        }
        return finish('HUB_EMITTER', {
            name: text(destHub.name), document: digits(input.emitterPerson?.document), cep: '', number: '', complement: '', neighborhood: '', ...hub,
        }, { note: 'A carga vai para uma unidade da própria operação: o documento é o do emitente fiscal da viagem.' });
    }
    const candidates = input.orders.filter((order) => order.destinatarioPerson);
    if (!candidates.length) return null;
    const best = candidates.reduce((top, order) => (order.weight > top.weight ? order : top));
    const otherCount = candidates.filter((order) => order.destinatarioPerson!.document !== best.destinatarioPerson!.document).length;
    return finish('ORDER', fromPerson(best.destinatarioPerson!), {
        otherCount,
        note: otherCount > 0 ? `Destinatário do pedido mais pesado; há ${otherCount} outro(s) destinatário(s) nesta viagem.` : null,
    });
}

export async function suggestCiotRecipient(manifestId: string): Promise<CiotRecipientSuggestion | null> {
    const orderSelect = { id: true, demand: { select: { weight: true } }, destinatarioPerson: true } as const;
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        select: {
            tripType: true,
            destHub: { select: { name: true, address: true, city: true, state: true, cityIbgeCode: true, person: true } },
            fiscalEmitter: { select: { person: { select: { document: true, legalName: true } } } },
            legs: { select: { order: { select: orderSelect } } },
            orders: { select: orderSelect },
        },
    });
    if (!manifest) return null;
    const byId = new Map<string, (typeof manifest.orders)[number]>();
    for (const order of [...manifest.legs.map((leg) => leg.order), ...manifest.orders]) if (order) byId.set(order.id, order);
    const orders = [...byId.values()].map((order) => ({ weight: order.demand?.weight ?? 0, destinatarioPerson: order.destinatarioPerson }));
    return buildCiotRecipient({ tripType: manifest.tripType, destHub: manifest.destHub, emitterPerson: manifest.fiscalEmitter?.person ?? null, orders });
}
