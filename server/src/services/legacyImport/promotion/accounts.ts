import { randomUUID } from 'node:crypto';
import prisma from '../../../lib/prisma.js';
import { paddedDocumentDigits, resolveLegacyDocument, type ResolvedDocument } from './documents.js';
import { chunk, loadLegacyRows, text } from './source.js';
import type { LegacySourceRow, PromotionHandler, PromotionOutcome } from './types.js';

/**
 * Clientes do legado → Account + AccountCompany (CNPJ/CPF).
 * - Um código de cliente do legado é UMA conta; cada CNPJ/CPF daquele código vira um AccountCompany
 *   (o cliente com várias unidades usa a chave codigo+documento).
 * - Identidade pelo documento: AccountCompany já existente nunca é tocado; documento novo de um código
 *   cuja conta já existe entra nessa conta. Documento inválido é recusado com o motivo.
 * - A conta nasce com as tags `legado`, `legado:cliente:<código>` e, se aplicável, a situação do
 *   legado (bloqueado/devedor/recusado, não liberado) — o TSM não tem campo de situação de crédito.
 */
const GROUP_CHUNK = 300;

interface Unit {
    row: LegacySourceRow;
    doc: ResolvedDocument;
    name: string;
    city: string | null;
    state: string | null;
}

function statusTags(d: Record<string, unknown>): string[] {
    const tags: string[] = [];
    const situacao = text(d, 'situacao');
    if (situacao && situacao.toUpperCase() !== 'OK') tags.push(`legado:situacao:${situacao.toLowerCase().replace(/\s+/g, '-')}`);
    if (text(d, 'liberado').toUpperCase() === 'N') tags.push('legado:nao-liberado');
    return tags;
}

export const promoteClients: PromotionHandler = async (ctx) => {
    const outcomes: PromotionOutcome[] = [];
    const reject = (row: LegacySourceRow, key: string, detail: string) => outcomes.push({ entity: 'clientes', legacyKey: row.legacyKey, key, result: 'rejected', detail });

    const groups = new Map<string, { rows: LegacySourceRow[] }>();
    for (const row of await loadLegacyRows('clientes')) {
        const code = text(row.data, 'codigo');
        if (!code) { reject(row, '', 'cliente sem código no legado'); continue; }
        (groups.get(code) ?? groups.set(code, { rows: [] }).get(code)!).rows.push(row);
    }

    for (const batch of chunk([...groups.entries()], GROUP_CHUNK)) {
        const units = new Map<string, Unit[]>();
        for (const [code, { rows }] of batch) {
            for (const row of rows) {
                const doc = resolveLegacyDocument(row.data.documento, row.data.tipodoc);
                if (!doc) { reject(row, paddedDocumentDigits(row.data.documento, row.data.tipodoc), 'CPF/CNPJ ausente ou com dígito verificador inválido'); continue; }
                const list = units.get(code) ?? [];
                if (list.some((u) => u.doc.document === doc.document)) continue;
                list.push({ row, doc, name: text(row.data, 'nome'), city: text(row.data, 'cidade') || null, state: /^[A-Za-z]{2}$/.test(text(row.data, 'uf')) ? text(row.data, 'uf').toUpperCase() : null });
                units.set(code, list);
            }
        }
        const docs = [...units.values()].flat().map((u) => u.doc.document);
        const existing = new Map((await prisma.accountCompany.findMany({ where: { cnpj: { in: docs } }, select: { cnpj: true, accountId: true } })).map((c) => [c.cnpj, c.accountId]));
        const persons = new Map((await prisma.person.findMany({ where: { document: { in: docs } }, select: { document: true, legalName: true, tradeName: true } })).map((p) => [p.document, p]));

        const accounts: Array<{ id: string; name: string; accountType: 'COMPANY' | 'INDIVIDUAL'; tags: string[] }> = [];
        const companies: Array<{ accountId: string; cnpj: string; legalName: string; tradeName: string | null; city: string | null; state: string | null; isPrimary: boolean }> = [];

        for (const [code, list] of units) {
            // Matriz (filial 0001) primeiro e depois por documento: a empresa principal não depende da ordem do banco.
            list.sort((a, b) => Number(b.doc.document.slice(8, 12) === '0001') - Number(a.doc.document.slice(8, 12) === '0001') || a.doc.document.localeCompare(b.doc.document));
            let accountId = list.map((u) => existing.get(u.doc.document)).find(Boolean) ?? null;
            const accountExisted = accountId !== null;
            let added = 0;
            for (const unit of list) {
                const key = unit.doc.document;
                const person = persons.get(key);
                const legalName = unit.name && !/^\d+$/.test(unit.name) ? unit.name : person?.legalName ?? '';
                if (existing.has(key)) { outcomes.push({ entity: 'clientes', legacyKey: unit.row.legacyKey, key, result: 'unchanged' }); continue; }
                if (!legalName) { reject(unit.row, key, 'cliente sem nome no legado e sem pessoa no TSM'); continue; }
                if (!accountId) {
                    accountId = randomUUID();
                    accounts.push({
                        id: accountId,
                        name: legalName,
                        accountType: list.some((u) => u.doc.kind === 'CNPJ') ? 'COMPANY' : 'INDIVIDUAL',
                        tags: ['legado', `legado:cliente:${code}`, ...statusTags(unit.row.data)],
                    });
                }
                companies.push({ accountId, cnpj: key, legalName, tradeName: person?.tradeName ?? null, city: unit.city, state: unit.state, isPrimary: !accountExisted && added === 0 });
                added++;
                ctx.plannedAccounts.add(key);
                outcomes.push({
                    entity: 'clientes', legacyKey: unit.row.legacyKey, key,
                    result: accountExisted ? 'updated' : 'created',
                    detail: accountExisted ? 'documento adicional ligado à conta já existente do mesmo cliente' : added > 1 ? 'unidade adicional da mesma conta' : undefined,
                });
            }
        }
        if (!ctx.dryRun && (accounts.length || companies.length)) {
            await prisma.$transaction([
                prisma.account.createMany({ data: accounts }),
                prisma.accountCompany.createMany({ data: companies, skipDuplicates: true }),
            ]);
        }
        ctx.log(`clientes: ${outcomes.length} linhas`);
    }
    return outcomes;
};
