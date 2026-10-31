import React from 'react';
import { ciotPaymentFromAccount } from '../../lib/ciot';
import { osFieldClass } from '../../ui/Sheet';

export type PaymentAccountState = ReturnType<typeof ciotPaymentFromAccount>;

const PaymentAccountFields: React.FC<{
    value: PaymentAccountState;
    onChange: (value: PaymentAccountState) => void;
    disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
    const set = (key: keyof PaymentAccountState, text: string) => onChange({ ...value, [key]: text });
    const field = (key: keyof PaymentAccountState, label: string) => (
        <label className="block text-[13px] font-bold text-tower-600 dark:text-tower-300">
            {label}
            <input value={value[key]} onChange={(event) => set(key, event.target.value)} className={`${osFieldClass} mt-1.5`} />
        </label>
    );
    return (
        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap gap-4 text-[14px]">
                {(['PIX', 'BANK'] as const).map((method) => (
                    <label key={method} className="flex min-h-[44px] items-center gap-2">
                        <input type="radio" checked={value.paymentMethod === method} onChange={() => set('paymentMethod', method)} />
                        {method === 'PIX' ? 'PIX' : 'Conta bancária'}
                    </label>
                ))}
            </div>
            {value.paymentMethod === 'PIX' ? <>
                <label className="text-[13px] font-bold text-tower-600 dark:text-tower-300">Tipo de chave
                    <select value={value.pixKeyType} onChange={(event) => set('pixKeyType', event.target.value)} className={`${osFieldClass} mt-1.5`}>
                        <option value="">Confirme o tipo de chave</option>
                        <option value="CpfOuCnpj">CPF/CNPJ</option><option value="Email">E-mail</option>
                        <option value="TelefoneCelular">Celular</option><option value="ChaveAleatoria">Chave aleatória</option>
                    </select>
                </label>
                {field('pixKey', 'Chave PIX confirmada')}
            </> : <>
                {field('paymentBankCode', 'Banco (código)')}
                {field('paymentAgency', 'Agência (dígito, quando houver)')}
                {field('paymentAccount', 'Conta (número-dígito)')}
                <label className="text-[13px] font-bold text-tower-600 dark:text-tower-300">Tipo de conta
                    <select value={value.paymentAccountType} onChange={(event) => set('paymentAccountType', event.target.value)} className={`${osFieldClass} mt-1.5`}>
                        <option value="ContaCorrente">Corrente</option><option value="ContaPoupanca">Poupança</option><option value="ContaPagamento">Pagamento</option>
                    </select>
                </label>
            </>}
            {field('holderName', 'Nome do titular')}
            {field('holderDocument', 'CPF/CNPJ do titular')}
        </fieldset>
    );
};

export default PaymentAccountFields;
