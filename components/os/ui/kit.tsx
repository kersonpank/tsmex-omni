import React from 'react';
import clsx from 'clsx';
import { IconChevron } from './icons';

/**
 * Kit de UI do TSM O.S. — linguagem de doca: a ação primária é a "faixa amarela"
 * (#FFD400, texto quase-preto, legível sob sol), filas são etiquetas com borda de
 * status, números são placar de galpão (Syne). Alvos ≥ 48px, claro/escuro.
 * Único lugar de primitives do módulo; páginas não importam nada do app legado.
 */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
    // A faixa: amarelo da marca com texto brand-950 — contraste ~13:1, não existe "primary azul" aqui.
    primary:
        'bg-brand-yellow-400 text-brand-950 shadow-[0_2px_0_0_var(--color-brand-yellow-500)] active:translate-y-[1px] active:shadow-none active:bg-brand-yellow-500 disabled:bg-tower-200 disabled:text-tower-400 disabled:shadow-none dark:disabled:bg-tower-800 dark:disabled:text-tower-500',
    secondary:
        'border-2 border-tower-300 bg-white text-tower-800 active:bg-tower-100 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100 dark:active:bg-tower-800',
    danger:
        'bg-brand-red-500 text-white active:bg-brand-red-600 disabled:bg-tower-200 disabled:text-tower-400',
    ghost: 'text-brand-600 active:bg-tower-100 dark:text-brand-300 dark:active:bg-tower-800',
};

export const OsButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; full?: boolean }
> = ({ variant = 'primary', full = false, className, children, ...props }) => (
    <button
        {...props}
        className={clsx(
            'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-bold transition-[background-color,transform,box-shadow] duration-100',
            BUTTON_STYLES[variant],
            full && 'w-full',
            className,
        )}
    >
        {children}
    </button>
);

export const OsCard: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => (
    <div
        {...props}
        className={clsx(
            'rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-700/70 dark:bg-tower-900',
            props.onClick && 'cursor-pointer active:bg-tower-50 dark:active:bg-tower-800',
            className,
        )}
    >
        {children}
    </div>
);

export type RowTone = 'route' | 'attention' | 'ok' | 'bad' | 'none';

const ROW_EDGE: Record<RowTone, string> = {
    route: 'border-l-brand-500',
    attention: 'border-l-brand-yellow-400',
    ok: 'border-l-emerald-500',
    bad: 'border-l-brand-red-500',
    none: 'border-l-transparent',
};

/** Item de fila — etiqueta de doca: borda-esquerda espessa diz o estado antes do texto. */
export const OsRow: React.FC<{
    tone?: RowTone;
    onClick?: () => void;
    chevron?: boolean;
    children: React.ReactNode;
    className?: string;
}> = ({ tone = 'none', onClick, chevron = Boolean(onClick), children, className }) => (
    <div
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
        className={clsx(
            'flex min-h-[64px] items-center gap-3 rounded-r-xl border border-l-4 border-tower-200 bg-white py-3 pl-3 pr-2 dark:border-tower-700/70 dark:bg-tower-900',
            ROW_EDGE[tone],
            onClick &&
                'cursor-pointer active:bg-tower-50 focus-visible:outline-2 focus-visible:outline-brand-500 dark:active:bg-tower-800',
            className,
        )}
    >
        <div className="min-w-0 flex-1">{children}</div>
        {chevron ? <IconChevron className="shrink-0 text-tower-300 dark:text-tower-500" /> : null}
    </div>
);

export const OsBadge: React.FC<{ tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'route'; children: React.ReactNode }> = ({
    tone = 'neutral',
    children,
}) => (
    <span
        className={clsx(
            'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-bold',
            tone === 'neutral' && 'bg-tower-100 text-tower-600 dark:bg-tower-800 dark:text-tower-300',
            tone === 'ok' && 'bg-emerald-600/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
            tone === 'warn' && 'bg-brand-yellow-400/25 text-[#6b5900] dark:bg-brand-yellow-400/15 dark:text-brand-yellow-400',
            tone === 'bad' && 'bg-brand-red-500/12 text-brand-red-600 dark:bg-brand-red-500/20 dark:text-brand-red-400',
            tone === 'route' && 'bg-brand-500/12 text-brand-600 dark:bg-brand-500/25 dark:text-brand-300',
        )}
    >
        {children}
    </span>
);

