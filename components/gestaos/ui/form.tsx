import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { Link, type LinkProps } from 'react-router-dom';
import { digitsOnly, isValidCNPJ, isValidCPF, maskCNPJOrCPF } from '../../../lib/formatters';
import type { Mode } from '../lib/modes';
import { IconClose, IconSearch } from './icons';
import { Button, ModeBadge, TextInput, type ButtonProps } from './kit';

/**
 * Kit de formulário da Gestão V2. Cada campo é controlado, devolve o valor já tratado (número, ISO,
 * texto limpo) e se veste com as classes `gx-*`. Para rótulo/erro envolva o campo em `Field` do kit.
 * Os helpers puros (parse/máscara/validação) ficam aqui no topo e têm teste em form.test.tsx.
 */

/* ======================================================================
 * Helpers puros
 * ==================================================================== */

export const onlyDigits = (value: string | number | null | undefined): string => String(value ?? '').replace(/\D/g, '');

/**
 * Lê número escrito à brasileira ou à americana.
 * "1.234,56" e "1,234.56" -> 1234.56; "10,5" e "10.5" -> 10.5; "R$ 10" -> 10.
 * Ponto único seguido de exatamente 3 dígitos é milhar ("1.234" -> 1234), salvo "0.500".
 * Devolve null para vazio ou texto que não é número.
 */
function parseLocaleNumber(input: string | number | null | undefined, maxDecimals?: number): number | null {
    if (input == null) return null;
    if (typeof input === 'number') return Number.isFinite(input) ? (maxDecimals == null ? input : round(input, maxDecimals)) : null;
    let text = input.replace(/R\$|\s/g, '');
    if (!text) return null;
    const negative = text.startsWith('-');
    if (negative) text = text.slice(1);
    if (!text || /[^\d.,]/.test(text)) return null;

    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    let separator: ',' | '.' | null = null;
    if (lastComma >= 0 && lastDot >= 0) separator = lastComma > lastDot ? ',' : '.';
    else if (lastComma >= 0) {
        if (text.indexOf(',') !== lastComma) return null;
        separator = ',';
    } else if (lastDot >= 0) {
        const dots = text.split('.').length - 1;
        const after = text.length - lastDot - 1;
        const head = text.slice(0, lastDot);
        if (dots === 1 && (after !== 3 || head === '' || head === '0')) separator = '.';
    }

    let integer: string;
    let decimal = '';
    if (separator) {
        const at = text.lastIndexOf(separator);
        integer = text.slice(0, at).replace(/[.,]/g, '');
        decimal = text.slice(at + 1);
        if (/\D/.test(decimal)) return null;
    } else {
        integer = text.replace(/[.,]/g, '');
    }
    if (!integer && !decimal) return null;
    const value = Number(`${integer || '0'}.${decimal || '0'}`);
    if (!Number.isFinite(value)) return null;
    const signed = negative ? -value : value;
    return maxDecimals == null ? signed : round(signed, maxDecimals);
}

function round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
}

/** Dinheiro: aceita vírgula ou ponto, no máximo 2 casas (arredonda). Vazio/ inválido -> null. */
export const parseMoney = (input: string | number | null | undefined): number | null => parseLocaleNumber(input, 2);

/** Decimal livre (peso, volume, percentual). Mesmas regras de separador de `parseMoney`, sem limite de casas. */
export const parseDecimal = (input: string | number | null | undefined): number | null => parseLocaleNumber(input);

/** 1234.5 -> "1.234,50" (sem "R$"). */
export const formatMoneyText = (value: number): string => value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** CPF (até 11 dígitos) ou CNPJ (até 14) com máscara, conforme a quantidade digitada. */
export const formatCnpjCpf = (value: string | null | undefined): string => maskCNPJOrCPF(value ?? '');

