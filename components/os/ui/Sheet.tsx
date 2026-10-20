import React from 'react';
import { IconX } from './icons';

/** Folha inferior do TSM O.S.: título, conteúdo rolável e rodapé fixo com a ação. */
const OsSheet: React.FC<{
    title: string;
    subtitle?: string;
    onClose: () => void;
    footer?: React.ReactNode;
    children: React.ReactNode;
}> = ({ title, subtitle, onClose, footer, children }) => (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
        <div
            role="dialog"
            aria-label={title}
            className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-t-2xl bg-white dark:bg-tower-900"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="flex items-start justify-between gap-3 p-4 pb-2">
                <div className="min-w-0">
                    <p className="font-display text-[17px] font-bold text-tower-900 dark:text-white">{title}</p>
                    {subtitle ? <p className="text-[13px] text-tower-500 dark:text-tower-300">{subtitle}</p> : null}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tower-100 text-tower-600 active:bg-tower-200 dark:bg-tower-800 dark:text-tower-300"
                >
                    <IconX size={18} />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
            {footer ? (
                <div className="border-t border-tower-200 p-4 pb-[max(env(safe-area-inset-bottom),16px)] dark:border-tower-800">
                    {footer}
                </div>
            ) : null}
        </div>
    </div>
);

export default OsSheet;

/** Mensagem de erro de API legível (backend usa { error } ou { message }). */
export function apiErrorMessage(cause: unknown, fallback: string): string {
    const data = (cause as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
    return data?.error ?? data?.message ?? fallback;
}

export const osFieldClass =
    'h-[48px] w-full rounded-xl border-2 border-tower-200 bg-white px-3.5 text-[15px] text-tower-900 placeholder:text-tower-400 focus:border-brand-400 focus:outline-none dark:border-tower-600 dark:bg-tower-800 dark:text-white';
