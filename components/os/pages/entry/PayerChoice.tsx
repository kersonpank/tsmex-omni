import React from 'react';
import clsx from 'clsx';

export type PayerTerm = 'CIF' | 'FOB';

/**
 * "Quem paga o frete?" — remetente (CIF) ou destinatário (FOB). Vem marcado quando a NF-e
 * diz (modFrete); senão o operador escolhe. É o tomador do CT-e e quem será faturado.
 */
const PayerChoice: React.FC<{
    value: PayerTerm | null;
    onChange: (term: PayerTerm) => void;
    remetenteName?: string | null;
    destinatarioName?: string | null;
    sourceLabel?: string | null;
    disabled?: boolean;
}> = ({ value, onChange, remetenteName, destinatarioName, sourceLabel, disabled }) => {
    const option = (term: PayerTerm, title: string, name?: string | null) => (
        <button
            type="button"
            disabled={disabled}
            aria-pressed={value === term}
            onClick={() => onChange(term)}
            className={clsx(
                'min-h-[56px] min-w-0 flex-1 rounded-xl border-2 px-3 py-2 text-left transition-colors disabled:opacity-60',
                value === term
                    ? 'border-brand-500 bg-brand-500/8 dark:border-brand-300 dark:bg-brand-500/15'
                    : 'border-tower-200 active:bg-tower-50 dark:border-tower-700 dark:active:bg-tower-800',
            )}
        >
            <span className="block text-[14px] font-bold text-tower-900 dark:text-white">{title}</span>
            <span className="block truncate text-[12px] text-tower-500 dark:text-tower-400">{name || '—'}</span>
        </button>
    );

    return (
        <div className="mt-4">
            <p className="mb-1.5 text-[13px] font-bold text-tower-600 dark:text-tower-300">
                Quem paga o frete?
                {sourceLabel ? <span className="ml-2 text-[12px] font-normal text-emerald-700 dark:text-emerald-400">{sourceLabel}</span> : null}
            </p>
            <div className="flex gap-2">
                {option('CIF', 'Remetente', remetenteName)}
                {option('FOB', 'Destinatário', destinatarioName)}
            </div>
        </div>
    );
};

export default PayerChoice;
