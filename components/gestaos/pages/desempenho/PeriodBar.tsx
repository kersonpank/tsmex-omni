import React, { useEffect, useState } from 'react';
import { PRESETS, periodError, periodForPreset, periodLabel, presetOf, type Period } from '../../lib/desempenho';
import { Button, Chip, Field, TextInput } from '../../ui/kit';

/** Seletor de período: atalhos e datas livres. O período vive na URL (`?de=&ate=`). */
export const PeriodBar: React.FC<{ period: Period; onChange: (period: Period) => void }> = ({ period, onChange }) => {
    const preset = presetOf(period);
    const [custom, setCustom] = useState(preset === 'custom');
    const [draft, setDraft] = useState<Period>(period);
    useEffect(() => setDraft(period), [period]);

    const draftError = periodError(draft);
    const changed = draft.from !== period.from || draft.to !== period.to;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Período">
                {PRESETS.map((item) => (
                    <Chip
                        key={item.id}
                        active={!custom && preset === item.id}
                        onClick={() => {
                            setCustom(false);
                            onChange(periodForPreset(item.id));
                        }}
                    >
                        {item.label}
                    </Chip>
                ))}
                <Chip active={custom} onClick={() => setCustom(true)}>
                    Personalizado
                </Chip>
                <span className="gx-muted ml-1 text-[13px]">{periodLabel(period)}</span>
            </div>
            {custom ? (
                <div className="flex flex-wrap items-end gap-3">
                    <Field label="De">
                        <TextInput type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
                    </Field>
                    <Field label="Até">
                        <TextInput type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
                    </Field>
                    <Button variant="soft" disabled={!!draftError || !changed} onClick={() => onChange(draft)}>
                        Aplicar período
                    </Button>
                    {draftError ? <span className="gx-red-text pb-2 text-[13px]">{draftError}</span> : null}
                </div>
            ) : null}
        </div>
    );
};
