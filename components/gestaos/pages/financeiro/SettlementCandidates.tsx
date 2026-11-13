import React, { useState } from 'react';
import { payablesApi } from '../../../../lib/api';
import { useAction } from '../../ui/overlay';
import { Button, Field, Loadable, ModeBadge, Panel, TextInput } from '../../ui/kit';
import { money, plural } from '../../lib/format';
import { dueDateIso } from '../../lib/financeiro';
import { KEYS } from '../../lib/data';
import { invalidate } from '../../lib/resource';
import { useSettlementCandidates } from './useFinanceiro';

/** Viagens concluídas ainda sem título: o sistema gera sozinho; aqui a pessoa pode adiantar. */
export const SettlementCandidates: React.FC = () => {
    const candidates = useSettlementCandidates();
    const { busy, run } = useAction();
    const [pickedId, setPickedId] = useState<string | null>(null);
    const [dueDate, setDueDate] = useState('');

    const generate = async (manifestId: string) => {
        if (!dueDate) return;
        const ok = await run(`gen:${manifestId}`, () => payablesApi.fromManifest(manifestId, dueDateIso(dueDate)), { success: 'Título gerado.', error: 'O título não foi gerado.' });
        invalidate(KEYS.payables);
        if (ok) {
            setPickedId(null);
            setDueDate('');
        }
    };

    return (
        <Panel
            title="Viagens concluídas ainda sem título"
            hint="O sistema gera o título sozinho poucos minutos depois da conclusão da viagem. Se a espera passou, gere agora."
            mode="auto"
            count={candidates.data ? candidates.data.length : null}
            countTone="yellow"
        >
            <Loadable state={candidates} skeleton={<div className="gx-skeleton" style={{ height: 44 }} />} isEmpty={(list) => list.length === 0} empty={<p className="gx-soft text-[14px]">Toda viagem concluída com Carta Frete já tem título.</p>}>
                {(list) => (
                    <ul className="flex flex-col">
                        {list.map((candidate) => {
                            const key = `gen:${candidate.id}`;
                            const picked = pickedId === candidate.id;
                            return (
                                <li key={candidate.id} className="gx-hair-b py-3 last:border-b-0">
                                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                        <div className="min-w-0">
                                            <p className="text-[14px] font-semibold">
                                                {candidate.origin} → {candidate.destination}
                                            </p>
                                            <p className="gx-muted text-[13px]">
                                                {candidate.link?.name ?? 'Sem transportador'} · saldo líquido <span className="gx-num">{money(candidate.freightAgreement?.saldoLiquido)}</span>
                                            </p>
                                        </div>
                                        {picked ? null : (
                                            <Button size="sm" variant="soft" disabled={busy != null} onClick={() => { setPickedId(candidate.id); setDueDate(''); }}>
                                                Gerar título agora
                                            </Button>
                                        )}
                                    </div>
                                    {picked ? (
                                        <div className="gx-inset mt-3 flex flex-wrap items-end gap-3 p-3.5">
                                            <div className="w-[190px]">
                                                <Field label="Vencimento">
                                                    <TextInput type="date" value={dueDate} autoFocus onChange={(event) => setDueDate(event.target.value)} />
                                                </Field>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <ModeBadge mode="manual" />
                                                <Button variant="primary" size="sm" loading={busy === key} disabled={!dueDate || (busy != null && busy !== key)} onClick={() => void generate(candidate.id)}>
                                                    Gerar título
                                                </Button>
                                                <Button size="sm" disabled={busy != null} onClick={() => setPickedId(null)}>
                                                    Cancelar
                                                </Button>
                                            </div>
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Loadable>
            {candidates.data && candidates.data.length > 0 ? <p className="gx-muted mt-3 text-[12.5px]">{plural(candidates.data.length, 'viagem aguarda', 'viagens aguardam')} o título.</p> : null}
        </Panel>
    );
};
