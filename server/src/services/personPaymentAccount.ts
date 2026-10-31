import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export const paymentAccountSchema = z.object({
    bankCode: z.string().optional(),
    accountType: z.string().optional(),
    agency: z.string().optional(),
    account: z.string().optional(),
    pixKey: z.string().optional(),
    pixKeyType: z.enum(['CpfOuCnpj', 'Email', 'TelefoneCelular', 'ChaveAleatoria']).optional(),
    holderName: z.string().optional(),
    holderDocument: z.string().optional(),
});

export async function savePrimaryPaymentAccount(
    tx: Pick<Prisma.TransactionClient, 'personPaymentAccount'>,
    personId: string,
    data: z.infer<typeof paymentAccountSchema>,
) {
    const current = await tx.personPaymentAccount.findFirst({ where: { personId, isPrimary: true } });
    if (current) return tx.personPaymentAccount.update({ where: { id: current.id }, data });
    return tx.personPaymentAccount.create({ data: { personId, ...data, isPrimary: true } });
}
