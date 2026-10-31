import type { Person } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { fetchPublicCnpj } from '../intake/publicCnpjParty.js';
import { resolveNfeCity } from '../intake/ensureNfePartyPersons.js';
import { getEfreteEnvironment, normalizeEfreteEnvironment, resolveMatrizCnpj } from './efreteConfig.js';

export function integratorPersonReady(person: Partial<Person> | null | undefined): boolean {
    return Boolean(person?.legalName?.trim() && person.address?.trim() && person.number?.trim()
        && person.neighborhood?.trim() && /^\d{8}$/.test((person.cep ?? '').replace(/\D/g, ''))
        && person.city?.trim() && person.state?.trim() && /^\d{7}$/.test(person.cityIbgeCode ?? ''));
}

export interface IntegratorPersonDeps {
    person: Pick<typeof prisma.person, 'findFirst' | 'upsert' | 'update'>;
    lookup: typeof fetchPublicCnpj;
    resolveCity: typeof resolveNfeCity;
}

/** Homologação: recupera o cadastro público sem pedir ao operador dados do integrador. */
export async function ensureEfreteIntegratorPerson(
    env: string = getEfreteEnvironment(),
    deps: IntegratorPersonDeps = { person: prisma.person, lookup: fetchPublicCnpj, resolveCity: resolveNfeCity },
): Promise<Person | null> {
    if (normalizeEfreteEnvironment(env) !== 'homologacao') return null;
    const document = resolveMatrizCnpj('', env);
    if (!document) return null;
    const formatted = document.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const existing = await deps.person.findFirst({ where: { document: { in: [document, formatted] } } });
    if (integratorPersonReady(existing)) return existing;
    try {
        const data = await deps.lookup(document);
        if (!data) throw new Error('CNPJ indisponível');
        const city = await deps.resolveCity({ municipio: data.city, uf: data.uf, ibge: data.ibge });
        if (!city) throw new Error('Município indisponível');
        // Endereço público é preenchido como um conjunto, evitando misturar municípios.
        const address = {
            legalName: existing?.legalName?.trim() || data.legalName,
            address: data.street, number: data.number, complement: data.complement,
            neighborhood: data.neighborhood, cep: data.cep?.replace(/\D/g, ''),
            city: city.name, state: city.state, cityIbgeCode: city.ibgeCode,
        };
        if (!integratorPersonReady(address)) throw new Error('Cadastro público incompleto');
        const person = existing
            ? await deps.person.update({ where: { id: existing.id }, data: address })
            : await deps.person.upsert({ where: { document }, update: {}, create: {
                document, documentType: 'CNPJ', country: 'BRASIL', ...address,
            } });
        if (!integratorPersonReady(person)) throw new Error('Cadastro incompleto');
        return person;
    } catch {
        throw new AppError(`Não foi possível cadastrar automaticamente o integrador e-Frete (CNPJ ${formatted}). Cadastre a pessoa em Gestão → Pessoas com endereço completo.`, 400);
    }
}
