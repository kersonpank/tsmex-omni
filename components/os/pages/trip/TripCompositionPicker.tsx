import React, { useState } from 'react';
import { manifestsApi } from '../../../../lib/api';
import { buildTripComposition, setTrailerAt, type TripCompositionPlates } from '../../lib/carrier';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage } from '../../ui/Sheet';
import PlatePicker from './PlatePicker';

/**
 * Edição do cavalo OU dos implementos da viagem (placa livre, independente do transportador).
 * Grava na hora via PUT /manifests/:id/vehicles, mantendo a outra metade da composição como está.
 * Usado no "Responsável e composição" e no "Cadastro do veículo e motorista".
 */
const TripCompositionPicker: React.FC<{
    manifestId: string;
    mode: 'traction' | 'trailers';
    plates: TripCompositionPlates;
    onClose: () => void;
    onBack: () => void;
    onSaved: () => void | Promise<void>;
}> = ({ manifestId, mode, plates, onClose, onBack, onSaved }) => {
    const [tractionDraft, setTractionDraft] = useState(plates.traction ?? '');
    const [trailersDraft, setTrailersDraft] = useState<string[]>(plates.trailers.slice(0, 3));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        if (busy) return;
        const composition = buildTripComposition(mode === 'traction' ? tractionDraft : plates.traction ?? '', mode === 'traction' ? plates.trailers : trailersDraft);
        if (!composition) {
            setError('Informe a placa do cavalo com 7 letras/números.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await manifestsApi.setVehicles(manifestId, composition);
            await onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar os veículos.'));
        } finally {
            setBusy(false);
        }
    };

    const footer = (
        <>
            {error ? (
                <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
            ) : null}
            <OsButton full disabled={busy} onClick={() => void save()}>
                {busy ? 'Salvando…' : mode === 'traction' ? 'Salvar cavalo' : 'Salvar implementos'}
            </OsButton>
            <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={onBack}>
                Voltar
            </OsButton>
        </>
    );

    if (mode === 'traction') {
        return (
            <OsSheet title="Cavalo da viagem" subtitle="Qualquer cavalo, por placa" onClose={onClose} footer={footer}>
                <PlatePicker label="Cavalo" role="TRACTION" value={tractionDraft} onChange={setTractionDraft} />
                <p className="mt-1.5 text-[12px] text-tower-500 dark:text-tower-400">
                    Vale só para esta viagem; não depende do transportador nem do motorista.
                </p>
            </OsSheet>
        );
    }

    return (
        <OsSheet title="Implementos da viagem" subtitle="Até 3, qualquer combinação por placa" onClose={onClose} footer={footer}>
            {!plates.traction ? (
                <p className="mb-2 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">Informe o cavalo antes dos implementos.</p>
            ) : null}
            {[0, 1, 2].slice(0, Math.min(3, trailersDraft.length + 1)).map((index) => (
                <PlatePicker
                    key={index}
                    label={`Implemento ${index + 1}`}
                    role="TRAILER"
                    value={trailersDraft[index] ?? ''}
                    onChange={(plate) =>
                        setTrailersDraft((list) => {
                            const next = [...list];
                            next[index] = plate;
                            return next;
                        })
                    }
                    onClear={trailersDraft[index] ? () => setTrailersDraft((list) => setTrailerAt(list, index, null)) : undefined}
                />
            ))}
        </OsSheet>
    );
};

export default TripCompositionPicker;
