import React, { useState } from 'react';
import { payablesApi, type PayableRow } from '../../../../lib/api';
import { Drawer, useAction } from '../../ui/overlay';
import { Button, Field, SelectInput, TextInput } from '../../ui/kit';
import { dueDateIso, fromCents, parseAmountInput } from '../../lib/financeiro';
import { KEYS } from '../../lib/data';
import { invalidate } from '../../lib/resource';

/** Título manual (despesa avulsa). Mesmas validações do servidor e da tela clássica. */
export const NewPayableDrawer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { busy, run } = useAction();
    const [type, setType] = useState<PayableRow['beneficiaryType']>('PARTNER');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [touched, setTouched] = useState(false);

    const cents = parseAmountInput(amount);
    const errors = {
        name: name.trim().length < 2 ? 'Informe o beneficiário (mínimo 2 letras).' : null,
        description: description.trim().length < 3 ? 'Descreva a despesa (mínimo 3 letras).' : null,
        amount: cents == null ? 'Use um valor maior que zero, com no máximo duas casas.' : null,
        dueDate: !dueDate ? 'Informe o vencimento.' : null,
    };
    const invalid = Object.values(errors).some(Boolean);
    const show = (field: keyof typeof errors) => (touched ? errors[field] : null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (invalid || cents == null) return;
        const ok = await run(
            'payable:new',
            () => payablesApi.create({ beneficiaryType: type, beneficiaryName: name.trim(), description: description.trim(), amount: fromCents(cents), dueDate: dueDateIso(dueDate) }),
            { success: 'Título criado.', error: 'O título não foi criado.' },
        );
        if (ok) {
            invalidate(KEYS.payables);
            onClose();
        }
    };

    return (
        <Drawer open onClose={onClose} title="Novo título a pagar" subtitle="Despesa lançada à mão. Viagens concluídas viram título sozinhas.">
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                <Field label="Tipo de beneficiário">
                    <SelectInput value={type} onChange={(event) => setType(event.target.value as PayableRow['beneficiaryType'])}>
                        <option value="PARTNER">Parceiro</option>
                        <option value="HUB">Hub</option>
                        <option value="LINK">Motorista / transportador</option>
                        <option value="OTHER">Outro</option>
                    </SelectInput>
                </Field>
                <Field label="Beneficiário" error={show('name')}>
                    <TextInput value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label="Descrição" error={show('description')}>
                    <TextInput value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
                </Field>
                <Field label="Valor (R$)" error={show('amount')}>
                    <TextInput inputMode="decimal" placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} />
                </Field>
                <Field label="Vencimento" error={show('dueDate')}>
                    <TextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2.5 pt-1">
                    <Button type="submit" variant="primary" loading={busy === 'payable:new'}>
                        Criar título
                    </Button>
                    <Button onClick={onClose} disabled={busy != null}>
                        Cancelar
                    </Button>
                </div>
            </form>
        </Drawer>
    );
};
