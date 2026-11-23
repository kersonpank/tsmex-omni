import React, { useEffect, useState } from 'react';
import { invoicesApi } from '../../../../lib/api';
import { Button, Field, TextArea, TextInput } from '../../ui/kit';
import type { useAction } from '../../ui/overlay';
import { dueDateIso } from '../../lib/financeiro';
import { invalidate } from '../../lib/resource';
import { KEYS } from '../../lib/data';
import type { InvoiceRow } from './useFinanceiro';

type Run = ReturnType<typeof useAction>['run'];

interface Props {
    invoice: InvoiceRow;
    /** Recebimentos ativos (não estornados): o servidor só cancela a fatura sem nenhum. */
    activeReceipts: number;
    busy: string | null;
    run: Run;
}

const dayOf = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');

/** Editar vencimento e observação, e cancelar a fatura (exige estornar os recebimentos antes). */
export const InvoiceActions: React.FC<Props> = ({ invoice, activeReceipts, busy, run }) => {
    const [dueDate, setDueDate] = useState(dayOf(invoice.dueDate));
    const [notes, setNotes] = useState(invoice.notes ?? '');
    const [confirming, setConfirming] = useState(false);

    // Dados vindos do servidor depois de salvar valem mais que o que estava no campo.
    useEffect(() => {
        setDueDate(dayOf(invoice.dueDate));
        setNotes(invoice.notes ?? '');
    }, [invoice.id, invoice.dueDate, invoice.notes]);

    const dueChanged = dueDate !== dayOf(invoice.dueDate);
    const notesChanged = notes.trim() !== (invoice.notes ?? '').trim();
    const changed = (dueChanged && dueDate !== '') || notesChanged;

    const save = async () => {
        const body: { dueDate?: string; notes?: string } = {};
        if (dueChanged && dueDate) body.dueDate = dueDateIso(dueDate);
        if (notesChanged) body.notes = notes.trim();
        await run('invoice:edit', () => invoicesApi.update(invoice.id, body).then(() => invalidate('invoices:')), { success: 'Fatura atualizada.', error: 'A fatura não foi atualizada.' });
    };

    const cancel = async () => {
        const done = await run('invoice:cancel', () => invoicesApi.updateStatus(invoice.id, { status: 'CANCELLED' }).then(() => invalidate('invoices:', KEYS.unbilled)), {
            success: 'Fatura cancelada.',
            error: 'A fatura não foi cancelada.',
        });
        if (done) setConfirming(false);
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3.5">
                <h3 className="gx-h2">Vencimento e observação</h3>
                <Field label="Vencimento">
                    <TextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                </Field>
                <Field label="Observação">
                    <TextArea rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>
                <div>
                    <Button variant="soft" loading={busy === 'invoice:edit'} disabled={!changed || (busy != null && busy !== 'invoice:edit')} onClick={() => void save()}>
                        Salvar alterações
                    </Button>
                </div>
            </div>

            <div className="gx-inset flex flex-col gap-3 p-4">
                <h3 className="gx-h2">Cancelar fatura</h3>
                {activeReceipts > 0 ? (
                    <p className="gx-soft text-[14px]">Esta fatura tem {activeReceipts === 1 ? '1 recebimento ativo' : `${activeReceipts} recebimentos ativos`}. Estorne {activeReceipts === 1 ? 'o recebimento' : 'os recebimentos'} abaixo antes de cancelar.</p>
                ) : confirming ? (
                    <>
                        <p className="gx-soft text-[14px]">Cancelar libera os pedidos da fatura para faturar de novo. Isto não pode ser desfeito.</p>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="danger" size="sm" loading={busy === 'invoice:cancel'} disabled={busy != null && busy !== 'invoice:cancel'} onClick={() => void cancel()}>
                                Confirmar cancelamento
                            </Button>
                            <Button size="sm" disabled={busy != null} onClick={() => setConfirming(false)}>
                                Voltar
                            </Button>
                        </div>
                    </>
                ) : (
                    <div>
                        <Button variant="danger" size="sm" disabled={busy != null} onClick={() => setConfirming(true)}>
                            Cancelar fatura
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};
