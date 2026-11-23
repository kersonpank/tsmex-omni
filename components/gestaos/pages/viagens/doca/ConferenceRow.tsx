import React, { useState } from 'react';
import type { ConferenceMark, UnloadItem } from '../../../../os/lib/arrival';
import { itemLabel } from '../../../../os/lib/conference';
import { divergenceNoteProblem } from '../../../lib/docaWork';
import { Button, Field, Pill, TextArea } from '../../../ui/kit';
import { sendFile } from './docaFiles';

const MARK_LABEL: Record<ConferenceMark, string> = { OK: 'Chegou certo', AVARIA: 'Chegou com avaria', FALTA: 'Não chegou' };

interface Props {
    item: UnloadItem;
    mark: ConferenceMark | undefined;
    note: string;
    hasPhoto: boolean;
    disabled: boolean;
    onMark: (mark: ConferenceMark | undefined, note?: string, photoUrl?: string) => void;
}

/** Um pedido da descarga: OK, avaria ou não chegou. Divergência abre nota obrigatória e foto opcional. */
export const ConferenceRow: React.FC<Props> = ({ item, mark, note, hasPhoto, disabled, onMark }) => {
    const [editing, setEditing] = useState<'AVARIA' | 'FALTA' | null>(null);
    const [text, setText] = useState(note);
    const [photo, setPhoto] = useState<string | undefined>(undefined);
    const [uploading, setUploading] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const label = itemLabel(item);

    const confirm = () => {
        const issue = divergenceNoteProblem({ mark: editing ?? undefined, note: text });
        if (issue) return setProblem(issue);
        onMark(editing!, text.trim(), editing === 'AVARIA' ? photo ?? '' : '');
        setEditing(null);
        setProblem(null);
    };

    const pickPhoto = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        setProblem(null);
        try {
            setPhoto((await sendFile(file)).url);
        } catch {
            setProblem('Não foi possível enviar a foto. Você pode seguir sem ela.');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="gx-inset flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <p className="font-semibold">{label}</p>
                    <p className="gx-muted text-[13px]">
                        {item.nfNumber ? <span className="gx-mono">NF {item.nfNumber}</span> : null}
                        {item.nfNumber && item.destination ? ' · ' : ''}
                        {item.destination ?? ''}
                    </p>
                </div>
                {mark ? <Pill tone={mark === 'OK' ? 'neutral' : mark === 'AVARIA' ? 'yellow' : 'red'}>{MARK_LABEL[mark]}</Pill> : <Pill>Sem conferir</Pill>}
            </div>
            {mark && mark !== 'OK' && note ? <p className="gx-soft text-[13.5px]">Nota: {note}{mark === 'AVARIA' && hasPhoto ? ' · com foto' : ''}</p> : null}
            {editing ? (
                <div className="flex flex-col gap-3">
                    <Field label={editing === 'AVARIA' ? `Avaria: o que aconteceu com ${label}?` : `O que se sabe sobre ${label}, que não chegou?`} error={problem}>
                        <TextArea aria-label={`Nota da divergência de ${label}`} value={text} maxLength={300} onChange={(event) => setText(event.target.value)} />
                    </Field>
                    {editing === 'AVARIA' ? (
                        <Field label="Foto da avaria (opcional)">
                            <input type="file" accept="image/*" aria-label={`Foto da avaria de ${label}`} onChange={(event) => void pickPhoto(event.target.files?.[0])} />
                            {photo ? <span className="gx-soft text-[13px]">Foto anexada.</span> : null}
                        </Field>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        <Button variant="primary" disabled={uploading || disabled} onClick={confirm}>{editing === 'AVARIA' ? 'Registrar avaria' : 'Registrar que não chegou'}</Button>
                        <Button variant="ghost" onClick={() => { setEditing(null); setProblem(null); }}>Cancelar</Button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <Button variant={mark === 'OK' ? 'primary' : 'soft'} disabled={disabled} aria-label={`${label}: chegou certo`} onClick={() => onMark('OK')}>OK</Button>
                    <Button variant={mark === 'AVARIA' ? 'primary' : 'soft'} disabled={disabled} aria-label={`${label}: avaria`} onClick={() => { setText(note); setEditing('AVARIA'); }}>Avaria</Button>
                    <Button variant={mark === 'FALTA' ? 'primary' : 'soft'} disabled={disabled} aria-label={`${label}: não chegou`} onClick={() => { setText(note); setEditing('FALTA'); }}>Não chegou</Button>
                </div>
            )}
        </div>
    );
};
