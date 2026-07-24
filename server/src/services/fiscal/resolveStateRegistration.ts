import prisma from '../../lib/prisma.js';
import { consultCNPJ } from '../cnpjService.js';

export interface ResolveStateRegistrationDeps {
    findPersonStateRegistration: (document: string) => Promise<string | null | undefined>;
    consultCNPJ: typeof consultCNPJ;
}

export const defaultResolveStateRegistrationDeps: ResolveStateRegistrationDeps = {
    findPersonStateRegistration: async (document: string) => {
        const person = await prisma.person.findUnique({ where: { document }, select: { stateRegistration: true } });
        return person?.stateRegistration;
    },
    consultCNPJ,
};

/**
 * Resolve a IE (stateRegistration) de um CNPJ pela fonte mais barata disponível, nessa ordem:
 * 1. `Person.stateRegistration` já gravado (CNPJ já resolvido antes) — custo zero.
 * 2. IE já extraída de um XML de NF-e (`nfeXmlParser.ts`) — já paga como parte da sincronização
 *    de Distribuição NF-e via ACBr, custo zero usar de novo.
 * 3. Sintegra (`cnpjService.ts`, via `SINTEGRA_TOKEN`) — cobra crédito por consulta, só chamado
 *    quando as duas fontes gratuitas acima não resolveram.
 *
 * CPF (pessoa física) não tem IE no sentido usual — Sintegra não é consultado nesse caso.
 */
export async function resolveStateRegistration(
    document: string,
    xmlIe?: string | null,
    deps: ResolveStateRegistrationDeps = defaultResolveStateRegistrationDeps,
): Promise<string | undefined> {
    const cleanDocument = document.replace(/\D/g, '');
    if (!cleanDocument) return undefined;

    const existing = await deps.findPersonStateRegistration(cleanDocument);
    if (existing) return existing;

    if (xmlIe && xmlIe.trim()) return xmlIe.trim();

    if (cleanDocument.length !== 14) return undefined;

    const sintegraToken = process.env.SINTEGRA_TOKEN;
    if (!sintegraToken) return undefined;

    try {
        const cnpjData = await deps.consultCNPJ(cleanDocument, sintegraToken);
        return cnpjData.stateRegistration;
    } catch {
        return undefined;
    }
}
