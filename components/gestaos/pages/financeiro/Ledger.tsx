import React, { useEffect, useRef, useState } from 'react';
import { Button, Field, Kv, TextInput } from '../../ui/kit';
import { dateFull, money } from '../../lib/format';
import { fromCents, isValidReason, MIN_REASON, parseAmountInput, toCents, validateSettlementAmount } from '../../lib/financeiro';

/**
 * Corpo da gaveta de baixa: usado igual para recebimento de fatura e pagamento de título.
 * A `idempotencyKey` nasce uma vez por intenção (mesmo valor e referência), é reaproveitada se a
 * pessoa repetir o envio e zera no sucesso, quando o campo muda e quando o alvo troca.
 */

export interface LedgerEntry {
    id: string;
    amount: string | number;
    date: string;
    reference?: string | null;
    reversedAt?: string | null;
    reversalReason?: string | null;
}

export interface LedgerProps {
    kind: 'receipt' | 'payment';
    targetId: string;
    /** Total do documento, o que já foi baixado e o saldo (em reais, como o servidor devolve). */
    total: number | string;
    settled: number;
    balance: number;
    entries: LedgerEntry[];
    busy: string | null;
    onAdd: (amount: number, reference: string | undefined, idempotencyKey: string) => Promise<boolean>;
    onReverse: (entryId: string, reason: string) => Promise<boolean>;
}

const COPY = {
    receipt: { done: 'Recebido', form: 'Registrar recebimento', amount: 'Valor recebido', submit: 'Confirmar recebimento', empty: 'Nenhum recebimento ainda.', title: 'Recebimentos' },
    payment: { done: 'Pago', form: 'Registrar pagamento', amount: 'Valor pago', submit: 'Confirmar pagamento', empty: 'Nenhum pagamento ainda.', title: 'Pagamentos' },
} as const;

export const Ledger: React.FC<LedgerProps> = ({ kind, targetId, total, settled, balance, entries, busy, onAdd, onReverse }) => {
    const copy = COPY[kind];
    const [amount, setAmount] = useState('');
    const [reference, setReference] = useState('');
    const [touched, setTouched] = useState(false);
    const [reversing, setReversing] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const key = useRef<string | null>(null);

    // Alvo novo: nada do que foi digitado vale para ele.
    useEffect(() => {
        key.current = null;
        setAmount('');
        setReference('');
        setTouched(false);
        setReversing(null);
        setReason('');
    }, [targetId]);

    const balanceCents = toCents(balance);
    const error = validateSettlementAmount(amount, balanceCents);
    const sending = busy === `${kind}:add`;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setTouched(true);
        const cents = parseAmountInput(amount);
        if (error || cents == null) return;
        key.current ??= crypto.randomUUID();
        const ok = await onAdd(fromCents(cents), reference.trim() || undefined, key.current);
        if (ok) {
            key.current = null;
            setAmount('');
            setReference('');
            setTouched(false);
        }
    };

    const submitReversal = async (event: React.FormEvent, entryId: string) => {
        event.preventDefault();
        if (!isValidReason(reason)) return;
        if (await onReverse(entryId, reason.trim())) {
            setReversing(null);
            setReason('');
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="gx-inset px-4 py-1">
                <Kv label="Total" value={money(total)} />
                <Kv label={copy.done} value={money(settled)} />
                <Kv label="Saldo" value={money(balance)} strong />
            </div>

            {balanceCents > 0 ? (
                <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
                    <h3 className="gx-h2">{copy.form}</h3>
                    <Field label={copy.amount} error={touched ? error : null} hint={`No máximo ${money(balance)}.`}>
                        <TextInput
                            inputMode="decimal"
                            placeholder="0,00"
                            value={amount}
                            onChange={(event) => {
                                setAmount(event.target.value);
                                key.current = null;
                            }}
                            aria-invalid={touched && Boolean(error)}
                        />
                    </Field>
                    <Field label="Referência (opcional)">
                        <TextInput
                            maxLength={160}
                            value={reference}
                            onChange={(event) => {
                                setReference(event.target.value);
                                key.current = null;
                            }}
                        />
                    </Field>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <Button type="submit" variant="primary" loading={sending} disabled={busy != null && !sending}>
                            {copy.submit}
                        </Button>
                        <Button variant="ghost" disabled={busy != null || balanceCents <= 0} onClick={() => setAmount(String(balance))}>
                            Usar o saldo todo
                        </Button>
                    </div>
                </form>
            ) : (
                <p className="gx-soft text-[14px]">Sem saldo: nada mais a lançar.</p>
            )}

            <div>
                <h3 className="gx-h2 mb-2">{copy.title}</h3>
                {entries.length === 0 ? <p className="gx-muted text-[14px]">{copy.empty}</p> : null}
                <ul className="flex flex-col">
                    {entries.map((entry) => (
                        <li key={entry.id} className="gx-hair-b py-3 last:border-b-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                <span className={entry.reversedAt ? 'gx-num gx-muted line-through' : 'gx-num'}>{money(entry.amount)}</span>
                                <span className="gx-muted text-[13px]">
                                    {dateFull(entry.date)}
                                    {entry.reference ? ` · ${entry.reference}` : ''}
                                </span>
                            </div>
                            {entry.reversedAt ? (
                                <p className="gx-red-text mt-1 text-[13px]">Estornado em {dateFull(entry.reversedAt)}: {entry.reversalReason ?? 'sem motivo registrado'}</p>
                            ) : reversing === entry.id ? (
                                <form onSubmit={(event) => void submitReversal(event, entry.id)} className="gx-inset mt-2.5 flex flex-col gap-3 p-3.5" noValidate>
                                    <Field label="Motivo do estorno" hint={`Pelo menos ${MIN_REASON} caracteres.`}>
                                        <TextInput value={reason} maxLength={500} autoFocus onChange={(event) => setReason(event.target.value)} />
                                    </Field>
                                    <div className="flex flex-wrap gap-2">
                                        <Button type="submit" variant="danger" size="sm" loading={busy === `${kind}:reverse`} disabled={!isValidReason(reason) || (busy != null && busy !== `${kind}:reverse`)}>
                                            Confirmar estorno
                                        </Button>
                                        <Button size="sm" onClick={() => setReversing(null)} disabled={busy != null}>
                                            Cancelar
                                        </Button>
                                    </div>
                                </form>
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="mt-1 -ml-2"
                                    disabled={busy != null}
                                    onClick={() => {
                                        setReversing(entry.id);
                                        setReason('');
                                    }}
                                >
                                    Estornar
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};
