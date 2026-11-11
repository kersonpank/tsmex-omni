import React, { useRef, useState } from 'react';
import clsx from 'clsx';
import { manifestsApi, uploadApi } from '../../../lib/api';
import type { DeliveryProgress } from '../../../types/index';
import OsSheet from '../ui/Sheet';
import { OsButton } from '../ui/kit';
import {
    NEXT_ACTION_LABELS,
    buildDeliveredPayload,
    buildNotDeliveredPayload,
    validateDelivered,
    validateNotDelivered,
    type NextAction,
} from '../lib/delivery';

/**
 * Folha "Registrar entrega" / "Não entregue" de um pedido. Uma tentativa = uma chave de
 * idempotência: o retry do mesmo envio reaproveita a chave (nunca duplica a tentativa);
 * a chave só é renovada depois que o servidor aceitou.
 */

const fieldClass =
    'mt-1 w-full rounded-lg border-2 border-tower-200 bg-white px-3 py-2.5 text-[15px] text-tower-900 placeholder:text-tower-400 focus:border-brand-400 focus:outline-none dark:border-tower-600 dark:bg-tower-800 dark:text-white';

function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(file);
    });
}

const NextActionSelect: React.FC<{ value?: NextAction; onChange: (v: NextAction) => void; label: string }> = ({ value, onChange, label }) => (
    <label className="mt-3 block text-[13px] font-semibold text-tower-600 dark:text-tower-300">
        {label}
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value as NextAction)} className={fieldClass}>
            <option value="" disabled>Escolha…</option>
            {(Object.keys(NEXT_ACTION_LABELS) as NextAction[]).map((a) => (
                <option key={a} value={a}>{NEXT_ACTION_LABELS[a]}</option>
            ))}
        </select>
    </label>
);

const DeliveryAttemptSheet: React.FC<{
    manifestId: string;
    item: DeliveryProgress;
    mode: 'DELIVERED' | 'FAILED';
    onClose: () => void;
    onDone: () => void;
}> = ({ manifestId, item, mode, onClose, onDone }) => {
    const remaining = item.remainingQuantity;
    const [receiverName, setReceiverName] = useState('');
    const [quantity, setQuantity] = useState(String(remaining));
    const [file, setFile] = useState<File | null>(null);
    const [justification, setJustification] = useState('');
    const [reason, setReason] = useState('');
    const [nextAction, setNextAction] = useState<NextAction | undefined>(undefined);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const key = useRef<string | null>(null);
    const uploaded = useRef<{ name: string; size: number; storageKey: string } | null>(null);

    const qty = Number(quantity);
    const partial = mode === 'DELIVERED' && Number.isInteger(qty) && qty > 0 && qty < remaining;

    const submit = async () => {
        if (saving) return;
        const problem =
            mode === 'DELIVERED'
                ? validateDelivered({ receiverName, quantity: qty, remaining, hasEvidence: !!file, justification, nextAction })
                : validateNotDelivered({ reason, nextAction });
        if (problem) return setError(problem);
        setSaving(true);
        setError(null);
        try {
            key.current ??= crypto.randomUUID();
            let evidenceStorageKey: string | undefined;
            if (mode === 'DELIVERED' && file) {
                const cached = uploaded.current;
                if (cached && cached.name === file.name && cached.size === file.size) evidenceStorageKey = cached.storageKey;
                else {
                    const sent = await uploadApi.upload(await readAsBase64(file), file.name, file.type || 'application/octet-stream');
                    evidenceStorageKey = sent.data.storageKey;
                    if (evidenceStorageKey) uploaded.current = { name: file.name, size: file.size, storageKey: evidenceStorageKey };
                }
            }
            const payload =
                mode === 'DELIVERED'
                    ? buildDeliveredPayload(item.orderId, { receiverName, quantity: qty, remaining, hasEvidence: !!file, justification, nextAction, evidenceStorageKey }, key.current)
                    : buildNotDeliveredPayload(item.orderId, { reason, nextAction: nextAction! }, key.current);
            await manifestsApi.recordDeliveryAttempt(manifestId, payload);
            key.current = null;
            onDone();
        } catch (e) {
            const message = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
            setError(message ?? 'Não foi possível salvar. Nada foi perdido — confira a conexão e toque de novo.');
        } finally {
            setSaving(false);
        }
    };

    const title = mode === 'DELIVERED' ? 'Registrar entrega' : 'Não entregue';
    return (
        <OsSheet
            title={title}
            subtitle={`Pedido ${item.orderNumber}${item.recipientName ? ` · ${item.recipientName}` : ''}`}
            onClose={onClose}
            footer={
                <OsButton full variant={mode === 'DELIVERED' ? 'primary' : 'danger'} disabled={saving} onClick={() => void submit()}>
                    {saving ? 'Salvando…' : mode === 'DELIVERED' ? 'Confirmar entrega' : 'Confirmar que não foi entregue'}
                </OsButton>
            }
        >
            {mode === 'DELIVERED' ? (
                <>
                    <label className="block text-[13px] font-semibold text-tower-600 dark:text-tower-300">
                        Quem recebeu
                        <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Nome de quem recebeu" className={fieldClass} />
                    </label>
                    <label className="mt-3 block text-[13px] font-semibold text-tower-600 dark:text-tower-300">
                        Volumes entregues (saldo: {remaining})
                        <input type="number" inputMode="numeric" min={1} max={remaining} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={fieldClass} />
                    </label>
                    {partial ? (
                        <NextActionSelect label={`Os outros ${remaining - qty} volume(s)`} value={nextAction} onChange={setNextAction} />
                    ) : null}
                    <label className="mt-3 block text-[13px] font-semibold text-tower-600 dark:text-tower-300">
                        Foto ou arquivo do comprovante
                        <input
                            type="file"
                            accept="image/*,application/pdf"
                            capture="environment"
                            onChange={(e) => { setFile(e.target.files?.[0] ?? null); }}
                            className={clsx(fieldClass, 'file:mr-3 file:rounded-md file:border-0 file:bg-brand-500/10 file:px-3 file:py-1.5 file:font-bold file:text-brand-600')}
                        />
                    </label>
                    {!file ? (
                        <label className="mt-3 block text-[13px] font-semibold text-tower-600 dark:text-tower-300">
                            Sem comprovante? Explique por quê
                            <textarea rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Pelo menos 10 caracteres" className={fieldClass} />
                        </label>
                    ) : null}
                </>
            ) : (
                <>
                    <label className="block text-[13px] font-semibold text-tower-600 dark:text-tower-300">
                        O que aconteceu
                        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: destinatário ausente, loja fechada, recusou a carga" className={fieldClass} />
                    </label>
                    <NextActionSelect label="O que fazer com a carga" value={nextAction} onChange={setNextAction} />
                    <p className="mt-3 text-[13px] text-tower-500 dark:text-tower-400">
                        Ao concluir a viagem, a carga volta ao estoque do hub com este motivo registrado.
                    </p>
                </>
            )}
            {error ? <p role="alert" className="mt-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-700 dark:text-brand-red-400">{error}</p> : null}
        </OsSheet>
    );
};

export default DeliveryAttemptSheet;
