import React from 'react';
import clsx from 'clsx';

/**
 * Kit de UI do TSM O.S. — mobile-first, alvos de toque ≥ 44px, tema claro/escuro.
 * Único lugar de primitives do módulo; páginas não importam nada do app legado.
 */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
    primary:
        'bg-accent-600 text-white active:bg-accent-500 disabled:bg-tower-300 disabled:text-tower-500 dark:disabled:bg-tower-700 dark:disabled:text-tower-400',
    secondary:
        'border border-tower-300 bg-white text-tower-800 active:bg-tower-100 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100 dark:active:bg-tower-700',
    danger: 'bg-red-600 text-white active:bg-red-500 disabled:bg-tower-300 disabled:text-tower-500',
    ghost: 'text-accent-600 active:bg-tower-100 dark:text-accent-400 dark:active:bg-tower-800',
};

export const OsButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; full?: boolean }
> = ({ variant = 'primary', full = false, className, children, ...props }) => (
    <button
        {...props}
        className={clsx(
            'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-colors',
            BUTTON_STYLES[variant],
            full && 'w-full',
            className,
        )}
    >
        {children}
    </button>
);

export const OsCard: React.FC<React.HTMLAttributes<HTMLDivElement> & { as?: 'div' | 'button' }> = ({
    className,
    children,
    ...props
}) => (
    <div
        {...props}
        className={clsx(
            'rounded-2xl border border-tower-200 bg-white p-4 dark:border-tower-700 dark:bg-tower-900',
            props.onClick && 'cursor-pointer active:bg-tower-50 dark:active:bg-tower-800',
            className,
        )}
    >
        {children}
    </div>
);

export const OsBadge: React.FC<{ tone?: 'neutral' | 'ok' | 'warn' | 'bad'; children: React.ReactNode }> = ({
    tone = 'neutral',
    children,
}) => (
    <span
        className={clsx(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
            tone === 'neutral' && 'bg-tower-100 text-tower-700 dark:bg-tower-800 dark:text-tower-200',
            tone === 'ok' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
            tone === 'warn' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
            tone === 'bad' && 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
        )}
    >
        {children}
    </span>
);

export const OsSectionTitle: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({
    children,
    action,
}) => (
    <div className="mb-2 mt-5 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-tower-500 dark:text-tower-300">{children}</h2>
        {action}
    </div>
);

export const OsStatTile: React.FC<{
    label: string;
    value: React.ReactNode;
    hint?: string;
    onClick?: () => void;
}> = ({ label, value, hint, onClick }) => (
    <OsCard onClick={onClick} className="flex min-h-[88px] flex-col justify-between !p-3">
        <span className="text-xs font-semibold text-tower-500 dark:text-tower-300">{label}</span>
        <span className="font-display text-2xl font-bold text-tower-900 dark:text-white">{value}</span>
        {hint ? <span className="text-[11px] text-tower-400 dark:text-tower-400">{hint}</span> : null}
    </OsCard>
);

export const OsEmpty: React.FC<{ title: string; detail?: string }> = ({ title, detail }) => (
    <div className="rounded-2xl border border-dashed border-tower-300 p-6 text-center dark:border-tower-600">
        <p className="font-semibold text-tower-600 dark:text-tower-200">{title}</p>
        {detail ? <p className="mt-1 text-sm text-tower-400 dark:text-tower-400">{detail}</p> : null}
    </div>
);

export const OsSpinner: React.FC<{ label?: string }> = ({ label }) => (
    <div className="flex flex-col items-center gap-3 py-10 text-tower-500 dark:text-tower-300">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-tower-200 border-t-accent-600 dark:border-tower-700 dark:border-t-accent-400" />
        {label ? <span className="text-sm">{label}</span> : null}
    </div>
);

export const OsErrorNotice: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <p>{message}</p>
        {onRetry ? (
            <OsButton variant="secondary" className="mt-3 min-h-[40px]" onClick={onRetry}>
                Tentar de novo
            </OsButton>
        ) : null}
    </div>
);

/** Barra fixa inferior com a ação primária da tela (polegar alcança). */
export const OsActionBar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="pointer-events-none fixed inset-x-0 bottom-[68px] z-30 px-4 pb-2">
        <div className="pointer-events-auto mx-auto max-w-xl">{children}</div>
    </div>
);
