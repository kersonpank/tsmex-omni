import React, { useState } from 'react';
import { ordersEntradaApi } from '../../../../lib/api';
import type { FreightSuggestion } from '../../../../types/index';
import { FREIGHT_TERM_LABEL } from '../../lib/freight';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage } from '../../ui/Sheet';
import PayerChoice, { type PayerTerm } from '../entry/PayerChoice';

/**
 * Quem paga o frete (tomador do CT-e). Troca enquanto o pedido não tem fatura nem CT-e emitido
 * com o pagador atual — o servidor confere e registra quem trocou.
 */
const PayerRow: React.FC<{ orderId: string; suggestion: FreightSuggestion; onChanged: () => void }> = ({ orderId, suggestion, onChanged }) => {
    const [open, setOpen] = useState(false);
    const [term, setTerm] = useState<PayerTerm | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const current = suggestion.freightTerm === 'FOB' ? 'FOB' : suggestion.freightTerm === 'CIF' ? 'CIF' : null;

    const save = async () => {
        if (!term || term === current) {
            setOpen(false);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await ordersEntradaApi.updatePeople(orderId, { freightTerm: term });
            setOpen(false);
            onChanged();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível trocar o pagador.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <div className="min-w-0">
                <p className="text-[12px] font-semibold text-tower-500 dark:text-tower-400">{FREIGHT_TERM_LABEL[suggestion.freightTerm]}</p>
                <p className="truncate text-[15px] font-semibold text-tower-900 dark:text-white">{suggestion.payer?.name ?? 'Pagador sem cadastro'}</p>
                {suggestion.payer && !suggestion.payer.isClient ? (
                    <p className="text-[12px] text-tower-400">ainda não é cliente: a fatura se resolve na torre</p>
                ) : null}
                {!suggestion.payerChange.allowed && suggestion.payerChange.reason ? (
                    <p className="mt-1 text-[12px] text-tower-400">{suggestion.payerChange.reason}</p>
                ) : null}
            </div>
            {suggestion.payerChange.allowed ? (
                <button
                    type="button"
                    onClick={() => {
                        setTerm(current);
                        setError(null);
                        setOpen(true);
                    }}
                    className="min-h-[40px] shrink-0 text-[13px] font-bold text-brand-600 dark:text-brand-300"
                >
                    Trocar
                </button>
            ) : null}
            {open ? (
                <OsSheet
                    title="Quem paga o frete?"
                    subtitle="Vale para o CT-e e para a fatura deste pedido."
                    onClose={() => setOpen(false)}
                    footer={
                        <>
                            {error ? <p className="mb-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
                            <OsButton full disabled={!term || busy} onClick={() => void save()}>
                                {busy ? 'Salvando…' : 'Confirmar'}
                            </OsButton>
                        </>
                    }
                >
                    <PayerChoice
                        value={term}
                        onChange={setTerm}
                        remetenteName={suggestion.parties.remetente?.legalName}
                        destinatarioName={suggestion.parties.destinatario?.legalName}
                    />
                </OsSheet>
            ) : null}
        </div>
    );
};

export default PayerRow;