export const OsSectionTitle: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({
    children,
    action,
}) => (
    <div className="mb-2.5 mt-6 flex items-baseline justify-between first:mt-2">
        <h2 className="font-display text-[17px] font-bold text-tower-900 dark:text-white">{children}</h2>
        {action}
    </div>
);

/** Placar: número antes do rótulo, Syne, barra de base com a cor do assunto. */
export const OsStatTile: React.FC<{
    label: string;
    value: React.ReactNode;
    hint?: string;
    tone?: RowTone;
    onClick?: () => void;
}> = ({ label, value, hint, tone = 'none', onClick }) => (
    <div
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
        className={clsx(
            'relative overflow-hidden rounded-xl border border-tower-200 bg-white px-3.5 pb-3 pt-2.5 dark:border-tower-700/70 dark:bg-tower-900',
            onClick &&
                'cursor-pointer active:bg-tower-50 focus-visible:outline-2 focus-visible:outline-brand-500 dark:active:bg-tower-800',
        )}
    >
        <span className="block font-display text-[34px] font-extrabold leading-none text-tower-900 dark:text-white">
            {value}
        </span>
        <span className="mt-1 block text-[13px] font-semibold text-tower-600 dark:text-tower-300">{label}</span>
        {hint ? <span className="mt-0.5 block truncate text-[11px] text-tower-400">{hint}</span> : null}
        <span
            className={clsx('absolute inset-x-0 bottom-0 h-1', {
                'bg-brand-500': tone === 'route',
                'bg-brand-yellow-400': tone === 'attention',
                'bg-emerald-500': tone === 'ok',
                'bg-brand-red-500': tone === 'bad',
                'bg-tower-200 dark:bg-tower-700': tone === 'none',
            })}
        />
    </div>
);

export const OsEmpty: React.FC<{ title: string; detail?: string }> = ({ title, detail }) => (
    <div className="rounded-xl border-2 border-dashed border-tower-200 px-5 py-8 text-center dark:border-tower-700">
        <p className="font-display text-[15px] font-bold text-tower-700 dark:text-tower-200">{title}</p>
        {detail ? <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-tower-400">{detail}</p> : null}
    </div>
);

/** Carregamento de fila: linhas-fantasma no formato das etiquetas, sem spinner genérico. */
export const OsSkeletonRows: React.FC<{ count?: number }> = ({ count = 3 }) => (
    <div className="flex flex-col gap-2.5" aria-busy>
        {Array.from({ length: count }).map((_, i) => (
            <div
                key={i}
                className="h-[64px] animate-pulse rounded-r-xl border border-l-4 border-tower-200 border-l-tower-200 bg-tower-100/60 dark:border-tower-700/70 dark:border-l-tower-700 dark:bg-tower-800/50"
            />
        ))}
    </div>
);

export const OsErrorNotice: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
    <div className="rounded-xl border-l-4 border-brand-red-500 bg-brand-red-500/8 p-4 text-sm text-brand-red-700 dark:bg-brand-red-500/10 dark:text-brand-red-400">
        <p className="font-semibold">{message}</p>
        {onRetry ? (
            <OsButton variant="secondary" className="mt-3 min-h-[44px]" onClick={onRetry}>
                Tentar de novo
            </OsButton>
        ) : null}
    </div>
);

/** Barra fixa da ação primária — acima das abas, ao alcance do polegar. */
export const OsActionBar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="pointer-events-none fixed inset-x-0 bottom-[64px] z-30 bg-gradient-to-t from-tower-50 via-tower-50/90 to-transparent px-4 pb-3 pt-6 dark:from-tower-950 dark:via-tower-950/90">
        <div className="pointer-events-auto mx-auto max-w-xl">{children}</div>
    </div>
);
