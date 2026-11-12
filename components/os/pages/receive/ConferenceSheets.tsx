import React, { useRef, useState } from 'react';
import { uploadApi } from '../../../../lib/api';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Não foi possível ler a foto.'));
        reader.readAsDataURL(file);
    });
}

/** Avaria / ocorrência: descrição curta obrigatória e foto opcional. */
export const DamageSheet: React.FC<{
    title: string;
    initialNote?: string;
    initialPhoto?: string;
    onClose: () => void;
    onConfirm: (note: string, photoUrl?: string) => void;
}> = ({ title, initialNote = '', initialPhoto, onClose, onConfirm }) => {
    const [note, setNote] = useState(initialNote);
    const [photoUrl, setPhotoUrl] = useState<string | undefined>(initialPhoto);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const valid = note.trim().length >= 3;

    const pick = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        setError(null);
        try {
            const sent = await uploadApi.upload(await readAsBase64(file), file.name, file.type || 'application/octet-stream');
            setPhotoUrl(sent.data.url);
        } catch (cause) {
            setError(`${apiErrorMessage(cause, 'Não foi possível enviar a foto.')} Você pode seguir sem foto.`);
        } finally {
            setUploading(false);
        }
    };

    return (
        <OsSheet
            title="Avaria ou ocorrência"
            subtitle={title}
            onClose={onClose}
            footer={
                <OsButton full disabled={!valid || uploading} onClick={() => onConfirm(note.trim(), photoUrl)}>
                    Registrar avaria
                </OsButton>
            }
        >
            <label className="block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                O que aconteceu?*
                <textarea
                    value={note}
                    maxLength={300}
                    rows={3}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Ex.: caixa amassada, volume molhado"
                    className={`${osFieldClass} mt-1.5 h-auto py-2.5`}
                />
            </label>
            <div className="mt-3">
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Foto da avaria" onChange={(event) => void pick(event.target.files?.[0])} />
                <OsButton variant="secondary" full disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? 'Enviando foto…' : photoUrl ? 'Foto anexada · trocar' : 'Tirar foto (opcional)'}
                </OsButton>
            </div>
            {error ? <p role="alert" className="mt-2 text-[13px] font-semibold text-brand-red-600">{error}</p> : null}
        </OsSheet>
    );
};

/** "Não chegou" pede confirmação: o pedido volta ao estoque do hub de origem e abre alerta. */
export const MissingSheet: React.FC<{ title: string; onClose: () => void; onConfirm: () => void }> = ({ title, onClose, onConfirm }) => (
    <OsSheet
        title="Confirmar: não chegou"
        subtitle={title}
        onClose={onClose}
        footer={
            <div className="grid grid-cols-2 gap-2">
                <OsButton variant="secondary" onClick={onClose}>Voltar</OsButton>
                <OsButton variant="danger" onClick={onConfirm}>Sim, não chegou</OsButton>
            </div>
        }
    >
        <p className="text-[14px] text-tower-700 dark:text-tower-200">
            O pedido volta ao estoque do hub de origem e abre um alerta para apurar. Confira o veículo antes de confirmar.
        </p>
    </OsSheet>
);
