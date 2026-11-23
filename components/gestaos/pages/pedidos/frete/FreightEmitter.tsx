import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CTE_CFOP_SELECT_OPTIONS, CTE_CST_SELECT_OPTIONS, cfopOptionSelectText } from '../../../../../lib/cteTaxCatalog';
import type { BrandingForDocuments, FreightDocType, FreightSuggestion } from '../../../../../types/index';
import { emitFreightDocument } from '../../../../os/freightActions';
import { blockerAction, freightTableOptionLabel, freightTableOptions, INFORMED_FIELDS, parseInformed, pricingSourceLabel } from '../../../../os/lib/freight';
import {
    buildEmitOptions,
    DOC_TYPE_LABEL,
    EMPTY_INFORMED,
    emitReadiness,
    isFailedOutcome,
    outcomeNotice,
    type InformedForm,
    type Notice,
} from '../../../lib/freteDoc';
import { money } from '../../../lib/format';
import { Button, Chip, Field, SelectInput, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { FreightNotice } from './FreightNotice';

const INFORMED_VALUE = '__informed__';

export interface PrintRequest {
    payload: unknown;
    branding: BrandingForDocuments | null;
}

/**
 * Emitir o documento do frete: tipo (o recomendado já vem marcado), valor da tabela ou informado,
 * pendências com quem resolve e a ação primária. Ordem das chamadas = O.S.: prepara sem duplicar,
 * grava CFOP/CST escolhidos, emite pelo endpoint do tipo (`emitFreightDocument`).
 */
export const FreightEmitter: React.FC<{
    orderId: string;
    suggestion: FreightSuggestion;
    /** Já existe documento: a emissão seguinte é de OUTRO documento. */
    newDocument: boolean;
    /** Pedido sem cubagem: emitir pede confirmação (o frete sai só pelo peso). */
    cubageMissing: boolean;
    onEmitted: () => void;
    onPrint: (request: PrintRequest) => void;
}> = ({ orderId, suggestion, newDocument, cubageMissing, onEmitted, onPrint }) => {
    const options = freightTableOptions(suggestion);
    const { busy, run } = useAction();
    const [docType, setDocType] = useState<FreightDocType>(suggestion.docs.recommended);
    const [tableId, setTableId] = useState<string | null>(suggestion.pricing?.tableId ?? null);
    const [informedMode, setInformedMode] = useState(!suggestion.pricing && options.length === 0);
    const [form, setForm] = useState<InformedForm>(EMPTY_INFORMED);
    const [reason, setReason] = useState('');
    const [tax, setTax] = useState({ cfop: '', cst: '' });
    const [askCubage, setAskCubage] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);

    const selected = options.find((option) => option.tableId === tableId) ?? null;
    const state = { docType, informedMode, tableId, form, reason, tax, newDocument };
    const readiness = emitReadiness(suggestion, state, { tableTotal: selected?.total ?? 0, tableCount: options.length, busy: busy !== null });
    const informedTotal = parseInformed(form).total;

    const emit = async () => {
        setAskCubage(false);
        if (!readiness.canEmit) return;
        setNotice(null);
        const request = buildEmitOptions(state, readiness, options.length);
        await run(
            'emit',
            async () => {
                const outcome = await emitFreightDocument(orderId, request);
                const result = outcomeNotice(outcome);
                setNotice(result);
                if (outcome.kind === 'minuta' && outcome.payload) onPrint({ payload: outcome.payload, branding: outcome.branding });
                if (isFailedOutcome(outcome)) throw new Error(result.text);
            },
            { success: 'Emissão registrada.', error: 'Emissão não concluída.' },
        );
        onEmitted();
    };

    const requestEmit = () => {
        if (!readiness.canEmit) return;
        if (cubageMissing) setAskCubage(true);
        else void emit();
    };

    const visibleIssues = readiness.issues.filter((issue) => !/CFOP|CST/.test(issue) || !readiness.showTax || /^SEFAZ (519|524|908):/.test(issue));
    const emitting = busy === 'emit';

    return (
        <div className="flex flex-col gap-4">
            {suggestion.docs.allowed.length > 1 ? (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de documento">
                    {suggestion.docs.allowed.map((type) => (
                        <Chip key={type} active={docType === type} onClick={() => setDocType(type)}>
                            {DOC_TYPE_LABEL[type]}
                            {type === suggestion.docs.recommended ? ' (sugerido)' : ''}
                        </Chip>
                    ))}
                </div>
            ) : null}

            <div className="gx-inset flex flex-col gap-3 px-4 py-3.5">
                <h4 className="gx-label">Valor do frete</h4>
                {informedMode ? (
                    <>
                        <p className="gx-soft text-[13.5px]">Frete informado por você, componente a componente.</p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {INFORMED_FIELDS.map((field) => (
                                <Field key={field.key} label={`${field.label} (R$)`}>
                                    <TextInput inputMode="decimal" placeholder="0,00" value={form[field.key]} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} />
                                </Field>
                            ))}
                        </div>
                        <p className="text-right text-[15px] font-semibold">Total {money(informedTotal)}</p>
                        {options.length > 0 ? (
                            <Field label="Motivo para não usar a tabela" hint="Fica no histórico do pedido.">
                                <TextInput value={reason} maxLength={500} placeholder="Ex.: negociado com o cliente" onChange={(event) => setReason(event.target.value)} />
                            </Field>
                        ) : null}
                    </>
                ) : selected ? (
                    <div>
                        <p className="gx-num text-[26px]">{money(selected.total)}</p>
                        <p className="gx-soft text-[13px]">{pricingSourceLabel({ source: selected.source, tableLabel: selected.label })}</p>
                        {selected.routeLabel ? <p className="gx-muted text-[13px]">{selected.routeLabel}</p> : null}
                    </div>
                ) : options.length > 0 ? (
                    <p className="gx-soft text-[13.5px]">Escolha a tabela deste frete.</p>
                ) : (
                    <p className="gx-soft text-[13.5px]">{suggestion.noPricingReason ?? 'Sem tabela de preço para este pedido: informe o valor do frete.'}</p>
                )}
                {suggestion.routeSource === 'uf_fallback' ? <p className="gx-yellow-text text-[13px] font-medium">Atenção: rota pela UF do destino — confira.</p> : null}
                {options.length > 0 ? (
                    <Field label="Tabela de preço">
                        <SelectInput
                            value={informedMode ? INFORMED_VALUE : tableId ?? ''}
                            onChange={(event) => {
                                if (event.target.value === INFORMED_VALUE) setInformedMode(true);
                                else {
                                    setTableId(event.target.value);
                                    setInformedMode(false);
                                }
                            }}
                        >
                            {!informedMode && !selected ? <option value="">Escolha a tabela deste frete</option> : null}
                            {options.map((option) => (
                                <option key={option.tableId} value={option.tableId}>
                                    {freightTableOptionLabel(option)}
                                </option>
                            ))}
                            <option value={INFORMED_VALUE}>Informar outro valor</option>
                        </SelectInput>
                    </Field>
                ) : informedMode ? null : (
                    <Button size="sm" variant="soft" onClick={() => setInformedMode(true)}>
                        Informar o valor
                    </Button>
                )}
            </div>

            {visibleIssues.length > 0 || readiness.showTax ? (
                <div className="gx-inset flex flex-col gap-3 px-4 py-3.5" role="group" aria-label="Antes de emitir">
                    <h4 className="gx-label gx-yellow-text">Antes de emitir</h4>
                    <ul className="flex flex-col gap-2">
                        {visibleIssues.map((issue) => {
                            const action = blockerAction(issue, suggestion.payer?.role ?? null);
                            return (
                                <li key={issue} className="text-[13.5px]">
                                    {issue}
                                    {action && action !== 'tower' ? (
                                        <Link to={`/gestaos/pedidos/${orderId}/editar`} className="gx-royal-text ml-2 font-semibold underline">
                                            Completar cadastro no pedido
                                        </Link>
                                    ) : action === 'tower' ? (
                                        <span className="gx-muted ml-2 text-[12.5px]">(a torre resolve em Sistema)</span>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                    {readiness.showTax ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="CFOP">
                                <SelectInput value={tax.cfop} onChange={(event) => setTax({ ...tax, cfop: event.target.value })}>
                                    <option value="">Escolha o CFOP</option>
                                    {CTE_CFOP_SELECT_OPTIONS.map((option) => (
                                        <option key={option.code} value={option.code} title={option.labelFull}>
                                            {cfopOptionSelectText(option)}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                            <Field label="CST do ICMS">
                                <SelectInput value={tax.cst} onChange={(event) => setTax({ ...tax, cst: event.target.value })}>
                                    <option value="">Escolha o CST</option>
                                    {CTE_CST_SELECT_OPTIONS.map((option) => (
                                        <option key={option.code} value={option.code}>
                                            {option.code} | {option.label}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                        </div>
                    ) : null}
                </div>
            ) : null}

            <FreightNotice notice={notice} />

            {askCubage ? (
                <div className="gx-inset flex flex-col gap-3 px-4 py-3.5" role="group" aria-label="Emitir sem a cubagem?">
                    <p className="font-semibold">Emitir sem a cubagem?</p>
                    <p className="gx-soft text-[13.5px]">O frete será calculado só pelo peso.</p>
                    <div className="flex flex-wrap gap-2">
                        <Link to={`/gestaos/pedidos/${orderId}/editar`} className="gx-btn gx-btn-primary">
                            Informar cubagem
                        </Link>
                        <Button variant="soft" onClick={() => void emit()}>
                            Emitir sem cubagem
                        </Button>
                        <Button onClick={() => setAskCubage(false)}>Voltar</Button>
                    </div>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" loading={emitting} disabled={!readiness.canEmit || askCubage} onClick={requestEmit}>
                    {emitting ? 'Emitindo…' : `Emitir ${DOC_TYPE_LABEL[docType]}${readiness.total > 0 ? ` · ${money(readiness.total)}` : ''}`}
                </Button>
                {!readiness.canEmit && !emitting && readiness.blocking.length > 0 ? <p className="gx-muted text-[13px]">Resolva as pendências acima para emitir.</p> : null}
            </div>
        </div>
    );
};
