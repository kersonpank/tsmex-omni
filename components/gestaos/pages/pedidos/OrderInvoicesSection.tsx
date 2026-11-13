import React, { useState } from 'react';
import { nfSpeciesApi } from '../../../../lib/api';
import type { NfSpecies } from '../../../../types/index';
import { applyLookupToDraft, invoiceCubage, invoicePendencies, invoiceTotals, newInvoiceDraft, rowsTotalQty, validateInvoice, type InvoiceDraft, type InvoiceErrors } from '../../lib/pedidoForm';
import { money } from '../../lib/format';
import { useResource } from '../../lib/resource';
import { FormSection } from '../../ui/form';
import { Button, ModeBadge, Pill, TextInput } from '../../ui/kit';
import { InvoiceEditor } from './InvoiceEditor';
import { isChave, runNfeCopilot, type NfeCopilotResult } from './nfeCopilot';

const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

interface Props {
    invoices: InvoiceDraft[];
    onChange: (invoices: InvoiceDraft[]) => void;
    /** Hub usado na consulta da NF-e (distribuição). */
    hubId: string | null;
    /** Chamado com o resultado da consulta para o formulário preencher as pessoas. */
    onLookup: (result: NfeCopilotResult) => void;
    /** Pedido já existe (edição): notas gravadas ficam na lista e só mudam por PATCH. */
    editing: boolean;
}