export function formatCep(value: string | null | undefined): string {
    const d = onlyDigits(value).slice(0, 8);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Placa em maiúsculas, só letras e números, 7 caracteres (padrão antigo e Mercosul). */
export const formatPlate = (value: string | null | undefined): string => (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);

/** Mesma validação (dígitos verificadores) usada pela gestão clássica, em `lib/formatters`. */
export const isValidCpf = (value: string | null | undefined): boolean => isValidCPF(value ?? '');
export const isValidCnpj = (value: string | null | undefined): boolean => isValidCNPJ(value ?? '');

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-13" (ou ISO completo) -> "2026-11-13" para o campo nativo; inválido -> "". */
export function isoToDateInput(iso: string | null | undefined): string {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? '');
    return match ? match[1] : '';
}

/** ISO (UTC) -> "YYYY-MM-DDTHH:mm" no fuso local, para o `datetime-local`. */
export function isoToLocalInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" local -> ISO UTC; vazio/inválido -> null. */
export function localInputToIso(local: string | null | undefined): string | null {
    if (!local) return null;
    const date = new Date(local);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* ======================================================================
 * Estrutura: seção e grade
 * ==================================================================== */

/** Classe para um filho da grade ocupar a linha inteira: `<Field className={FULL_ROW} ...>`. */
export const FULL_ROW = 'col-span-full';

export function FormGrid({ cols = 2, className, children }: { cols?: 1 | 2 | 3; className?: string; children: React.ReactNode }) {
    return <div className={clsx('grid grid-cols-1 gap-x-4 gap-y-4', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3', className)}>{children}</div>;
}

/** Célula da grade; `full` ocupa a linha inteira. Alternativa a passar `FULL_ROW` no filho. */
export function FormCell({ full, className, children }: { full?: boolean; className?: string; children: React.ReactNode }) {
    return <div className={clsx('min-w-0', full && FULL_ROW, className)}>{children}</div>;
}

/** Seção titulada de um formulário longo. Os filhos caem numa grade de 1 a 2 colunas. */
export function FormSection({
    title,
    hint,
    mode,
    cols = 2,
    className,
    children,
}: {
    title: string;
    hint?: React.ReactNode;
    /** Marca a seção que o sistema preenche (`copilot`) ou executa (`auto`). */
    mode?: Mode;
    cols?: 1 | 2 | 3;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <section className={clsx('flex flex-col gap-4 border-t py-5 first:border-t-0 first:pt-0', className)} style={{ borderColor: 'var(--gx-hair)' }}>
            <header className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="gx-h2">{title}</h3>
                    {mode ? <ModeBadge mode={mode} /> : null}
                </div>
                {hint ? <p className="gx-muted mt-1 text-[13px]">{hint}</p> : null}
            </header>
            <FormGrid cols={cols}>{children}</FormGrid>
        </section>
    );
}

/* ======================================================================
 * Campos
 * ==================================================================== */

interface BaseFieldProps {
    id?: string;
    name?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    /** Marca o campo com erro (borda vermelha + aria-invalid). A mensagem vai no `Field`. */
    invalid?: boolean;
    className?: string;
    'aria-label'?: string;
    onBlur?: () => void;
}

/** Caixa do campo com texto fixo antes (prefix) ou depois (suffix). */
function Affix({ prefix, suffix, children }: { prefix?: string; suffix?: string; children: React.ReactNode }) {
    return (
        <div className={clsx('gx-affix', prefix && 'gx-affix-has-pre', suffix && 'gx-affix-has-suf')}>
            {prefix ? <span className="gx-affix-pre" aria-hidden="true">{prefix}</span> : null}
            {children}
            {suffix ? <span className="gx-affix-suf" aria-hidden="true">{suffix}</span> : null}
        </div>
    );
}

/** Mantém o texto digitado e o valor numérico em sincronia, sem apagar o que a pessoa está escrevendo. */
function useNumericText(value: number | null | undefined, parse: (text: string) => number | null, format: (n: number) => string) {
    const [text, setText] = useState(() => (value == null ? '' : format(value)));
    const parseRef = useRef(parse);
    const formatRef = useRef(format);
    parseRef.current = parse;
    formatRef.current = format;
    useEffect(() => {
        setText((current) => {
            if ((value ?? null) === parseRef.current(current)) return current;
            return value == null ? '' : formatRef.current(value);
        });
    }, [value]);
    return [text, setText] as const;
}

export interface MoneyInputProps extends BaseFieldProps {
    value: number | null;
    onChange: (value: number | null) => void;
}

/** Dinheiro em reais: "R$" à esquerda, vírgula ou ponto, 2 casas no máximo. Devolve número ou null. */
export function MoneyInput({ value, onChange, invalid, className, onBlur, ...rest }: MoneyInputProps) {
    const [text, setText] = useNumericText(value, parseMoney, formatMoneyText);
    return (
        <Affix prefix="R$">
            <TextInput
                {...rest}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className={clsx('gx-num', className)}
                aria-invalid={invalid || undefined}
                value={text}
                placeholder={rest.placeholder ?? '0,00'}
                onChange={(event) => {
                    let raw = event.target.value.replace(/[^\d.,]/g, '');
                    const comma = raw.indexOf(',');
                    if (comma >= 0) raw = `${raw.slice(0, comma)},${raw.slice(comma + 1).replace(/\D/g, '').slice(0, 2)}`;
                    setText(raw);
                    onChange(parseMoney(raw));
                }}
                onBlur={() => {
                    const parsed = parseMoney(text);
                    setText(parsed == null ? '' : formatMoneyText(parsed));
                    onBlur?.();
                }}
            />
        </Affix>
    );
}

export interface NumberInputProps extends BaseFieldProps {
    value: number | null;
    onChange: (value: number | null) => void;
    /** Aceita casas decimais (vírgula). Padrão: só inteiro. */
    decimal?: boolean;
    /** Máximo de casas quando `decimal` (padrão 3). */
    decimals?: number;
    /** Texto fixo depois do número: "kg", "m³", "%". */
    suffix?: string;
    min?: number;
    max?: number;
}

const numberText = (text: string): number | null => {
    if (text === '' || text === '-' || text === ',') return null;
    const n = Number(text.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

/** Número com sufixo opcional. Digitação à brasileira (vírgula); `min`/`max` ajustam ao sair do campo. */
export function NumberInput({ value, onChange, decimal, decimals = 3, suffix, min, max, invalid, className, onBlur, ...rest }: NumberInputProps) {
    const [text, setText] = useNumericText(value, numberText, (n) => String(n).replace('.', ','));
    const allowNegative = min != null && min < 0;
    return (
        <Affix suffix={suffix}>
            <TextInput
                {...rest}
                type="text"
                inputMode={decimal ? 'decimal' : 'numeric'}
                autoComplete="off"
                className={clsx('gx-num', className)}
                aria-invalid={invalid || undefined}
                value={text}
                onChange={(event) => {
                    let raw = event.target.value.replace(decimal ? /[^\d.,-]/g : /[^\d-]/g, '').replace(/\./g, ',');
                    const negative = allowNegative && raw.startsWith('-');
                    raw = raw.replace(/-/g, '');
                    if (decimal) {
                        const comma = raw.indexOf(',');
                        if (comma >= 0) raw = `${raw.slice(0, comma)},${raw.slice(comma + 1).replace(/\D/g, '').slice(0, decimals)}`;
                    }
                    raw = (negative ? '-' : '') + raw;
                    setText(raw);
                    onChange(numberText(raw));
                }}
                onBlur={() => {
                    let parsed = numberText(text);
                    if (parsed != null) {
                        if (min != null && parsed < min) parsed = min;
                        if (max != null && parsed > max) parsed = max;
                    }
                    setText(parsed == null ? '' : String(parsed).replace('.', ','));
                    if (parsed !== numberText(text)) onChange(parsed);
                    onBlur?.();
                }}
            />
        </Affix>
    );
}

export interface DateInputProps extends BaseFieldProps {
    /** "YYYY-MM-DD" (aceita ISO completo; só a data é usada). */
    value: string | null | undefined;
    /** "YYYY-MM-DD" ou null quando limpo. */
    onChange: (value: string | null) => void;
    min?: string;
    max?: string;
}

export function DateInput({ value, onChange, invalid, className, onBlur, ...rest }: DateInputProps) {
    return (
        <TextInput
            {...rest}
            type="date"
            className={className}
            aria-invalid={invalid || undefined}
            value={isoToDateInput(value)}
            onChange={(event) => onChange(event.target.value || null)}
            onBlur={onBlur}
        />
    );
}

export interface DateTimeInputProps extends BaseFieldProps {
    /** ISO completo (UTC). */
    value: string | null | undefined;
    /** ISO completo (UTC) ou null quando limpo. O campo mostra o fuso local. */
    onChange: (value: string | null) => void;
    min?: string;
    max?: string;
}

export function DateTimeInput({ value, onChange, invalid, className, onBlur, ...rest }: DateTimeInputProps) {
    return (
        <TextInput
            {...rest}
            type="datetime-local"
            className={className}
            aria-invalid={invalid || undefined}
            value={isoToLocalInput(value)}
            onChange={(event) => onChange(localInputToIso(event.target.value))}
            onBlur={onBlur}
        />
    );
}

/** Valor com atraso: só muda `ms` depois da última alteração. */
export function useDebouncedValue<T>(value: T, ms = 350): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(value), ms);
        return () => window.clearTimeout(timer);
    }, [value, ms]);
    return debounced;
}

export interface SearchInputProps {
    /** Texto atual (opcional). Se mudar por fora e diferir do que foi digitado, o campo acompanha. */
    value?: string;
    /** Chamado com atraso (`delay`) depois de parar de digitar; imediatamente ao limpar ou apertar Enter. */
    onChange: (text: string) => void;
    delay?: number;
    placeholder?: string;
    'aria-label'?: string;
    className?: string;
    autoFocus?: boolean;
}

/** Campo de busca com lupa, botão de limpar e `onChange` com debounce (~350 ms). */
export function SearchInput({ value, onChange, delay = 350, placeholder = 'Buscar', className, autoFocus, ...rest }: SearchInputProps) {
    const [text, setText] = useState(value ?? '');
    const timer = useRef<number | null>(null);
    const emitted = useRef(value ?? '');
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const clearTimer = () => {
        if (timer.current != null) window.clearTimeout(timer.current);
        timer.current = null;
    };
    const emit = (next: string) => {
        clearTimer();
        if (next === emitted.current) return;
        emitted.current = next;
        onChangeRef.current(next);
    };
    useEffect(() => {
        if (value !== undefined && value !== emitted.current) {
            clearTimer();
            emitted.current = value;
            setText(value);
        }
    }, [value]);
    useEffect(() => clearTimer, []);

    return (
        <div className={clsx('gx-affix', className)} role="search">
            <span className="gx-affix-pre" aria-hidden="true" style={{ display: 'inline-flex' }}>
                <IconSearch size={16} />
            </span>
            <TextInput
                type="text"
                autoFocus={autoFocus}
                autoComplete="off"
                aria-label={rest['aria-label'] ?? placeholder}
                placeholder={placeholder}
                value={text}
                style={{ paddingLeft: 36, paddingRight: text ? 40 : undefined }}
                onChange={(event) => {
                    const next = event.target.value;
                    setText(next);
                    clearTimer();
                    timer.current = window.setTimeout(() => emit(next), delay);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        emit(text);
                    } else if (event.key === 'Escape' && text) {
                        setText('');
                        emit('');
                    }
                }}
            />
            {text ? (
                <button
                    type="button"
                    className="gx-affix-btn"
                    aria-label="Limpar busca"
                    onClick={() => {
                        setText('');
                        emit('');
                    }}
                >
                    <IconClose size={15} />
                </button>
            ) : null}
        </div>
    );
}

