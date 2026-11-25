import prisma from '../../../lib/prisma.js';
import { contactsFromFields, resolveLegacyDocument, type ContactCandidate } from './documents.js';
import { chunk, forEachLegacyBatch, text } from './source.js';
import type { PromotionContext, PromotionHandler, PromotionOutcome } from './types.js';

/**
 * Contatos (telefone e e-mail). As listagens de pessoas/clientes do legado NÃO trazem telefone nem
 * e-mail; as fontes que trazem são:
 * - `cotacoes`: e-mail, telefone e nome do contato que pediu a cotação, ligados ao documento do
 *   cliente da cotação (inferência: o contato da cotação é contato daquele cliente). As cotações mais
 *   recentes têm prioridade e cada documento guarda no máximo MAX_PER_DOC contatos;
 * - `vendedores`: e-mail do vendedor, ligado à pessoa pelo documento.
 * Destino: PersonContact (toda pessoa) e AccountContact (quando o documento é de uma conta cliente).
 * Contato que repete e-mail ou telefone de um já cadastrado não é criado de novo.
 */
const MAX_PER_DOC = 8;

const sameContact = (a: { email: string | null; phone: string | null }, b: ContactCandidate) =>
    (!!a.email && !!b.email && a.email.toLowerCase() === b.email) || (!!a.phone && !!b.phone && a.phone.replace(/\D/g, '') === b.phone);

/** Contatos novos de um documento: grava em PersonContact e AccountContact conforme existirem. */
async function saveContacts(ctx: PromotionContext, entity: string, byDoc: Map<string, ContactCandidate[]>, relation: string, legacyKeys: Map<string, string>): Promise<PromotionOutcome[]> {
    const outcomes: PromotionOutcome[] = [];
    for (const docs of chunk([...byDoc.keys()], 300)) {
        const persons = await prisma.person.findMany({ where: { document: { in: docs } }, select: { id: true, document: true, contacts: { select: { email: true, phone: true } } } });
        const companies = await prisma.accountCompany.findMany({ where: { cnpj: { in: docs } }, select: { cnpj: true, accountId: true, account: { select: { contacts: { select: { email: true, phone: true } } } } } });
        const personByDoc = new Map(persons.map((p) => [p.document, p]));
        const companyByDoc = new Map(companies.map((c) => [c.cnpj, c]));
        const personRows: Array<{ personId: string; name: string; email: string | null; phone: string | null; relation: string }> = [];
        const accountRows: Array<{ accountId: string; name: string; email: string | null; phone: string | null; isPrimary: boolean }> = [];
        const accountSeen = new Map<string, Array<{ email: string | null; phone: string | null }>>();

        for (const doc of docs) {
            const candidates = byDoc.get(doc) ?? [];
            const person = personByDoc.get(doc);
            const company = companyByDoc.get(doc);
            const key = legacyKeys.get(doc) ?? '';
            if (!person && !company) {
                const planned = ctx.dryRun && (ctx.plannedPersons.has(doc) || ctx.plannedAccounts.has(doc));
                outcomes.push({ entity, legacyKey: key, key: doc, result: planned ? 'created' : 'rejected', detail: planned ? `${candidates.length} contato(s) (pessoa ainda será criada nesta promoção)` : 'documento sem pessoa nem conta no TSM (promova pessoas e clientes antes)' });
                continue;
            }
            let added = 0;
            if (person) {
                const known = [...person.contacts];
                for (const c of candidates) {
                    if (known.some((k) => sameContact(k, c))) continue;
                    known.push(c); added++;
                    personRows.push({ personId: person.id, name: c.name, email: c.email, phone: c.phone, relation });
                }
            }
            if (company) {
                const known = accountSeen.get(company.accountId) ?? [...company.account.contacts];
                accountSeen.set(company.accountId, known);
                for (const c of candidates) {
                    if (known.some((k) => sameContact(k, c))) continue;
                    accountRows.push({ accountId: company.accountId, name: c.name, email: c.email, phone: c.phone, isPrimary: known.length === 0 });
                    known.push(c); added++;
                }
            }
            outcomes.push({ entity, legacyKey: key, key: doc, result: added ? 'created' : 'unchanged', detail: added ? `${added} contato(s) novo(s)` : undefined });
        }
        if (!ctx.dryRun && (personRows.length || accountRows.length)) {
            await prisma.$transaction([prisma.personContact.createMany({ data: personRows }), prisma.accountContact.createMany({ data: accountRows })]);
        }
    }
    return outcomes;
}

export const promoteQuoteContacts: PromotionHandler = async (ctx) => {
    // documento → contatos, das cotações mais recentes para as mais antigas
    const quotes: Array<{ doc: string; at: string; legacyKey: string; contacts: ContactCandidate[] }> = [];
    let withoutContact = 0;
    const invalid: PromotionOutcome[] = [];
    await forEachLegacyBatch('cotacoes', 2000, async (rows) => {
        for (const r of rows) {
            const doc = resolveLegacyDocument(r.data.cliente);
            const contacts = contactsFromFields(r.data.contato, r.data.email, r.data.fone, 'Contato da cotação');
            if (!contacts.length) { withoutContact++; continue; }
            if (!doc) { invalid.push({ entity: 'contatos', legacyKey: r.legacyKey, key: '', result: 'rejected', detail: 'cliente da cotação com CPF/CNPJ inválido' }); continue; }
            quotes.push({ doc: doc.document, at: text(r.data, 'data') || text(r.data, 'dtcota'), legacyKey: r.legacyKey, contacts });
        }
    });
    quotes.sort((a, b) => b.at.localeCompare(a.at));
    const byDoc = new Map<string, ContactCandidate[]>();
    const legacyKeys = new Map<string, string>();
    for (const q of quotes) {
        const list = byDoc.get(q.doc) ?? [];
        for (const c of q.contacts) if (list.length < MAX_PER_DOC && !list.some((k) => sameContact(k, c))) list.push(c);
        byDoc.set(q.doc, list);
        if (!legacyKeys.has(q.doc)) legacyKeys.set(q.doc, q.legacyKey);
    }
    ctx.log(`contatos: ${quotes.length} cotações com contato, ${withoutContact} sem contato, ${byDoc.size} documentos`);
    return [...invalid, ...(await saveContacts(ctx, 'contatos', byDoc, 'Contato de cotação (legado)', legacyKeys))];
};

export const promoteSellerEmails: PromotionHandler = async (ctx) => {
    const byDoc = new Map<string, ContactCandidate[]>();
    const legacyKeys = new Map<string, string>();
    const outcomes: PromotionOutcome[] = [];
    await forEachLegacyBatch('vendedores', 500, async (rows) => {
        for (const r of rows) {
            const doc = resolveLegacyDocument(r.data.pessoa);
            const contacts = contactsFromFields(r.data.nome || r.data.apelido, r.data.email, '', 'Vendedor');
            if (!doc) { outcomes.push({ entity: 'vendedores', legacyKey: r.legacyKey, key: '', result: 'rejected', detail: 'vendedor sem CPF/CNPJ válido' }); continue; }
            if (!contacts.length) { outcomes.push({ entity: 'vendedores', legacyKey: r.legacyKey, key: doc.document, result: 'rejected', detail: 'vendedor sem e-mail no legado' }); continue; }
            byDoc.set(doc.document, [...(byDoc.get(doc.document) ?? []), ...contacts]);
            legacyKeys.set(doc.document, r.legacyKey);
        }
    });
    return [...outcomes, ...(await saveContacts(ctx, 'vendedores', byDoc, 'Vendedor (legado)', legacyKeys))];
};