export const OrderInvoicesSection: React.FC<Props> = ({ invoices, onChange, hubId, onLookup, editing }) => {
    const species = useResource<NfSpecies[]>('nf-species:active', async () => (await nfSpeciesApi.list({ active: true })).data ?? [], { staleMs: 300_000 });
    const [chave, setChave] = useState('');
    const [looking, setLooking] = useState(false);
    const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; lines: string[] } | null>(null);
    const [draft, setDraft] = useState<InvoiceDraft | null>(null);
    const [errors, setErrors] = useState<InvoiceErrors>({});

    const totals = invoiceTotals(invoices);
    const pending = invoicePendencies(invoices);

    const openNew = (type: 'NFE' | 'OUTRAS' = 'NFE') => {
        setDraft(newInvoiceDraft(type));
        setErrors({});
    };

    const search = async () => {
        const digits = chave.replace(/\D/g, '');
        if (!isChave(digits)) {
            setNotice({ tone: 'warn', lines: ['A chave da NF-e tem 44 dígitos.'] });
            return;
        }
        if (invoices.some((invoice) => invoice.nfKey === digits)) {
            setNotice({ tone: 'warn', lines: ['Esta NF já está na lista.'] });
            return;
        }
        setLooking(true);
        setNotice(null);
        try {
            const result = await runNfeCopilot(digits, hubId);
            onLookup(result);
            setDraft(applyLookupToDraft(newInvoiceDraft('NFE'), { chave: result.lookup.chave, numero: result.lookup.numero, emissionDate: result.lookup.emissionDate }));
            setErrors({});
            setChave('');
            setNotice({
                tone: result.notes.length ? 'warn' : 'ok',
                lines: [`NF ${result.lookup.numero} lida.${result.remetente ? ` Remetente: ${result.remetente.legalName}.` : ''}${result.destinatario ? ` Destinatário: ${result.destinatario.legalName}.` : ''}`, ...result.notes],
            });
        } catch (cause) {
            setNotice({ tone: 'warn', lines: [cause instanceof Error ? cause.message : 'Não foi possível consultar a NF-e.'] });
        } finally {
            setLooking(false);
        }
    };

    const commit = () => {
        if (!draft) return;
        const found = validateInvoice(draft);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        const exists = invoices.some((invoice) => invoice.key === draft.key);
        onChange(exists ? invoices.map((invoice) => (invoice.key === draft.key ? { ...draft, touched: draft.id ? true : draft.touched } : invoice)) : [...invoices, draft]);
        setDraft(null);
    };

    return (
        <FormSection title="Notas fiscais" hint="Quantas notas forem necessárias para o mesmo remetente e destinatário." cols={1}>
            {!draft ? (
                <div className="gx-inset flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <ModeBadge mode="copilot" />
                        <span className="gx-soft text-[13.5px]">Cole a chave da NF-e: o sistema lê número, emissão e as pessoas da nota. Volumes, peso e valor você copia da DANFE.</span>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <TextInput
                            className="gx-mono flex-1"
                            inputMode="numeric"
                            maxLength={44}
                            aria-label="Chave da NF-e"
                            placeholder="Chave de 44 dígitos"
                            value={chave}
                            onChange={(event) => setChave(event.target.value.replace(/\D/g, '').slice(0, 44))}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void search();
                                }
                            }}
                        />
                        <Button variant="soft" loading={looking} disabled={chave.length !== 44} onClick={() => void search()}>
                            Buscar NF-e
                        </Button>
                    </div>
                    <span className="gx-muted text-[12.5px]">{chave.length} de 44 dígitos</span>
                    {notice ? (
                        <div role="status" className={notice.tone === 'warn' ? 'gx-yellow-text' : 'gx-soft'}>
                            {notice.lines.map((line) => (
                                <p key={line} className="text-[13px]">
                                    {line}
                                </p>
                            ))}
                        </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openNew('NFE')}>
                            Digitar nota à mão
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openNew('OUTRAS')}>
                            Declaração sem NF
                        </Button>
                    </div>
                </div>
            ) : (
                <InvoiceEditor
                    draft={draft}
                    errors={errors}
                    species={species.data ?? []}
                    onChange={(next) => setDraft(next)}
                    onCommit={commit}
                    onCancel={() => setDraft(null)}
                    commitLabel={draft.id ? 'Atualizar nota' : 'Adicionar à lista'}
                />
            )}

            {invoices.length > 0 ? (
                <div className="gx-scroll-x">
                    <table className="gx-table" aria-label="Notas do pedido">
                        <thead>
                            <tr>
                                <th>Número</th>
                                <th>Emissão</th>
                                <th>Espécie</th>
                                <th className="text-right">Vol.</th>
                                <th className="text-right">Peso</th>
                                <th className="text-right">Cubagem</th>
                                <th className="text-right">Valor</th>
                                <th>Situação</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map((invoice) => {
                                const cubage = invoiceCubage(invoice);
                                return (
                                    <tr key={invoice.key}>
                                        <td className="gx-mono whitespace-nowrap">{invoice.nfNumber || invoice.nfKey.slice(-8) || (invoice.type === 'OUTRAS' ? 'Declaração' : '—')}</td>
                                        <td className="whitespace-nowrap">{invoice.emissionDate ? invoice.emissionDate : '—'}</td>
                                        <td>{invoice.species || '—'}</td>
                                        <td className="gx-num text-right">{rowsTotalQty(invoice.rows)}</td>
                                        <td className="gx-num whitespace-nowrap text-right">{invoice.weight ? `${NUM.format(invoice.weight)} kg` : '—'}</td>
                                        <td className="gx-num whitespace-nowrap text-right">{cubage > 0 ? `${NUM.format(cubage)} m³` : '—'}</td>
                                        <td className="gx-num whitespace-nowrap text-right">{invoice.value ? money(invoice.value) : '—'}</td>
                                        <td>
                                            {invoice.id && !invoice.touched ? <Pill>Gravada</Pill> : <Pill tone="royal">{invoice.id ? 'Alterada' : 'A gravar'}</Pill>}
                                        </td>
                                        <td className="whitespace-nowrap text-right">
                                            <Button size="sm" variant="ghost" aria-label={`Editar nota ${invoice.nfNumber}`} onClick={() => { setDraft(invoice); setErrors({}); }}>
                                                Editar
                                            </Button>
                                            {!invoice.id ? (
                                                <Button size="sm" variant="ghost" aria-label={`Remover nota ${invoice.nfNumber}`} onClick={() => onChange(invoices.filter((item) => item.key !== invoice.key))}>
                                                    Remover
                                                </Button>
                                            ) : null}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan={3} className="gx-label">
                                    Total de {totals.count} nota(s)
                                </td>
                                <td className="gx-num text-right">{totals.volumes}</td>
                                <td className="gx-num whitespace-nowrap text-right">{NUM.format(totals.weight)} kg</td>
                                <td className="gx-num whitespace-nowrap text-right">{totals.cubage > 0 ? `${NUM.format(totals.cubage)} m³` : '—'}</td>
                                <td className="gx-num whitespace-nowrap text-right">{money(totals.value)}</td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            ) : (
                <p className="gx-muted text-[13.5px]">{editing ? 'Este pedido ainda não tem notas.' : 'Nenhuma nota na lista. O pedido pode ser criado sem nota e completado depois.'}</p>
            )}
            {pending.length > 0 ? (
                <p className="gx-yellow-text text-[13px]">
                    Dados pendentes nas notas: {pending.join('; ')}. A cubagem afeta capacidade e frete; a espécie descreve a carga. Nenhuma medida é presumida.
                </p>
            ) : null}
        </FormSection>
    );
};