export interface CheckProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: React.ReactNode;
    hint?: React.ReactNode;
    disabled?: boolean;
    className?: string;
    id?: string;
}

/** Caixa de marcar com rótulo clicável. */
export function Checkbox({ checked, onChange, label, hint, disabled, className, id }: CheckProps) {
    return (
        <label className={clsx('gx-check', disabled && 'opacity-60', className)}>
            <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
            <span className="min-w-0">
                <span className="block text-[14px] font-medium">{label}</span>
                {hint ? <span className="gx-muted block text-[12.5px]">{hint}</span> : null}
            </span>
        </label>
    );
}

/** Interruptor liga/desliga (`role="switch"`) com rótulo clicável. */
export function Toggle({ checked, onChange, label, hint, disabled, className, id }: CheckProps) {
    const labelId = useId();
    return (
        <label className={clsx('gx-check', disabled && 'opacity-60', className)}>
            <button
                id={id}
                type="button"
                role="switch"
                aria-checked={checked}
                aria-labelledby={labelId}
                disabled={disabled}
                className="gx-switch"
                onClick={() => onChange(!checked)}
            />
            <span className="min-w-0">
                <span id={labelId} className="block text-[14px] font-medium">{label}</span>
                {hint ? <span className="gx-muted block text-[12.5px]">{hint}</span> : null}
            </span>
        </label>
    );
}

