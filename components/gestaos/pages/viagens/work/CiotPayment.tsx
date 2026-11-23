import React from 'react';
import type { ciotPaymentFromAccount } from '../../../../os/lib/ciot';
import { Field, SelectInput, TextInput } from '../../../ui/kit';

export type CiotPaymentValue = ReturnType<typeof ciotPaymentFromAccount>;

/** Conta real do beneficiário (PIX ou banco). Nada é presumido: o operador confirma com o titular. */
export const CiotPayment: React.FC<{ value: CiotPaymentValue; onChange: (value: CiotPaymentValue) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => {
    const set = (key: keyof CiotPaymentValue, text: string) => onChange({ ...value, [key]: text });
    const text = (key: keyof CiotPaymentValue, label: string, className?: string) => (
        <Field label={label} className={className}>
            <TextInput aria-label={label} disabled={disabled} value={value[key]} onChange={(event) => set(key, event.target.value)} />
        </Field>
    );
    return (
        <fieldset disabled={disabled} className="col-span-full m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
            <div className="col-span-full flex flex-wrap gap-5 text-[14px]" role="radiogroup" aria-label="Forma de pagamento ao beneficiário">
                {(['PIX', 'BANK'] as const).map((method) => (
                    <label key={method} className="flex min-h-[40px] items-center gap-2">
                        <input type="radio" name="ciot-payment-method" checked={value.paymentMethod === method} onChange={() => set('paymentMethod', method)} />
                        {method === 'PIX' ? 'PIX' : 'Conta bancária'}
                    </label>
                ))}
            </div>
            {value.paymentMethod === 'PIX' ? (
                <>
                    <Field label="Tipo de chave">
                        <SelectInput aria-label="Tipo de chave PIX" value={value.pixKeyType} onChange={(event) => set('pixKeyType', event.target.value)}>
                            <option value="">Confirme o tipo de chave</option>
                            <option value="CpfOuCnpj">CPF/CNPJ</option>
                            <option value="Email">E-mail</option>
                            <option value="TelefoneCelular">Celular</option>
                            <option value="ChaveAleatoria">Chave aleatória</option>
                        </SelectInput>
                    </Field>
                    {text('pixKey', 'Chave PIX confirmada')}
                </>
            ) : (
                <>
                    {text('paymentBankCode', 'Banco (código)')}
                    {text('paymentAgency', 'Agência (dígito, quando houver)')}
                    {text('paymentAccount', 'Conta (número-dígito)')}
                    <Field label="Tipo de conta">
                        <SelectInput aria-label="Tipo de conta" value={value.paymentAccountType} onChange={(event) => set('paymentAccountType', event.target.value)}>
                            <option value="ContaCorrente">Corrente</option>
                            <option value="ContaPoupanca">Poupança</option>
                            <option value="ContaPagamento">Pagamento</option>
                        </SelectInput>
                    </Field>
                </>
            )}
            {text('holderName', 'Nome do titular')}
            {text('holderDocument', 'CPF/CNPJ do titular')}
        </fieldset>
    );
};
