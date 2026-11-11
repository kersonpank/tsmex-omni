import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Client, Person, Prisma } from '@prisma/client';
import { AppError } from '../../middleware/errorHandler.js';
import { findOrCreateConcluirCadastroColumn } from './concluirCadastroColumn.js';

type Db = Prisma.TransactionClient;

/** Marca na Account: criada automaticamente para faturar; o Comercial ainda precisa completar. */
export const CADASTRO_A_COMPLETAR_TAG = 'CADASTRO_A_COMPLETAR';
export const PLACEHOLDER_EMAIL_DOMAIN = 'comercial.tsmex.local';
const PLACEHOLDER_CONTACT = { name: 'A concluir pelo Comercial', phone: '00000000000' };

export interface ProvisionClientOptions {
    /** Credencial do usuário CLIENT. Placeholder = hash de segredo aleatório descartado + `active: false`. */
    user: { email: string; passwordHash: string; active: boolean };
    contact: { name: string; phone: string };
    tags?: string[];
    /** Cria o cartão "Concluir cadastro do cliente" no CRM (Comercial). */
    followUp?: boolean;
}

export interface ProvisionedClient {
    client: Client;
    userId: string | null;
    created: boolean;
    /** Cartão criado para o Comercial (só quando a conta nasceu agora e `followUp`). */
    opportunityId: string | null;
}

/**
 * Caminho único para "Pessoa vira Client com Account" (usado por `add-client`, `add-client-pending`
 * e pelo reparo de faturamento). CNPJ → conta COMPANY; CPF → conta INDIVIDUAL. O documento da
 * pessoa vai em `AccountCompany.cnpj` (campo único de documento da conta, mesmo para CPF).
 * Reaproveita Account/AccountCompany/User que já existam para o mesmo documento/e-mail.
 */
export async function provisionClientAccount(
    tx: Db,
    person: Person,
    existingClient: Client | null,
    opts: ProvisionClientOptions,
): Promise<ProvisionedClient> {
    const existingCompany = await tx.accountCompany.findUnique({ where: { cnpj: person.document } });
    let accountId: string;
    let companyId: string;
    let accountCreated = false;
    if (existingCompany) {
        accountId = existingCompany.accountId;
        companyId = existingCompany.id;
    } else {
        const account = await tx.account.create({
            data: {
                name: person.legalName,
                accountType: person.documentType === 'CPF' ? 'INDIVIDUAL' : 'COMPANY',
                tags: opts.tags ?? [],
                companies: {
                    create: {
                        cnpj: person.document,
                        legalName: person.legalName,
                        tradeName: person.tradeName ?? undefined,
                        address: person.address ?? undefined,
                        city: person.city ?? undefined,
                        state: person.state ?? undefined,
                        isPrimary: true,
                    },
                },
                contacts: { create: { name: opts.contact.name, phone: opts.contact.phone, isPrimary: true } },
            },
            include: { companies: { where: { isPrimary: true }, take: 1 } },
        });
        accountId = account.id;
        companyId = account.companies[0].id;
        accountCreated = true;
    }

    if (existingClient) {
        const client = await tx.client.update({
            where: { id: existingClient.id },
            data: { accountId, accountCompanyId: companyId },
        });
        return { client, userId: existingClient.userId ?? null, created: accountCreated, opportunityId: null };
    }

    const existingUser = await tx.user.findUnique({ where: { email: opts.user.email } });
    const user = existingUser
        ?? (await tx.user.create({
            data: {
                email: opts.user.email,
                password: opts.user.passwordHash,
                roles: ['CLIENT'],
                active: opts.user.active,
                accountId,
                personId: person.id,
            },
        }));

    const client = await tx.client.create({
        data: {
            userId: user.id,
            personId: person.id,
            accountId,
            accountCompanyId: companyId,
            companyName: person.legalName,
            tradeName: person.tradeName ?? undefined,
            document: person.document,
            contactName: opts.contact.name,
            phone: opts.contact.phone,
        },
    });

    let opportunityId: string | null = null;
    if (opts.followUp && accountCreated) {
        const column = await findOrCreateConcluirCadastroColumn(tx);
        const opportunity = await tx.opportunity.create({
            data: {
                accountId,
                sessionId: `entrada-pending-${person.id}-${Date.now()}`,
                source: 'ENTRADA',
                stage: 'FOLLOW_UP',
                completeness: 'INCOMPLETE',
                type: 'QUOTE_ONLY',
                cpfCnpjSender: person.document,
                cpfCnpjReceiver: person.document,
                pipelineColumnId: column.id,
            },
        });
        opportunityId = opportunity.id ?? null;
    }

    return { client, userId: user.id, created: true, opportunityId };
}

export function placeholderEmailFor(personId: string): string {
    return `pendente-${personId}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

/** Hash de um segredo aleatório que ninguém conhece: a credencial existe só para satisfazer o schema. */
export async function unusablePasswordHash(): Promise<string> {
    return bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
}

/**
 * Garante Account + Client para a Pessoa pagadora do frete (CNPJ ou CPF), para o pedido poder
 * ser faturado. SEM credencial utilizável: usuário `@comercial.tsmex.local` com `active: false`
 * (login e middleware recusam usuário inativo) e senha aleatória descartada. A conta nasce com a
 * tag `CADASTRO_A_COMPLETAR` e um cartão no CRM para o Comercial completar os dados.
 *
 * Idempotente (Client com conta existente é devolvido) e serializado por pessoa
 * (advisory lock na transação) — duas chamadas concorrentes não criam duas contas.
 */
export async function ensureBillingAccountForPayer(
    personId: string,
    tx: Db,
): Promise<ProvisionedClient & { accountId: string }> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${personId}::text))::text AS "locked"`;

    const person = await tx.person.findUnique({ where: { id: personId } });
    if (!person) throw new AppError('Pessoa pagadora não encontrada', 404);

    const existing = await tx.client.findFirst({
        where: { OR: [{ personId }, { document: person.document }] },
    });
    if (existing?.accountId) {
        return { client: existing, userId: existing.userId ?? null, created: false, opportunityId: null, accountId: existing.accountId };
    }

    const provisioned = await provisionClientAccount(tx, person, existing, {
        user: { email: placeholderEmailFor(personId), passwordHash: await unusablePasswordHash(), active: false },
        contact: PLACEHOLDER_CONTACT,
        tags: [CADASTRO_A_COMPLETAR_TAG],
        followUp: true,
    });
    return { ...provisioned, accountId: provisioned.client.accountId! };
}
