import React, { useId, useState } from 'react';
import clsx from 'clsx';
import type { BrandingForDocuments, FreightDocType, FreightSuggestion } from '../../../../types/index';
import DactePrintPreview from '../../../ui/DactePrintPreview';
import { emitFreightDocument, type EmitOutcome } from '../../freightActions';
import { DOC_TYPE_LABEL, EMPTY_INFORMED, formatBRL, freightTableOptionLabel, freightTableOptions, parseInformed, pricingSourceLabel, type InformedForm } from '../../lib/freight';
import { OsActionBar, OsButton } from '../../ui/kit';
import FreightIssues from './FreightIssues';
import InformedFields from './InformedFields';
import CubageConfirmSheet from './CubageConfirmSheet';

const NO_TABLE = 'Sem tabela de preço';

function outcomeMessage(outcome: EmitOutcome): { tone: 'ok' | 'info' | 'bad'; text: string } {
    switch (outcome.kind) {
        case 'authorized':
            return { tone: 'ok', text: `${DOC_TYPE_LABEL[outcome.calc.documentType]} nº ${outcome.calc.cteNumber ?? outcome.calc.dceNumber ?? ''} autorizado.` };
        case 'sent':
            return { tone: 'info', text: 'Enviado à SEFAZ. A autorização aparece aqui em instantes.' };
        case 'minuta':
            return { tone: 'ok', text: `Minuta nº ${outcome.calc.minutaNumber ?? ''} emitida.` };
        case 'rejected':
            return { tone: 'bad', text: `Rejeitado: ${outcome.reason} Corrija e emita de novo.` };
        case 'already':
            return { tone: 'info', text: 'Este pedido já tem esse documento — nada foi duplicado.' };
        case 'blocked':
            return { tone: 'bad', text: `Pendências: ${[...outcome.issues, ...outcome.missingFields.map((f) => `falta ${f}`)].join(' ')}` };
        default:
            return { tone: 'bad', text: outcome.message };
    }
}

/**
 * Emitir o documento do frete: tipo (CT-e padrão; minuta sempre possível), valor da tabela ou
 * informado pelo hub, pendências com quem resolve, e a ação primária em um toque.
 */
