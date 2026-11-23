import React, { useState } from 'react';
import { ordersApi } from '../../../../lib/api';
import { noteBody, noteProblem } from '../../lib/pedidoDrawer';
import { invalidate } from '../../lib/resource';
import { Button, Field, TextArea } from '../../ui/kit';
import { useAction } from '../../ui/overlay';
import { DrawerBlock } from './DrawerBlock';

/** Nota manual no histórico do pedido (aparece no rastreio). */
export const OrderNote: React.FC<{ orderId: string }> = ({ orderId }) => {
    const { busy, run } = useAction();
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        const problem = noteProblem(text);
        setError(problem);
        if (problem) return;
        const ok = await run('note', () => ordersApi.addHistory(orderId, noteBody(text)), { success: 'Nota registrada no histórico.', error: 'A nota não foi registrada.' });
        if (ok) {
            setText('');
            invalidate(`orders:timeline:${orderId}`);
        }
    };

    return (
        <DrawerBlock title="Nota no histórico" mode="manual">
            <Field label="Nota" error={error} hint="Fica visível no histórico do pedido.">
                <TextArea value={text} rows={2} maxLength={500} onChange={(event) => setText(event.target.value)} placeholder="Ex.: cliente pediu entrega só pela manhã" />
            </Field>
            <div className="mt-3">
                <Button size="sm" variant="soft" loading={busy === 'note'} onClick={() => void submit()}>
                    Registrar nota
                </Button>
            </div>
        </DrawerBlock>
    );
};