/* ======================================================================
 * Ações
 * ==================================================================== */

export interface LinkButtonProps extends Omit<LinkProps, 'className'> {
    variant?: ButtonProps['variant'];
    size?: ButtonProps['size'];
    icon?: React.ReactNode;
    className?: string;
}

/** `Link` do react-router com a cara do `Button`. */
export function LinkButton({ variant = 'ghost', size = 'md', icon, className, children, ...rest }: LinkButtonProps) {
    return (
        <Link className={clsx('gx-btn', `gx-btn-${variant}`, size === 'sm' && 'gx-btn-sm', className)} {...rest}>
            {icon}
            {children}
        </Link>
    );
}

export interface ConfirmButtonProps {
    label: React.ReactNode;
    /** Recebe o motivo (já sem espaços nas pontas) quando `reason` foi pedido; senão `undefined`. */
    onConfirm: (reason?: string) => void | boolean | Promise<void | boolean>;
    variant?: ButtonProps['variant'];
    size?: ButtonProps['size'];
    icon?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Pede um motivo antes de liberar "Confirmar?". `true` = mínimo de 3 caracteres. */
    reason?: boolean | { label?: string; minLength?: number; placeholder?: string };
    disabled?: boolean;
    loading?: boolean;
    className?: string;
}

/**
 * Ação destrutiva em dois passos, na própria linha (sem janela e sem `window.confirm`).
 * O 1º clique mostra "Confirmar?" + "Voltar"; com `reason`, o texto precisa do mínimo de caracteres.
 * `onConfirm` deve tratar o próprio erro (ex.: `useAction().run`); se devolver `false`, o passo continua aberto.
 */
