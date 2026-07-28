import type { Client, Person } from '@prisma/client';
import prisma from '../../lib/prisma.js';

export type FreightTerm = 'CIF' | 'FOB' | 'REDESPACHO';

export interface ResolvePayerClientInput {
    freightTerm: FreightTerm;
    remetentePersonId?: string | null;
    destinatarioPersonId?: string | null;
    consignatarioPersonId?: string | null;
}

export interface ResolvedPayerClient {
    payerPersonId: string | null;
    person: Person | null;
    client: Client | null;
}

/**
 * Determina quem paga o frete (e portanto qual `Client` associar ao pedido/demanda) a partir do
 * `freightTerm`: CIF → remetente paga, FOB → destinatário paga, REDESPACHO → consignatário paga
 * (sem consignatário informado, usa o destinatário como proxy — mesma regra já aplicada em
 * `orders.ts` antes desta extração).
 *
 * Retorna `client: null` sempre que a pessoa pagadora não existir ou não estiver cadastrada como
 * Client — quem chama decide se isso bloqueia (ex.: `orders.ts` POST /entrada, fluxo manual) ou
 * não (ex.: `confirmIntakeArrival.ts`, onde o cliente nunca é pré-requisito).
 */
export async function resolvePayerClient(input: ResolvePayerClientInput): Promise<ResolvedPayerClient> {
    const payerPersonId = input.freightTerm === 'CIF'
        ? input.remetentePersonId ?? null
        : input.freightTerm === 'FOB'
            ? input.destinatarioPersonId ?? null
            : (input.consignatarioPersonId ?? input.destinatarioPersonId ?? null);

    if (!payerPersonId) {
        return { payerPersonId: null, person: null, client: null };
    }

    const payerPerson = await prisma.person.findUnique({
        where: { id: payerPersonId },
        include: { clients: { take: 1 } },
    });

    if (!payerPerson) {
        return { payerPersonId, person: null, client: null };
    }

    const { clients, ...person } = payerPerson;
    return { payerPersonId, person: person as Person, client: clients?.[0] ?? null };
}
