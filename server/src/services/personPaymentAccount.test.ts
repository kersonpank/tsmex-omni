import assert from 'node:assert/strict';
import { it } from 'node:test';
import { paymentAccountSchema, savePrimaryPaymentAccount } from './personPaymentAccount.js';

const payment = { pixKeyType: 'Email' as const, pixKey: 'titular@example.com', holderName: 'Titular', holderDocument: '12345678901' };
it('cria conta primária com tipo PIX e titular sem perder os novos campos', async () => {
    let saved: any;
    const db = { personPaymentAccount: {
        findFirst: async () => null,
        create: async (args: any) => { saved = args.data; return saved; },
    } } as any;
    await savePrimaryPaymentAccount(db, 'carrier-person', paymentAccountSchema.parse(payment));
    assert.deepEqual(saved, { personId: 'carrier-person', isPrimary: true, ...payment });
});
it('atualiza a conta primária existente e permite trocar PIX por conta', async () => {
    let saved: any;
    const db = { personPaymentAccount: {
        findFirst: async (args: any) => { assert.deepEqual(args.where, { personId: 'carrier-person', isPrimary: true }); return { id: 'account-1' }; },
        update: async (args: any) => { saved = args; return args.data; },
    } } as any;
    const data = paymentAccountSchema.parse({ ...payment, pixKey: '', bankCode: '341', accountType: 'ContaCorrente', agency: '1234', account: '5678-9' });
    await savePrimaryPaymentAccount(db, 'carrier-person', data);
    assert.deepEqual(saved, { where: { id: 'account-1' }, data });
});
it('rejeita enumeração PIX inválida e aceita payloads antigos', () => {
    assert.equal(paymentAccountSchema.safeParse({ pixKeyType: 'CNPJ' }).success, false);
    assert.deepEqual(paymentAccountSchema.parse({ bankCode: '001', agency: '12', account: '34-5' }), { bankCode: '001', agency: '12', account: '34-5' });
});