export function ConfirmButton({
    label,
    onConfirm,
    variant = 'danger',
    size = 'sm',
    icon,
    confirmLabel = 'Confirmar?',
    cancelLabel = 'Voltar',
    reason,
    disabled,
    loading,
    className,
}: ConfirmButtonProps) {
    const [armed, setArmed] = useState(false);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const mounted = useRef(true);
    const reasonInput = useRef<HTMLInputElement>(null);
    const back = useRef<HTMLButtonElement>(null);
    useEffect(() => () => void (mounted.current = false), []);
    useEffect(() => {
        if (armed) (reasonInput.current ?? back.current)?.focus();
    }, [armed]);

    const reasonCfg = reason ? (reason === true ? {} : reason) : null;
    const minLength = reasonCfg ? Math.max(0, reasonCfg.minLength ?? 3) : 0;
    const trimmed = text.trim();
    const missing = Math.max(0, minLength - trimmed.length);

    const disarm = () => {
        setArmed(false);
        setText('');
    };

    if (!armed) {
        return (
            <Button variant={variant} size={size} icon={icon} className={className} disabled={disabled} loading={loading} onClick={() => setArmed(true)}>
                {label}
            </Button>
        );
    }

    const confirm = async () => {
        setBusy(true);
        try {
            const result = await onConfirm(reasonCfg ? trimmed : undefined);
            if (mounted.current && result !== false) disarm();
        } catch {
            // o chamador mostra o erro; mantém o passo aberto para tentar de novo
        } finally {
            if (mounted.current) setBusy(false);
        }
    };

    return (
        <div
            role="group"
            aria-label={typeof label === 'string' ? label : undefined}
            className={clsx('flex flex-wrap items-center gap-2', className)}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && !busy) {
                    event.stopPropagation();
                    disarm();
                }
            }}
        >
            {reasonCfg ? (
                <div className="w-full min-w-[220px] flex-1">
                    <TextInput
                        ref={reasonInput}
                        aria-label={reasonCfg.label ?? 'Motivo'}
                        placeholder={reasonCfg.placeholder ?? reasonCfg.label ?? 'Motivo'}
                        value={text}
                        disabled={busy}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && missing === 0 && !busy) {
                                event.preventDefault();
                                void confirm();
                            }
                        }}
                    />
                    {missing > 0 ? (
                        <span className="gx-muted mt-1 block text-[12.5px]">
                            {trimmed.length === 0 ? `Escreva o motivo (mínimo ${minLength} caracteres).` : `Faltam ${missing} ${missing === 1 ? 'caractere' : 'caracteres'}.`}
                        </span>
                    ) : null}
                </div>
            ) : null}
            <Button variant={variant} size={size} loading={busy} disabled={missing > 0} onClick={() => void confirm()}>
                {confirmLabel}
            </Button>
            <button ref={back} type="button" className={clsx('gx-btn gx-btn-ghost', size === 'sm' && 'gx-btn-sm')} disabled={busy} onClick={disarm}>
                {cancelLabel}
            </button>
        </div>
    );
}

