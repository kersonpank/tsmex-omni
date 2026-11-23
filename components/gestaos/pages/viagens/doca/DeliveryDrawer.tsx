import React, { useEffect, useRef, useState } from 'react';
import { manifestsApi } from '../../../../../lib/api';
import type { DeliveryProgress } from '../../../../../types/index';
import { NEXT_ACTION_LABELS, buildDeliveredPayload, buildNotDeliveredPayload, validateDelivered, validateNotDelivered, type NextAction } from '../../../../os/lib/delivery';
import { docaErrorMessage, isConflict } from '../../../lib/docaWork';
import { Button, Field, SelectInput, TextArea, TextInput } from '../../../ui/kit';
import { Drawer, useAction } from '../../../ui/overlay';
import { sendFile } from './docaFiles';

export type AttemptMode = 'DELIVERED' | 'FAILED';

interface Props {
    manifestId: string;
    item: DeliveryProgress;
    mode: AttemptMode;
    onClose: () => void;
    onDone: () => void;
    onStale: () => void;
}

const NextActionField: React.FC<{ label: string; value: NextAction | ''; onChange: (value: NextAction) => void }> = ({ label, value, onChange }) => (
    <Field label={label}>
        <SelectInput aria-label={label} value={value} onChange={(event) => onChange(event.target.value as NextAction)}>
            <option value="" disabled>Escolha…</option>
            {(Object.keys(NEXT_ACTION_LABELS) as NextAction[]).map((action) => (
                <option key={action} value={action}>{NEXT_ACTION_LABELS[action]}</option>
            ))}
        </SelectInput>
    </Field>
);

/**
 * Registra uma tentativa de entrega em nome do transportador. Uma intenção = uma chave de idempotência:
 * o reenvio reaproveita a chave (não duplica a tentativa); ela só é zerada no sucesso ou quando o alvo muda.
 */
export const DeliveryDrawer: React.FC<Props> = ({ manifestId, item, mode, onClose, onDone, onStale }) => {
    const { busy, run } = useAction();
    const remaining = item.remainingQuantity;
    const [receiverName, setReceiverName] = useState('');
    const [quantity, setQuantity] = useState(String(remaining));
    const [file, setFile] = useState<File | null>(null);
    const [justification, setJustification] = useState('');
    const [reason, setReason] = useState('');
    const [nextAction, setNextAction] = useState<NextAction | ''>('');
    const [problem, setProblem] = useState<string | null>(null);
    const key = useRef<string | null>(null);
    const uploaded = useRef<{ name: string; size: number; storageKey: string } | null>(null);
    const target = `${item.orderId}:${mode}`;

    useEffect(() => {
        key.current = null;
        uploaded.current = null;
    }, [target]);

    const qty = Number(quantity);
    const partial = mode === 'DELIVERED' && Number.isInteger(qty) && qty > 0 && qty < remaining;
    const action = nextAction || undefined;

    const submit = async () => {
        const issue = mode === 'DELIVERED'
            ? validateDelivered({ receiverName, quantity: qty, remaining, hasEvidence: Boolean(file), justification, nextAction: action })
            : validateNotDelivered({ reason, nextAction: action });
        if (issue) return setProblem(issue);
        setProblem(null);
        key.current ??= crypto.randomUUID();
        const idempotencyKey = key.current;
        const ok = await run(
            'attempt',
            async () => {
                try {
                    let evidenceStorageKey: string | undefined;
                    if (mode === 'DELIVERED' && file) {
                        const cached = uploaded.current;
                        if (cached && cached.name === file.name && cached.size === file.size) evidenceStorageKey = cached.storageKey;
                        else {
                            evidenceStorageKey = (await sendFile(file)).storageKey;
                            if (evidenceStorageKey) uploaded.current = { name: file.name, size: file.size, storageKey: evidenceStorageKey };
                        }
                    }
                    const payload = mode === 'DELIVERED'
                        ? buildDeliveredPayload(item.orderId, { receiverName, quantity: qty, remaining, hasEvidence: Boolean(file), justification, nextAction: action, evidenceStorageKey }, idempotencyKey)
                        : buildNotDeliveredPayload(item.orderId, { reason, nextAction: action as NextAction }, idempotencyKey);
                    await manifestsApi.recordDeliveryAttempt(manifestId, payload);
                } catch (cause) {
                    if (isConflict(cause)) onStale();
                    throw new Error(docaErrorMessage(cause, 'Nada foi perdido, confira a conexão e tente de novo.'));
                }
            },
            { success: mode === 'DELIVERED' ? 'Entrega registrada pela torre.' : 'Não entrega registrada pela torre.', error: 'Não foi possível salvar a tentativa.' },
        );
        if (ok) {
            key.current = null;
            uploaded.current = null;
            onDone();
        }
    };

    return (
        <Drawer
            open
            onClose={onClose}
            width={560}
            title={mode === 'DELIVERED' ? 'Registrar entrega' : 'Registrar que não foi entregue'}
            subtitle={`Pedido ${item.orderNumber}${item.recipientName ? ` · ${item.recipientName}` : ''}`}
            footer={
                <Button variant={mode === 'DELIVERED' ? 'primary' : 'danger'} loading={busy === 'attempt'} onClick={() => void submit()}>
                    {mode === 'DELIVERED' ? 'Confirmar entrega' : 'Confirmar que não foi entregue'}
                </Button>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="gx-soft text-[13.5px]">Registrado pela torre, em nome do transportador. O ator da sessão fica gravado na tentativa.</p>
                {mode === 'DELIVERED' ? (
                    <>
                        <Field label="Quem recebeu">
                            <TextInput aria-label="Quem recebeu" value={receiverName} onChange={(event) => setReceiverName(event.target.value)} placeholder="Nome de quem recebeu" />
                        </Field>
                        <Field label={`Volumes entregues (saldo: ${remaining})`}>
                            <TextInput aria-label="Volumes entregues" type="number" inputMode="numeric" min={1} max={remaining} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                        </Field>
                        {partial ? <NextActionField label={`O que fazer com os outros ${remaining - qty} volume(s)`} value={nextAction} onChange={setNextAction} /> : null}
                        <Field label="Foto ou arquivo do comprovante">
                            <input type="file" accept="image/*,application/pdf" aria-label="Comprovante" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                        </Field>
                        {!file ? (
                            <Field label="Sem comprovante? Explique por quê" hint="Pelo menos 10 caracteres.">
                                <TextArea aria-label="Justificativa sem comprovante" value={justification} onChange={(event) => setJustification(event.target.value)} />
                            </Field>
                        ) : null}
                    </>
                ) : (
                    <>
                        <Field label="O que aconteceu" hint="Ex.: destinatário ausente, loja fechada, recusou a carga.">
                            <TextArea aria-label="O que aconteceu" value={reason} onChange={(event) => setReason(event.target.value)} />
                        </Field>
                        <NextActionField label="O que fazer com a carga" value={nextAction} onChange={setNextAction} />
                        <p className="gx-soft text-[13.5px]">Ao concluir a viagem, a carga volta ao estoque do hub com este motivo registrado.</p>
                    </>
                )}
                {problem ? <p role="alert" className="text-[13.5px] font-semibold" style={{ color: 'var(--gx-red)' }}>{problem}</p> : null}
            </div>
        </Drawer>
    );
};
