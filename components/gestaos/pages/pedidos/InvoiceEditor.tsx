import React from 'react';
import { maskDateDDMMYYYY } from '../../../../lib/formatters';
import type { NfSpecies } from '../../../../types/index';
import { rowsCubageM3, rowsTotalQty, type InvoiceDraft, type InvoiceErrors } from '../../lib/pedidoForm';
import { MoneyInput, NumberInput } from '../../ui/form';
import { Button, Field, ModeBadge, SelectInput, Tabs, TextArea, TextInput } from '../../ui/kit';
import { VolumeRows } from './VolumeRows';

const OTHER = '__other__';

interface Props {
    draft: InvoiceDraft;
    errors: InvoiceErrors;
    species: NfSpecies[];
    onChange: (draft: InvoiceDraft) => void;
    onCommit: () => void;
    onCancel: () => void;
    commitLabel: string;
}

/** Editor de uma nota (NF-e ou declaração de conteúdo). Confirmar guarda na lista; a gravação é no fim da página. */
export const InvoiceEditor: React.FC<Props> = ({ draft, errors, species, onChange, onCommit, onCancel, commitLabel }) => {
    const set = (change: Partial<InvoiceDraft>) => onChange({ ...draft, ...change });
    const listed = species.some((item) => item.name === draft.species);
    const [other, setOther] = React.useState(Boolean(draft.species) && !listed);
    const calculated = rowsCubageM3(draft.rows);
    const isDeclaration = draft.type === 'OUTRAS';

    return (
        <div className="gx-inset flex flex-col gap-4 p-4" role="group" aria-label={isDeclaration ? 'Declaração de conteúdo' : 'Nota fiscal'}>
            {!draft.id ? (
                <Tabs
                    label="Tipo de documento"
                    value={draft.type}
                    onChange={(id) => set({ type: id as 'NFE' | 'OUTRAS' })}
                    tabs={[
                        { id: 'NFE', label: 'NF-e' },
                        { id: 'OUTRAS', label: 'Declaração (sem NF)' },
                    ]}
                />
            ) : null}
            {draft.fromLookup ? (
                <p className="gx-soft flex flex-wrap items-center gap-2 text-[13px]">
                    <ModeBadge mode="copilot" /> Número, emissão e chave vieram da consulta da NF-e. Volumes, peso e valor, copie da DANFE.
                </p>
            ) : null}

            {isDeclaration ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Descrição dos itens" error={errors.nature} className="sm:col-span-2" hint="Itens pessoais ou mercadoria sem nota: sai uma Declaração de Conteúdo.">
                        <TextArea value={draft.nature} aria-invalid={Boolean(errors.nature) || undefined} onChange={(event) => set({ nature: event.target.value })} placeholder="Ex.: roupas, utensílios domésticos" />
                    </Field>
                    <Field label="Peso estimado">
                        <NumberInput decimal decimals={4} suffix="kg" value={draft.weight} onChange={(weight) => set({ weight })} aria-label="Peso estimado" />
                    </Field>
                    <Field label="Valor declarado">
                        <MoneyInput value={draft.value} onChange={(value) => set({ value })} aria-label="Valor declarado" />
                    </Field>
                    <Field label="Número de volumes">
                        <NumberInput min={1} value={draft.rows[0]?.qty ?? 1} onChange={(qty) => set({ rows: [{ ...(draft.rows[0] ?? { alturaCm: '', larguraCm: '', comprimentoCm: '' }), qty }] })} aria-label="Número de volumes" />
                    </Field>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Chave da NF-e (44 dígitos)" error={errors.nfKey} className="sm:col-span-2">
                            <TextInput
                                className="gx-mono"
                                inputMode="numeric"
                                maxLength={44}
                                value={draft.nfKey}
                                aria-invalid={Boolean(errors.nfKey) || undefined}
                                onChange={(event) => set({ nfKey: event.target.value.replace(/\D/g, '').slice(0, 44) })}
                            />
                        </Field>
                        <Field label="Número da NF" error={errors.nfNumber}>
                            <TextInput value={draft.nfNumber} aria-invalid={Boolean(errors.nfNumber) || undefined} onChange={(event) => set({ nfNumber: event.target.value })} />
                        </Field>
                        <Field label="Emissão" error={errors.emissionDate}>
                            <TextInput inputMode="numeric" placeholder="DD/MM/AAAA" maxLength={10} value={draft.emissionDate} onChange={(event) => set({ emissionDate: maskDateDDMMYYYY(event.target.value) })} />
                        </Field>
                        <Field label="Natureza da carga">
                            <TextInput value={draft.nature} placeholder="Ex.: veterinário" onChange={(event) => set({ nature: event.target.value })} />
                        </Field>
                        <Field label="Espécie">
                            <SelectInput
                                value={other ? OTHER : draft.species}
                                onChange={(event) => {
                                    if (event.target.value === OTHER) {
                                        setOther(true);
                                        set({ species: '' });
                                    } else {
                                        setOther(false);
                                        set({ species: event.target.value });
                                    }
                                }}
                            >
                                <option value="">Selecione</option>
                                {species.map((item) => (
                                    <option key={item.id} value={item.name}>
                                        {item.name}
                                    </option>
                                ))}
                                <option value={OTHER}>Outra</option>
                            </SelectInput>
                            {other ? <TextInput className="mt-2" aria-label="Qual espécie" placeholder="Informe a espécie" value={draft.species} onChange={(event) => set({ species: event.target.value })} /> : null}
                        </Field>
                    </div>
                    <div>
                        <span className="gx-label mb-1.5 block">Volumes para cubagem</span>
                        <VolumeRows rows={draft.rows} onChange={(rows) => set({ rows })} error={errors.cubage} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Field label="Peso">
                            <NumberInput decimal decimals={4} suffix="kg" value={draft.weight} onChange={(weight) => set({ weight })} aria-label="Peso" />
                        </Field>
                        <Field label="Cubagem" hint={calculated > 0 && draft.cubedManual == null ? 'Calculada pelas medidas. Digite aqui para trocar.' : 'Em m³. Vazio usa as medidas.'}>
                            <NumberInput decimal decimals={9} suffix="m³" value={draft.cubedManual} onChange={(cubedManual) => set({ cubedManual })} aria-label="Cubagem" placeholder={calculated > 0 ? String(calculated).replace('.', ',') : '0'} />
                        </Field>
                        <Field label="Valor da nota">
                            <MoneyInput value={draft.value} onChange={(value) => set({ value })} aria-label="Valor da nota" />
                        </Field>
                    </div>
                    <p className="gx-muted text-[12.5px]">{rowsTotalQty(draft.rows)} volume(s) no total.</p>
                </>
            )}
            <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={onCancel}>
                    Cancelar
                </Button>
                <Button variant="soft" onClick={onCommit}>
                    {commitLabel}
                </Button>
            </div>
        </div>
    );
};