/** Barra de ações do rodapé: secundárias à esquerda, primária à direita, erro geral em cima. */
export function FormFooter({
    primary,
    secondary,
    error,
    className,
}: {
    primary: React.ReactNode;
    secondary?: React.ReactNode;
    error?: string | null;
    className?: string;
}) {
    return (
        <footer className={clsx('gx-form-footer', className)}>
            {error ? (
                <p role="alert" className="gx-red-text w-full text-[13.5px] font-semibold">
                    {error}
                </p>
            ) : null}
            {secondary ? <div className="flex flex-wrap items-center gap-2">{secondary}</div> : null}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{primary}</div>
        </footer>
    );
}

/* ======================================================================
 * useForm
 * ==================================================================== */

export type FormErrors<T> = { [K in keyof T]?: string };

/** Regra como função: devolve a mensagem de erro, ou nada quando está certo. */
export type RuleFn<T, V> = (value: V, values: T) => string | null | undefined | false | void;

export interface RuleObject<T, V> {
    /** `true` usa "Campo obrigatório."; string vira a mensagem. Zero e `false` contam como preenchidos. */
    required?: boolean | string;
    /** Valor numérico mínimo (ignora vazio). */
    min?: number;
    /** Mínimo de caracteres do texto (ignora vazio). */
    minLength?: number;
    /** Mensagem das regras `min`/`minLength`. */
    message?: string;
    /** Regra livre; roda por último, só se as anteriores passaram. */
    check?: RuleFn<T, V>;
}

export type FieldRule<T, V> = RuleObject<T, V> | RuleFn<T, V>;
export type Rules<T> = { [K in keyof T]?: FieldRule<T, T[K]> | Array<FieldRule<T, T[K]>> };

const isEmpty = (value: unknown): boolean => value == null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);