const FreightComposer: React.FC<{
    orderId: string;
    suggestion: FreightSuggestion;
    newDocument: boolean;
    onEmitted: () => void;
    /** Pedido sem cubagem: emitir pede confirmação (o frete sai só pelo peso). */
    cubageMissing?: boolean;
    onInformCubage?: () => void;
}> = ({ orderId, suggestion, newDocument, onEmitted, cubageMissing = false, onInformCubage }) => {
    const [askCubage, setAskCubage] = useState(false);
    const tableOptions = freightTableOptions(suggestion);
    const tablePickerId = useId();
    const [docType, setDocType] = useState<FreightDocType>(suggestion.docs.recommended);
    const [selectedTableId, setSelectedTableId] = useState<string | null>(suggestion.pricing?.tableId ?? null);
    const [informedMode, setInformedMode] = useState(!suggestion.pricing && tableOptions.length === 0);
    const [showTablePicker, setShowTablePicker] = useState(!suggestion.pricing && tableOptions.length > 0);
    const [form, setForm] = useState<InformedForm>(EMPTY_INFORMED);
    const [reason, setReason] = useState('');
    const [tax, setTax] = useState({ cfop: '', cst: '' });
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'ok' | 'info' | 'bad'; text: string } | null>(null);
    const [print, setPrint] = useState<{ payload: unknown; branding: BrandingForDocuments | null } | null>(null);

    const informed = parseInformed(form);
    const selectedTable = tableOptions.find((option) => option.tableId === selectedTableId) ?? null;
    const total = informedMode ? informed.total : selectedTable?.total ?? 0;
    const issues =
        docType === suggestion.docs.recommended ? suggestion.blockers.filter((b) => !b.startsWith(NO_TABLE)) : [];
    const showTax = docType === 'CTE' && (suggestion.missingFields.includes('cfop') || suggestion.missingFields.includes('cst'));
    const blocking = issues.filter((i) => !(showTax && /CFOP|CST/.test(i)));
    const taxOk =
        !showTax ||
        ((!suggestion.missingFields.includes('cfop') || Boolean(tax.cfop)) && (!suggestion.missingFields.includes('cst') || Boolean(tax.cst)));
    const reasonOk = !informedMode || tableOptions.length === 0 || reason.trim().length > 0;
    const canEmit = total > 0 && blocking.length === 0 && taxOk && reasonOk && !busy;

    const requestEmit = () => {
        if (!canEmit) return;
        if (cubageMissing) setAskCubage(true);
        else void emit();
    };

    const emit = async () => {
        setAskCubage(false);
        if (!canEmit) return;
        setBusy(true);
        setMessage(null);
        const outcome = await emitFreightDocument(orderId, {
            documentType: docType,
            ...(informedMode
                ? { informed: informed.values, ...(tableOptions.length > 0 ? { reason: reason.trim() } : {}) }
                : { pricingTableId: selectedTable?.tableId }),
            newDocument,
            ...(showTax ? { tax } : {}),
        });
        setMessage(outcomeMessage(outcome));
        if (outcome.kind === 'minuta' && outcome.payload) setPrint({ payload: outcome.payload, branding: outcome.branding });
        setBusy(false);
        onEmitted();
    };

    return (
        <div>
            {suggestion.docs.allowed.length > 1 ? (
                <div className="grid grid-cols-2 rounded-xl border border-tower-200 bg-tower-100/70 p-1 dark:border-tower-700 dark:bg-tower-900">
                    {suggestion.docs.allowed.map((type) => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => setDocType(type)}
                            className={clsx(
                                'min-h-[40px] rounded-lg text-[13px] font-bold',
                                docType === type ? 'bg-white text-tower-900 shadow-sm dark:bg-tower-800 dark:text-white' : 'text-tower-500 dark:text-tower-400',
                            )}
                        >
                            {DOC_TYPE_LABEL[type]}
                        </button>
                    ))}
                </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                {informedMode ? (
                    <p className="text-[13px] font-bold text-tower-600 dark:text-tower-300">Frete informado pelo hub</p>
                ) : selectedTable ? (
                    <>
                        <p className="text-[12px] font-semibold text-tower-500 dark:text-tower-400">
                            {selectedTable.tableId === suggestion.pricing?.tableId ? 'Tabela recomendada' : 'Tabela selecionada'}
                        </p>
                        <p className="font-display text-[26px] font-extrabold text-tower-900 dark:text-white">{formatBRL(total)}</p>
                        <p className="text-[12px] text-tower-500 dark:text-tower-400">
                            {pricingSourceLabel({ source: selectedTable.source, tableLabel: selectedTable.label })}
                        </p>
                        {selectedTable.routeLabel ? <p className="mt-1 text-[12px] text-tower-500 dark:text-tower-400">{selectedTable.routeLabel}</p> : null}
                    </>
                ) : (
                    <p className="text-[13px] font-bold text-tower-600 dark:text-tower-300">Escolha a tabela deste frete.</p>
                )}
                {suggestion.routeSource === 'uf_fallback' ? (
                    <p className="mt-2 text-[12px] font-semibold text-amber-700 dark:text-amber-300">rota pela UF do destino — confira</p>
                ) : null}
                {tableOptions.length === 0 && suggestion.noPricingReason ? (
                    <p className="mt-2 text-[13px] leading-relaxed text-tower-500 dark:text-tower-400">{suggestion.noPricingReason}</p>
                ) : null}
                {informedMode ? <InformedFields value={form} onChange={setForm} reason={reason} onReason={setReason} requireReason={tableOptions.length > 0} /> : null}
                {tableOptions.length > 0 ? (
                    <>
                        <button
                            type="button"
                            onClick={() => setShowTablePicker((value) => !value)}
                            aria-expanded={showTablePicker}
                            aria-controls={tablePickerId}
                            className="mt-2 min-h-[48px] rounded-lg text-[13px] font-bold text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-brand-300"
                        >
                            Trocar tabela
                        </button>
                        {showTablePicker ? (
                            <div id={tablePickerId} role="group" aria-label="Tabela do frete" className="border-t border-tower-200 pt-1 dark:border-tower-700">
                                {tableOptions.map((option) => (
                                    <button
                                        key={option.tableId}
                                        type="button"
                                        aria-pressed={!informedMode && selectedTableId === option.tableId}
                                        onClick={() => {
                                            setSelectedTableId(option.tableId);
                                            setInformedMode(false);
                                            setShowTablePicker(false);
                                        }}
                                        className={clsx(
                                            'mt-1 min-h-[48px] w-full rounded-lg px-2 py-3 text-left text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-brand-500',
                                            !informedMode && selectedTableId === option.tableId
                                                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                                                : 'text-tower-700 active:bg-tower-100 dark:text-tower-200 dark:active:bg-tower-800',
                                        )}
                                    >
                                        {freightTableOptionLabel(option)}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    aria-pressed={informedMode}
                                    onClick={() => {
                                        setInformedMode(true);
                                        setShowTablePicker(false);
                                    }}
                                    className="mt-1 min-h-[48px] w-full rounded-lg px-2 py-3 text-left text-[13px] font-bold text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-brand-300"
                                >
                                    Informar outro valor
                                </button>
                            </div>
                        ) : null}
                    </>
                ) : null}
            </div>

            <FreightIssues suggestion={suggestion} issues={issues} tax={tax} onTax={setTax} showTax={showTax} onPartyEdited={onEmitted} />

            {message ? (
                <p
                    className={clsx(
                        'mt-3 rounded-xl border-l-4 p-3 text-[13px] font-semibold',
                        message.tone === 'bad' && 'border-brand-red-500 bg-brand-red-500/8 text-brand-red-700 dark:text-brand-red-400',
                        message.tone === 'ok' && 'border-emerald-500 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300',
                        message.tone === 'info' && 'border-brand-500 bg-brand-500/8 text-brand-700 dark:text-brand-200',
                    )}
                >
                    {message.text}
                </p>
            ) : null}

            <OsActionBar>
                <OsButton full disabled={!canEmit} onClick={requestEmit}>
                    {busy ? 'Emitindo…' : `Emitir ${DOC_TYPE_LABEL[docType]}${total > 0 ? ` · ${formatBRL(total)}` : ''}`}
                </OsButton>
                {!canEmit && !busy && blocking.length > 0 ? (
                    <p className="mt-1.5 text-center text-[12px] font-semibold text-tower-500">Resolva as pendências acima para emitir.</p>
                ) : null}
            </OsActionBar>
            {askCubage ? (
                <CubageConfirmSheet
                    title="Emitir sem a cubagem?"
                    body="O frete será calculado só pelo peso."
                    proceedLabel="Emitir sem cubagem"
                    onInform={() => {
                        setAskCubage(false);
                        onInformCubage?.();
                    }}
                    onProceed={() => void emit()}
                    onClose={() => setAskCubage(false)}
                />
            ) : null}
            {print ? <DactePrintPreview payload={print.payload} branding={print.branding} onClose={() => setPrint(null)} /> : null}
        </div>
    );
};

export default FreightComposer;
