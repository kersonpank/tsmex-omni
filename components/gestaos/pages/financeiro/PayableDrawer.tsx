import React from 'react';
import { payablesApi } from '../../../../lib/api';
import { Drawer, useAction } from '../../ui/overlay';
import { Loadable, ModeBadge, Pill } from '../../ui/kit';
import { dateFull } from '../../lib/format';
import { PAYABLE_STATE_LABEL, payableState } from '../../lib/financeiro';
import { KEYS, type PayableFull } from '../../lib/data';
import { invalidate, useResource } from '../../lib/resource';
import { Ledger } from './Ledger';

export const PAYABLE_TONE = { PAID: 'neutral', CANCELLED: 'neutral', OVERDUE: 'red', DUE_SOON: 'yellow', OPEN: 'royal' } as const;

export const BENEFICIARY_LABEL: Record<PayableFull['beneficiaryType'], string> = { PARTNER: 'Parceiro', HUB: 'Hub', LINK: 'Transportador', OTHER: 'Outro' };

/** Detalhe de um título: pagamentos, novo pagamento e estorno. */
export const PayableDrawer: React.FC<{ payableId: string; row: PayableFull | null; onClose: () => void }> = ({ payableId, row, onClose }) => {
    const { busy, run } = useAction();
    const detail = useResource(`payables:detail:${payableId}`, async () => (await payablesApi.payments(payableId)).data, { staleMs: 5_000 });
    const state = row ? payableState(row) : null;
    const refresh = () => invalidate(KEYS.payables);

    return (
        <Drawer
            open
            onClose={onClose}
            title={row?.beneficiaryName ?? 'Título a pagar'}
            subtitle={row ? `${row.description} · vence ${dateFull(row.dueDate)}` : undefined}
            badge={
                <>
                    {state ? <Pill tone={PAYABLE_TONE[state]} dot={state === 'OVERDUE'}>{PAYABLE_STATE_LABEL[state]}</Pill> : null}
                    {row ? <ModeBadge mode={row.sourceType === 'MANIFEST' ? 'auto' : 'manual'} /> : null}
                </>
            }
        >
            <Loadable state={detail}>
                {(data) => (
                    <Ledger
                        kind="payment"
                        targetId={payableId}
                        total={data.payable.amount}
                        settled={data.paid}
                        balance={data.balance}
                        busy={busy}
                        entries={data.payable.payments.map((payment) => ({ id: payment.id, amount: payment.amount, date: payment.paidAt, reference: payment.reference, reversedAt: payment.reversedAt, reversalReason: payment.reversalReason }))}
                        onAdd={(amount, reference, idempotencyKey) =>
                            run('payment:add', () => payablesApi.addPayment(payableId, { amount, reference, idempotencyKey }).then(refresh), { success: 'Pagamento registrado.', error: 'O pagamento não foi registrado.' })
                        }
                        onReverse={(paymentId, reason) =>
                            run('payment:reverse', () => payablesApi.reversePayment(payableId, paymentId, reason).then(refresh), { success: 'Pagamento estornado.', error: 'O estorno não foi feito.' })
                        }
                    />
                )}
            </Loadable>
        </Drawer>
    );
};