/** Roda as regras e devolve só os erros (primeiro de cada campo). Puro, testável sem React. */
export function runRules<T extends object>(values: T, rules: Rules<T>): FormErrors<T> {
    const errors: FormErrors<T> = {};
    for (const key of Object.keys(rules) as Array<keyof T>) {
        const raw = rules[key];
        if (!raw) continue;
        const list = (Array.isArray(raw) ? raw : [raw]) as Array<FieldRule<T, T[keyof T]>>;
        const value = values[key];
        for (const rule of list) {
            let message: string | null | undefined | false | void;
            if (typeof rule === 'function') message = rule(value, values);
            else {
                if (rule.required && isEmpty(value)) message = typeof rule.required === 'string' ? rule.required : 'Campo obrigatório.';
                else if (!isEmpty(value)) {
                    if (rule.min != null && typeof value === 'number' && value < rule.min) message = rule.message ?? `O mínimo é ${rule.min}.`;
                    else if (rule.minLength != null && String(value).trim().length < rule.minLength) message = rule.message ?? `Use ao menos ${rule.minLength} caracteres.`;
                    else if (rule.check) message = rule.check(value, values);
                }
            }
            if (message) {
                errors[key] = message;
                break;
            }
        }
    }
    return errors;
}

const sameValue = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a === 'object' && typeof b === 'object' && a && b) return JSON.stringify(a) === JSON.stringify(b);
    return false;
};

export interface UseFormResult<T extends object> {
    values: T;
    errors: FormErrors<T>;
    /** Altera um campo e limpa o erro dele. */
    set: <K extends keyof T>(field: K, value: T[K]) => void;
    /** Altera vários campos de uma vez (ex.: pessoa escolhida preenche endereço). */
    setMany: (patch: Partial<T>) => void;
    /** Marca (ou limpa, com null) o erro de um campo — para erros que vêm do servidor. */
    setError: (field: keyof T, message: string | null) => void;
    clearErrors: () => void;
    /** Roda as regras, guarda os erros e devolve `true` se está tudo certo. */
    validate: (rules: Rules<T>) => boolean;
    /** Algum valor difere do inicial (ou do último `reset(next)`). */
    dirty: boolean;
    /** Volta ao inicial; com `next`, passa a ser o novo valor de referência. */
    reset: (next?: T) => void;
}

/** Estado de formulário pequeno e próprio: valores, erros por campo, validação e sujo/limpo. */
export function useForm<T extends object>(initial: T): UseFormResult<T> {
    const baseline = useRef(initial);
    const [values, setValues] = useState<T>(initial);
    const [errors, setErrors] = useState<FormErrors<T>>({});
    const latest = useRef(values);
    latest.current = values;

    const dropError = (field: keyof T) =>
        setErrors((current) => {
            if (!(field in current)) return current;
            const { [field]: _removed, ...rest } = current;
            return rest as FormErrors<T>;
        });

    const set = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
        setValues((current) => ({ ...current, [field]: value }));
        dropError(field);
    }, []);
    const setMany = useCallback((patch: Partial<T>) => {
        setValues((current) => ({ ...current, ...patch }));
        setErrors((current) => {
            const next = { ...current };
            for (const key of Object.keys(patch)) delete next[key as keyof T];
            return next;
        });
    }, []);
    const setError = useCallback((field: keyof T, message: string | null) => {
        if (message) setErrors((current) => ({ ...current, [field]: message }));
        else dropError(field);
    }, []);
    const clearErrors = useCallback(() => setErrors({}), []);
    const validate = useCallback((rules: Rules<T>) => {
        const found = runRules(latest.current, rules);
        setErrors(found);
        return Object.keys(found).length === 0;
    }, []);
    const reset = useCallback((next?: T) => {
        if (next) baseline.current = next;
        setValues(baseline.current);
        setErrors({});
    }, []);

    const dirty = (Object.keys({ ...baseline.current, ...values }) as Array<keyof T>).some((key) => !sameValue(values[key], baseline.current[key]));
    return { values, errors, set, setMany, setError, clearErrors, validate, dirty, reset };
}
